/**
 * Model-facing `typesafe_evaluate` tool over the TypeSafe.ai System One API.
 *
 * TypeSafe.ai is not an OpenAI-compatible chat provider: it serves a single
 * `POST /v1/systemone` endpoint that answers typed, probability-backed
 * questions (`noul` yes/no, `choice` pick-one, `score` rating) about one piece
 * of state and returns no free text. This package exposes that capability to
 * the model as a tool.
 * @module @deepseek-ai/dsh-typesafe-tool
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool, type JsonValue } from '@deepseek-ai/dsh-tools'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'tool-typesafe'
/** The tool registry this plugin contributes to. */
export const inject = ['tools']

/** Default credential reference resolved for each call. */
const DEFAULT_API_KEY_ENV = 'TYPESAFE_API_KEY'
/** Default TypeSafe API base URL (no trailing slash). */
const DEFAULT_BASE_URL = 'https://api.typesafe.ai'
/** Default model served by the System One endpoint. */
const DEFAULT_MODEL = 'jev-latest'
/** Default cooperative timeout budget for one evaluation round-trip. */
const DEFAULT_TIMEOUT_MS = 60_000

/** Question kinds the System One endpoint accepts. */
const QUESTION_TYPES = ['noul', 'choice', 'score'] as const

/** Model-facing TypeSafe tool configuration. */
export interface Config {
  /** Literal API key; prefer {@link apiKeyEnv} so no secret enters configuration files. */
  apiKey?: string
  /** Credential reference resolved for each call; defaults to `TYPESAFE_API_KEY`. */
  apiKeyEnv?: string
  /** TypeSafe API base URL; defaults to `https://api.typesafe.ai`. */
  baseURL?: string
  /** Model id used when a call omits `model`; defaults to `jev-latest`. */
  defaultModel?: string
  /** Cooperative timeout budget for one evaluation round-trip in milliseconds. */
  timeoutMs?: number
}

/** Schemastery configuration for the TypeSafe tool consumer. */
export const Config: z<Config> = z.object({
  apiKey: z.string().role('secret'),
  apiKeyEnv: z.string().role('credential-ref').default(DEFAULT_API_KEY_ENV),
  baseURL: z.string().default(DEFAULT_BASE_URL),
  defaultModel: z.string().default(DEFAULT_MODEL),
  timeoutMs: z.number().step(1).min(1).default(DEFAULT_TIMEOUT_MS),
})

/**
 * Resolve the API key per call: a literal config key wins, then the credential
 * seam, then the launch environment. Resolving per call keeps a key written
 * through the Models/credentials store effective without a restart.
 * @param ctx - Cordis context carrying the optional credential service.
 * @param config - normalized tool configuration.
 * @returns an async thunk returning the current key, or `undefined`.
 */
function resolveApiKey(ctx: Context, config: Config): () => Promise<string | undefined> {
  const ref = credentialRef(config.apiKeyEnv ?? DEFAULT_API_KEY_ENV)
  const literal = config.apiKey !== undefined && config.apiKey.length > 0 ? config.apiKey : undefined
  return async () => {
    if (literal !== undefined) return literal
    const credentials = ctx.get('credentials')
    if (credentials !== undefined) return (await credentials.resolve(ref))?.value
    const ambient = launchEnvironmentOf(ctx).get(ref)
    return ambient !== undefined && ambient.value.length > 0 ? ambient.value : undefined
  }
}

/**
 * Register the `typesafe_evaluate` tool.
 * @param ctx - Cordis context carrying the tool registry.
 * @param config - normalized tool configuration.
 */
export function apply(ctx: Context, config: Config): void {
  const getApiKey = resolveApiKey(ctx, config)
  const baseURL = (config.baseURL ?? DEFAULT_BASE_URL).replace(/\/+$/, '')
  const defaultModel = config.defaultModel ?? DEFAULT_MODEL
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS

  ctx.tools.register(defineTool({
    name: 'typesafe_evaluate',
    description:
      'Evaluate typed, probability-backed decisions over one piece of text using the TypeSafe.ai '
      + 'System One API. Ask any number of yes/no (`noul`), multiple-choice (`choice`), or rating '
      + '(`score`) questions and get each answer with probabilities and confidence — no free text. '
      + 'Use for classification, routing, sentiment, or scoring.',
    parameters: {
      state: {
        type: 'string',
        required: true,
        description: 'The content to evaluate: a message, log line, record, or any text to reason about.',
      },
      model: {
        type: 'string',
        description: 'Model id to use; defaults to the configured default (`jev-latest`).',
      },
      questions: {
        type: 'array',
        required: true,
        description: 'The questions to answer about the state; each becomes one typed answer.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: {
              type: 'string',
              required: true,
              description: 'Stable key for this question; the answer is returned under the same key.',
            },
            type: {
              type: 'string',
              required: true,
              enum: [...QUESTION_TYPES],
              description: 'noul (yes/no) | choice (pick one option) | score (rate on an ordered scale).',
            },
            instructions: {
              type: 'string',
              required: true,
              description: 'What the model should decide for this question.',
            },
            criteria: {
              type: 'object',
              additionalProperties: true,
              description: 'For `choice`: map of option id → description. For `noul`: optional {true, false} descriptions.',
            },
            levels: {
              type: 'array',
              items: { type: 'string' },
              description: 'For `score`: ordered level descriptions (at least two), e.g. ["Calm", "Frustrated", "Angry"].',
            },
          },
        },
      },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    timeoutMs,
    async execute(args, exec) {
      const apiKey = await getApiKey()
      if (apiKey === undefined || apiKey.length === 0) {
        throw new Error(
          `TypeSafe tool has no API key; store "${config.apiKeyEnv ?? DEFAULT_API_KEY_ENV}"`
          + ' through the credentials service or set apiKey',
        )
      }
      const questions: Record<string, Record<string, unknown>> = {}
      for (const question of args.questions) {
        const body: Record<string, unknown> = {
          type: question.type,
          instructions: question.instructions,
        }
        if (question.type === 'score') {
          if (question.levels !== undefined && question.levels.length > 0) body.criteria = question.levels
        } else if (question.criteria !== undefined) {
          body.criteria = question.criteria
        }
        questions[question.id] = body
      }
      const response = await fetch(`${baseURL}/v1/systemone`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          state: args.state,
          model: args.model ?? defaultModel,
          questions,
        }),
        signal: exec.signal,
      })
      const text = await response.text()
      if (!response.ok) {
        throw new Error(`TypeSafe API returned ${response.status}: ${text.slice(0, 500)}`)
      }
      // `JSON.parse` yields `any` at this wire boundary; `output.schema` re-validates the object.
      return JSON.parse(text) as Record<string, JsonValue>
    },
    presentCall: args => ({
      card: 'generic',
      title: 'TypeSafe evaluate',
      kind: 'other',
      rawInput: { state: args.state, questions: args.questions.map(question => question.id) },
    }),
  }))
}
