import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import UserQuestionService, {
  UserQuestionError,
  type AskUserQuestionAnswer,
  type AskUserQuestionRequest,
  type UserQuestionProvider,
} from '@deepseek-ai/dsh-user-questions'

function provider(answer = 'approved'): UserQuestionProvider & { seen: AskUserQuestionRequest[] } {
  const seen: AskUserQuestionRequest[] = []
  return {
    seen,
    async ask(request) {
      seen.push(request)
      return { answers: [{ id: request.questions[0]?.id ?? 'missing', selected: [answer] }] }
    },
  }
}

function stubAgent(id: string, delegationDepth = 0): Agent {
  const agentId = id as Agent['id']
  return {
    id: agentId,
    session: { id: agentId, header: { delegationDepth } },
  } as unknown as Agent
}

/** A provider that records the signal it receives and never answers on its own. */
function hangingProvider(): UserQuestionProvider & { signals: AbortSignal[] } {
  const signals: AbortSignal[] = []
  return {
    signals,
    ask(request) {
      signals.push(request.signal as AbortSignal)
      return new Promise<AskUserQuestionAnswer>(() => {})
    },
  }
}

describe('UserQuestionService', () => {
  it('delegates ask requests to the registered provider', async () => {
    const ctx = new Context()
    await ctx.plugin(UserQuestionService)
    const p = provider('yes')
    ctx.userQuestions.registerProvider(p)

    const result = await ctx.userQuestions.ask({ questions: [{ id: 'confirm', question: 'Proceed?' }] })

    expect(result).toEqual({ answers: [{ id: 'confirm', selected: ['yes'] }] })
    expect(p.seen).toEqual([{ questions: [{ id: 'confirm', question: 'Proceed?' }] }])
  })

  it('rejects ask requests when no provider is registered', async () => {
    const ctx = new Context()
    await ctx.plugin(UserQuestionService)

    await expect(ctx.userQuestions.ask({ questions: [{ id: 'confirm', question: 'Proceed?' }] }))
      .rejects.toMatchObject({ name: 'UserQuestionError', code: 'NO_PROVIDER' })
  })

  it('registers providers with HMR-safe disposal', async () => {
    const ctx = new Context()
    await ctx.plugin(UserQuestionService)
    const p = provider()
    const dispose = ctx.userQuestions.registerProvider(p)

    dispose()
    dispose()

    await expect(ctx.userQuestions.ask({ questions: [{ id: 'confirm', question: 'Proceed?' }] }))
      .rejects.toMatchObject({ code: 'NO_PROVIDER' })
  })

  it('accepts multiple registered providers as independent UI channels', async () => {
    const ctx = new Context()
    await ctx.plugin(UserQuestionService)
    const first = provider('first')
    const second = provider('second')
    ctx.userQuestions.registerProvider(first)
    ctx.userQuestions.registerProvider(second)

    const result = await ctx.userQuestions.ask({ questions: [{ id: 'confirm', question: 'Proceed?' }] })

    // Every channel receives the request; ask() settles with one of their answers.
    expect(first.seen).toHaveLength(1)
    expect(second.seen).toHaveLength(1)
    expect(result.answers[0]?.id).toBe('confirm')
    expect(['first', 'second']).toContain(result.answers[0]?.selected[0])
  })

  it('resolves with the first answer and aborts competing providers', async () => {
    const ctx = new Context()
    await ctx.plugin(UserQuestionService)
    const fast = provider('fast')
    const slow = hangingProvider()
    ctx.userQuestions.registerProvider(fast)
    ctx.userQuestions.registerProvider(slow)

    const result = await ctx.userQuestions.ask({ questions: [{ id: 'q', question: 'Q?' }] })

    expect(result).toEqual({ answers: [{ id: 'q', selected: ['fast'] }] })
    expect(fast.seen).toHaveLength(1)
    expect(slow.signals).toHaveLength(1)
    expect(slow.signals[0]?.aborted).toBe(true)
  })

  it('aborts every provider and rejects ASK_ABORTED when the caller signal aborts', async () => {
    const ctx = new Context()
    await ctx.plugin(UserQuestionService)
    const a = hangingProvider()
    const b = hangingProvider()
    ctx.userQuestions.registerProvider(a)
    ctx.userQuestions.registerProvider(b)
    const controller = new AbortController()

    const ask = ctx.userQuestions.ask({ questions: [{ id: 'q', question: 'Q?' }], signal: controller.signal })
    await Promise.resolve()
    controller.abort()

    await expect(ask).rejects.toMatchObject({ name: 'UserQuestionError', code: 'ASK_ABORTED' })
    expect(a.signals[0]?.aborted).toBe(true)
    expect(b.signals[0]?.aborted).toBe(true)
  })

  it('rejects with the first failure when every provider fails', async () => {
    const ctx = new Context()
    await ctx.plugin(UserQuestionService)
    const failing = (code: string): UserQuestionProvider => ({
      ask: vi.fn(async () => { throw new UserQuestionError('channel down', code) }),
    })
    ctx.userQuestions.registerProvider(failing('CHANNEL_A_DOWN'))
    ctx.userQuestions.registerProvider(failing('CHANNEL_B_DOWN'))

    await expect(ctx.userQuestions.ask({ questions: [{ id: 'q', question: 'Q?' }] }))
      .rejects.toMatchObject({ name: 'UserQuestionError', code: 'CHANNEL_A_DOWN' })
  })

  it('keeps remaining providers after one is disposed', async () => {
    const ctx = new Context()
    await ctx.plugin(UserQuestionService)
    const first = provider('first')
    const second = provider('second')
    const disposeFirst = ctx.userQuestions.registerProvider(first)
    ctx.userQuestions.registerProvider(second)
    disposeFirst()

    const result = await ctx.userQuestions.ask({ questions: [{ id: 'q', question: 'Q?' }] })

    expect(first.seen).toHaveLength(0)
    expect(second.seen).toHaveLength(1)
    expect(result).toEqual({ answers: [{ id: 'q', selected: ['second'] }] })
  })

  it('fails before reaching the provider when the signal is already aborted', async () => {
    const ctx = new Context()
    await ctx.plugin(UserQuestionService)
    const p = { ask: vi.fn(async () => ({ answers: [{ id: 'confirm', selected: ['too late'] }] })) }
    ctx.userQuestions.registerProvider(p)
    const controller = new AbortController()
    controller.abort()

    await expect(ctx.userQuestions.ask({ questions: [{ id: 'confirm', question: 'Proceed?' }], signal: controller.signal }))
      .rejects.toMatchObject({ code: 'ASK_ABORTED' })
    expect(p.ask).not.toHaveBeenCalled()
  })

  it('rejects empty question batches before reaching the provider', async () => {
    const ctx = new Context()
    await ctx.plugin(UserQuestionService)
    const p = { ask: vi.fn(async () => ({ answers: [] })) }
    ctx.userQuestions.registerProvider(p)

    await expect(ctx.userQuestions.ask({ questions: [] }))
      .rejects.toMatchObject({ name: 'UserQuestionError', code: 'EMPTY_QUESTIONS' })
    expect(p.ask).not.toHaveBeenCalled()
  })

  it('rejects a live runtime-owned agent before reaching the provider', async () => {
    const ctx = new Context()
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(UserQuestionService)
    const p = { ask: vi.fn(async () => ({ answers: [] })) }
    ctx.userQuestions.registerProvider(p)
    const root = stubAgent('root', 0)
    const child = stubAgent('child', 0)
    ctx.agents.enter(root, undefined)
    ctx.agents.enter(child, root)

    await expect(ctx.userQuestions.ask({
      questions: [{ id: 'confirm', question: 'Proceed?' }],
      agent: child,
    })).rejects.toMatchObject({
      name: 'UserQuestionError',
      code: 'DELEGATED_CALLER',
      message: "human interaction is unavailable while the calling agent is owned by another live agent; include the unresolved question or decision in the child agent's final result",
    })
    expect(p.ask).not.toHaveBeenCalled()
  })

  it('reaches the provider for a lineage-bearing session resumed as a runtime root', async () => {
    const ctx = new Context()
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(UserQuestionService)
    const p = provider('yes')
    ctx.userQuestions.registerProvider(p)
    const agent = stubAgent('resumed-root', 1)
    ctx.agents.enter(agent, undefined)

    const result = await ctx.userQuestions.ask({
      questions: [{ id: 'confirm', question: 'Proceed?' }],
      agent,
    })

    expect(result).toEqual({ answers: [{ id: 'confirm', selected: ['yes'] }] })
  })

  it('rejects a supplied agent when no live registry can attest it', async () => {
    const ctx = new Context()
    await ctx.plugin(UserQuestionService)
    const p = { ask: vi.fn(async () => ({ answers: [] })) }
    ctx.userQuestions.registerProvider(p)

    await expect(ctx.userQuestions.ask({
      questions: [{ id: 'confirm', question: 'Proceed?' }],
      agent: stubAgent('unattested'),
    })).rejects.toMatchObject({ name: 'UserQuestionError', code: 'CALLER_NOT_LIVE' })
    expect(p.ask).not.toHaveBeenCalled()
  })

  it('rejects a stale agent object that reuses a live id', async () => {
    const ctx = new Context()
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(UserQuestionService)
    const p = { ask: vi.fn(async () => ({ answers: [] })) }
    ctx.userQuestions.registerProvider(p)
    const live = stubAgent('same-id')
    ctx.agents.enter(live, undefined)

    await expect(ctx.userQuestions.ask({
      questions: [{ id: 'confirm', question: 'Proceed?' }],
      agent: stubAgent('same-id'),
    })).rejects.toMatchObject({ name: 'UserQuestionError', code: 'CALLER_NOT_LIVE' })
    expect(p.ask).not.toHaveBeenCalled()
  })

  it('rejects an intent whose approve label names none of its own options', async () => {
    const ctx = new Context()
    await ctx.plugin(UserQuestionService)
    const p = { ask: vi.fn(async () => ({ answers: [] })) }
    ctx.userQuestions.registerProvider(p)
    const question = { id: 'plan-review', question: 'Approve?', detail: '# Plan' }

    // A wrong label among offered options, and no options offered at all.
    for (const options of [[{ label: 'Approve' }], undefined]) {
      await expect(ctx.userQuestions.ask({
        questions: [{
          ...question,
          ...(options === undefined ? {} : { options }),
          intent: { kind: 'plan-review', approve: 'Ship it' },
        }],
      })).rejects.toMatchObject({ name: 'UserQuestionError', code: 'BAD_INTENT' })
    }
    expect(p.ask).not.toHaveBeenCalled()
  })

  it('rejects a plan-review intent on a question carrying no plan to review', async () => {
    const ctx = new Context()
    await ctx.plugin(UserQuestionService)
    const p = { ask: vi.fn(async () => ({ answers: [] })) }
    ctx.userQuestions.registerProvider(p)

    // Detail IS the plan for this intent, so a UI honouring it would ask the
    // user to approve something they cannot see.
    await expect(ctx.userQuestions.ask({
      questions: [{
        id: 'plan-review', question: 'Approve?',
        options: [{ label: 'Approve' }, { label: 'Keep planning' }],
        intent: { kind: 'plan-review', approve: 'Approve' },
      }],
    })).rejects.toMatchObject({ name: 'UserQuestionError', code: 'BAD_INTENT' })
    expect(p.ask).not.toHaveBeenCalled()
  })

  it('passes an intent through once its approve label names an offered option', async () => {
    const ctx = new Context()
    await ctx.plugin(UserQuestionService)
    const p = provider('Approve')
    ctx.userQuestions.registerProvider(p)
    const intent = { kind: 'plan-review', approve: 'Approve' } as const

    const result = await ctx.userQuestions.ask({
      questions: [
        { id: 'plain', question: 'Proceed?' },
        {
          id: 'plan-review', question: 'Approve?', detail: '# Plan',
          options: [{ label: 'Approve' }, { label: 'Keep planning' }], intent,
        },
      ],
    })

    expect(result.answers).toEqual([{ id: 'plain', selected: ['Approve'] }])
    expect(p.seen[0]?.questions[1]?.intent).toEqual(intent)
  })
})
