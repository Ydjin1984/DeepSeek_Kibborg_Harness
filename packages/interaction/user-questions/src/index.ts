/**
 * Service Definition for the user-questions capability seam (`ctx.userQuestions`): a UI-backed service for
 * pausing an agent tool call until the human answers a question. The model-
 * facing tool lives in `@deepseek-ai/dsh-tool-ask-user`; UI packages register
 * providers, one per answer channel (web GUI, Telegram bridge, …). Every
 * registered provider receives each question; the first answer wins and the
 * remaining providers are aborted through the shared signal.
 *
 * @module @deepseek-ai/dsh-user-questions
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { HarnessError } from '@deepseek-ai/dsh-llm'

declare module '@deepseek-ai/cordis' {
  interface Context {
    userQuestions: UserQuestionService
  }
}

import type { AskUserQuestionAnswer, AskUserQuestionItem } from './types.ts'

export type {
  AskUserQuestionAnswer, AskUserQuestionAnswerItem, AskUserQuestionIntent, AskUserQuestionItem,
  AskUserQuestionOption,
} from './types.ts'

/** Request for a human answer. */
export interface AskUserQuestionRequest {
  /** Questions to display. */
  questions: AskUserQuestionItem[]
  /** Exact live calling agent, when the request came from an agent tool call. */
  agent?: Agent
  /** Abort signal for the owning tool/step. */
  signal?: AbortSignal
}

/**
 * A provider that shows questions on one answer channel and resolves when the
 * human answers there. Providers must listen to `request.signal`: the service
 * aborts competing providers once another channel answered, and the owning
 * tool/step aborts the whole ask through the same signal.
 */
export interface UserQuestionProvider {
  ask(request: AskUserQuestionRequest): Promise<AskUserQuestionAnswer>
}

/** Stable error taxonomy for user-questions failures. */
export class UserQuestionError extends HarnessError {
  constructor(message: string, code: string, options?: ErrorOptions) {
    super(message, code, options)
    this.name = 'UserQuestionError'
  }
}

/** `ctx.userQuestions`: registered UI providers plus an `ask()` API. */
export class UserQuestionService extends Service {
  private readonly providers = new Set<UserQuestionProvider>()

  constructor(ctx: Context) {
    super(ctx, 'userQuestions')
  }

  /**
   * Register a UI provider. Any number of providers may be active in a context:
   * each one is an independent answer channel for the same questions.
   *
   * @param provider Channel implementation that collects answers.
   * @returns Disposer that unregisters this provider.
   */
  registerProvider(provider: UserQuestionProvider): () => void {
    const dispose = this.ctx.effect(function* (this: UserQuestionService) {
      this.providers.add(provider)
      yield () => {
        this.providers.delete(provider)
      }
    }.bind(this), 'userInteraction.registerProvider()')
    return () => void dispose()
  }

  /**
   * Ask the registered UI providers and wait for the first user answer.
   *
   * When a caller supplies an agent, human interaction is valid only for the
   * exact live runtime root. Runtime ownership, not durable session lineage,
   * decides this boundary: an owned child has no human answerer and would
   * block forever, while a lineage-bearing session resumed as a new runtime
   * root may ask normally.
   *
   * @param request Questions, owner agent, and abort signal.
   * @returns The answer chosen or typed by the human.
   * @throws {UserQuestionError} code `CALLER_NOT_LIVE` when a supplied
   *   agent is not the registry's exact live instance, or `DELEGATED_CALLER`
   *   when that live agent is owned by another agent.
   */
  async ask(request: AskUserQuestionRequest): Promise<AskUserQuestionAnswer> {
    if (request.signal?.aborted) {
      throw new UserQuestionError('ask_user_question was aborted before the user answered', 'ASK_ABORTED')
    }
    if (request.questions.length === 0) {
      throw new UserQuestionError('ask_user_question requires at least one question', 'EMPTY_QUESTIONS')
    }
    const agent = request.agent
    if (agent !== undefined) {
      const agents = this.ctx.get('agents')
      if (agents === undefined || agents.get(agent.id) !== agent) {
        throw new UserQuestionError(
          'human interaction requires the exact live calling agent when an agent is supplied',
          'CALLER_NOT_LIVE')
      }
      if (!agents.roots().includes(agent)) {
        throw new UserQuestionError(
          'human interaction is unavailable while the calling agent is owned by another live agent; '
          + "include the unresolved question or decision in the child agent's final result",
          'DELEGATED_CALLER')
      }
    }
    // A presentation intent asserts two things the types cannot: that the
    // named approve label is one of this question's own options, and that a
    // plan-review carries the plan it is a review of. A UI honouring the
    // intent answers with that label, and shows that detail as the plan, so
    // either gap would put a choice the asker never offered — or an approval of
    // something invisible — in front of the user. Caught at the asker, where
    // the mistake is, rather than in each UI.
    for (const question of request.questions) {
      const intent = question.intent
      if (intent === undefined) continue
      if (!(question.options ?? []).some(option => option.label === intent.approve)) {
        throw new UserQuestionError(
          `question ${question.id} declares intent ${intent.kind} whose approve label `
          + `${JSON.stringify(intent.approve)} names none of its options`,
          'BAD_INTENT')
      }
      if (question.detail === undefined) {
        throw new UserQuestionError(
          `question ${question.id} declares intent ${intent.kind} without the detail it reviews`,
          'BAD_INTENT')
      }
    }
    if (this.providers.size === 0) {
      throw new UserQuestionError('no user-questions provider is registered', 'NO_PROVIDER')
    }
    const providers = [...this.providers]
    // A single channel keeps the historical contract: it receives the request
    // unchanged (original signal included) and owns the whole wait.
    const [single] = providers
    if (single !== undefined && providers.length === 1) {
      return single.ask(request)
    }
    return askManyProviders(request, providers)
  }
}

/**
 * Ask several providers for one answer: every channel receives the question and
 * the first answer wins; once an answer arrives (or the caller signal aborts,
 * or every provider fails) the shared controller aborts the competing waits.
 * @param request - the validated question request.
 * @param providers - the channels to ask, in registration order.
 * @returns the first provider answer.
 */
function askManyProviders(
  request: AskUserQuestionRequest,
  providers: UserQuestionProvider[],
): Promise<AskUserQuestionAnswer> {
  return new Promise<AskUserQuestionAnswer>((resolve, reject) => {
    const controller = new AbortController()
    const failures: unknown[] = []
    let settled = false
    const source = request.signal
    const onSourceAbort = (): void => {
      if (settled) return
      settled = true
      controller.abort()
      reject(new UserQuestionError(
        'ask_user_question was aborted before the user answered', 'ASK_ABORTED'))
    }
    source?.addEventListener('abort', onSourceAbort, { once: true })
    const cleanup = (): void => {
      source?.removeEventListener('abort', onSourceAbort)
    }
    for (const provider of providers) {
      const signal = source === undefined
        ? controller.signal
        : AbortSignal.any([source, controller.signal])
      provider.ask({ ...request, signal }).then(
        (value) => {
          if (settled) return
          settled = true
          cleanup()
          controller.abort()
          resolve(value)
        },
        (error: unknown) => {
          if (settled) return
          failures.push(error)
          if (failures.length === providers.length) {
            settled = true
            cleanup()
            controller.abort()
            reject(failures[0] ?? new UserQuestionError(
              'all user-questions providers failed', 'ALL_PROVIDERS_FAILED'))
          }
        },
      )
    }
  })
}

export default UserQuestionService
