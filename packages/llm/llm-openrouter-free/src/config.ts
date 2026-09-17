/**
 * Configuration and reporting schema for the OpenRouter free-model pool.
 *
 * The namespace carries two kinds of data. The leading fields are the operator's
 * configuration, edited through Settings → Models → «OpenRouter Free». The
 * trailing `status` field is service-owned: every scan replaces it with the
 * free models the endpoint returned and what each one has left today, which is
 * what lets a configuration surface show the pool without a second wire
 * channel. A reader that reacts to a committed section must therefore compare
 * the configuration fields only — a scan rewrites `status` on its own.
 *
 * @module @deepseek-ai/dsh-llm-openrouter-free/config
 */

import z from '@deepseek-ai/schemastery'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'

/** Free-model endpoint of the public OpenRouter API, relative to `baseURL`. */
export const MODELS_PATH = '/models'

/** Default OpenRouter API root; `/models` and `/chat/completions` hang off it. */
export const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1'

/** Credential reference every published route resolves; also the UI's key field. */
export const DEFAULT_API_KEY_ENV = 'OPENROUTER_API_KEY'

/** Route key the pool publishes into the `llm-pi-ai` namespace. */
export const DEFAULT_PROVIDER_ROUTE = 'openrouter-free'

/** OpenRouter's documented free-tier ceiling: 20 requests per minute per model. */
export const DEFAULT_REQUESTS_PER_MINUTE = 20

/**
 * OpenRouter's documented free-tier ceiling: 50 requests per day per model
 * while the account holds under 10 USD of credit, 1000 with more. The lower
 * bound is the default because a wrong higher value burns a day's quota in
 * minutes instead of degrading politely.
 */
export const DEFAULT_REQUESTS_PER_DAY = 50

/**
 * Context floor for a pooled model. Free models below it exist, but they answer
 * a full tool-using turn badly enough that pooling them costs more rotations
 * than it saves.
 */
export const DEFAULT_MIN_CONTEXT_WINDOW = 32_768

/** Output cap assumed for a free model whose endpoint declares none. */
export const DEFAULT_MAX_TOKENS = 16_384

/** Scan cadence; a shorter one only re-reads an endpoint that changes rarely. */
export const DEFAULT_REFRESH_MINUTES = 30

/** Cap on pooled models, so publishing a profile cannot explode the picker. */
export const DEFAULT_MAX_MODELS = 20

/** How long one scan may take before it is abandoned. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 20_000

/** One pooled model as reported to configuration surfaces. */
export interface OpenRouterFreeStatusRow {
  /** OpenRouter model id, as sent on the wire (e.g. `deepseek/deepseek-chat:free`). */
  id: string
  /** Display name the endpoint reported. */
  name: string
  /** Context capacity the endpoint reported. */
  contextLength: number
  /** Requests spent on this model in the current UTC day. */
  requestsUsedToday: number
  /** Requests still available today under the configured daily budget. */
  requestsRemainingToday: number
  /** Tokens this pool spent on the model today (prompt + completion, as reported). */
  tokensUsedToday: number
  /** Tokens still available today, or 0 when no token budget is configured. */
  tokensRemainingToday: number
  /** Epoch milliseconds until which the model is benched, or 0 while it is selectable. */
  cooldownUntil: number
  /** Selectability: `ready`, `cooling` (rate-limited), `exhausted` (budget spent), or `error`. */
  state: 'ready' | 'cooling' | 'exhausted' | 'error'
  /** Last failure a lease reported for this model, when one did. */
  lastError?: string
}

/** Operator configuration plus the service-reported pool status. */
export interface OpenRouterFreeConfig {
  /** Whether the pool scans, publishes its route, and serves leases. */
  enabled: boolean
  /** Route key published into the `llm-pi-ai` provider dict. */
  providerRoute: string
  /** OpenRouter API root; a deployment may point it at a mirror or a stub. */
  baseURL: string
  /** Credential reference (environment-variable name) the published route resolves. */
  apiKeyEnv: string
  /**
   * Scan cadence; a shorter one only re-reads an endpoint that changes rarely.
   * The pool also rescans on this interval after every start, so a long-running
   * session picks up newly free and newly priced models without a restart.
   */
  refreshMinutes: number
  /**
   * Operator-side scan trigger. The value itself is meaningless — changing it
   * is what asks for an immediate scan, which is how a configuration surface
   * offers "rescan now" without teaching the service a second verb.
   */
  refreshNonce: number
  /** Abandon one scan after this many milliseconds. */
  requestTimeoutMs: number
  /** Maximum models pooled from one scan, highest context first. */
  maxModels: number
  /** Models below this context capacity are not pooled. */
  minContextWindow: number
  /** Requests per model per UTC minute before it is benched. */
  requestsPerMinutePerModel: number
  /** Requests per model per UTC day before it is benched. */
  requestsPerDayPerModel: number
  /** Tokens per model per UTC day before it is benched; 0 disables the limit. */
  tokensPerDayPerModel: number
  /** Model ids never pooled, exact match on the OpenRouter id. */
  excludeModels: string[]
  /**
   * Pool only models the directory advertises tool calling for. Every pooled
   * model is delegated to with the harness's tool set, so a model without tool
   * support fails the task it was leased for; disabling this admits such models
   * for deployments that only ever ask them for plain text.
   */
  requireToolSupport: boolean
  /**
   * Epoch milliseconds of the last successful scan, or 0 while none has run.
   * Service-owned, like {@link status}: a surface reads it to show how fresh
   * the pool is without a second wire channel.
   */
  scannedAt: number
  /** Service-owned pool status; rewritten by every scan and settled lease. */
  status: OpenRouterFreeStatusRow[]
}

/** Runtime schema for {@link OpenRouterFreeConfig}. */
export const Config: z<OpenRouterFreeConfig> = z.object({
  enabled: z.boolean().default(false),
  providerRoute: z.string().default(DEFAULT_PROVIDER_ROUTE),
  baseURL: z.string().default(DEFAULT_BASE_URL),
  apiKeyEnv: z.string().default(DEFAULT_API_KEY_ENV),
  refreshMinutes: z.number().step(1).min(1).max(Math.floor(MAX_TIMER_DELAY_MS / 60_000)).default(DEFAULT_REFRESH_MINUTES),
  refreshNonce: z.number().default(0),
  requestTimeoutMs: z.number().step(1).min(1000).max(MAX_TIMER_DELAY_MS).default(DEFAULT_REQUEST_TIMEOUT_MS),
  maxModels: z.number().step(1).min(1).max(200).default(DEFAULT_MAX_MODELS),
  minContextWindow: z.number().step(1).min(0).default(DEFAULT_MIN_CONTEXT_WINDOW),
  requestsPerMinutePerModel: z.number().step(1).min(1).default(DEFAULT_REQUESTS_PER_MINUTE),
  requestsPerDayPerModel: z.number().step(1).min(1).default(DEFAULT_REQUESTS_PER_DAY),
  tokensPerDayPerModel: z.number().step(1).min(0).default(0),
  excludeModels: z.array(z.string()).default([]),
  requireToolSupport: z.boolean().default(true),
  scannedAt: z.number().default(0),
  status: z.array(z.object({
    id: z.string().required(),
    name: z.string(),
    contextLength: z.number(),
    requestsUsedToday: z.number(),
    requestsRemainingToday: z.number(),
    tokensUsedToday: z.number(),
    tokensRemainingToday: z.number(),
    cooldownUntil: z.number(),
    state: z.union(['ready', 'cooling', 'exhausted', 'error']),
    lastError: z.string(),
  })).default([]),
})

/**
 * The operator-editable half of the namespace, compared to detect a real
 * configuration change. Both service-owned fields (`status`, `scannedAt`) are
 * excluded: a report this service writes must never look like an edit.
 */
export type OpenRouterFreeSettings = Omit<OpenRouterFreeConfig, 'status' | 'scannedAt'>

/**
 * Resolve the schema's own defaults into a complete section.
 *
 * `z<T>` is typed for the validated value, not for a partial input, so an
 * empty object — which schemastery fills from the schema's `.default(...)`
 * declarations — needs the same cast the settings seam uses in `resolve()`.
 * Computing the default from the schema keeps this the only declaration of
 * every default value.
 * @returns a complete section carrying every schema default.
 */
export function defaultOpenRouterFreeConfig(): OpenRouterFreeConfig {
  return Config({} as never)
}

/**
 * Project the configuration half of a resolved section.
 * @param config - resolved namespace value, status included.
 * @returns the configuration fields alone, detached from the service's report.
 */
export function settingsOf(config: OpenRouterFreeConfig): OpenRouterFreeSettings {
  const { status: _status, scannedAt: _scannedAt, ...settings } = config
  return settings
}

/**
 * Reject a section the pool could not publish, naming the field that cannot be
 * served. Registered as the namespace validator so the refusal reaches the
 * write (`settings.mutate` answers `settings-rejected`), instead of storing a
 * route key no provider dict can hold.
 * @param config - resolved namespace value to check.
 * @throws Error naming the unusable field.
 */
export function assertServiceable(config: OpenRouterFreeConfig): void {
  if (config.enabled && config.providerRoute.trim() === '') {
    throw new Error('llm-openrouter-free: providerRoute must be non-empty while the pool is enabled')
  }
  if (config.baseURL.trim() === '') throw new Error('llm-openrouter-free: baseURL must be non-empty')
  if (config.apiKeyEnv.trim() === '') throw new Error('llm-openrouter-free: apiKeyEnv must name a credential')
}

/** One model entry of the published route profile. */
export interface PublishedRouteModel {
  /** OpenRouter model id, sent verbatim on the wire. */
  id: string
  /** Display name shown by model pickers. */
  name: string
  /** Context capacity in tokens. */
  contextWindow: number
  /** Output cap in tokens. */
  maxTokens: number
  /** Accepted input modalities. */
  input: readonly string[]
}

/**
 * The route profile this pool publishes into the `llm-pi-ai` namespace.
 *
 * Deliberately declared here rather than imported: the owning schema is
 * `llm-pi-ai`'s, which validates this object when the write lands, and the
 * write path is the only coupling between the two packages. Publishing a field
 * that schema does not know is refused at the write, naming the route.
 */
export interface PublishedRouteProfile {
  /** Label shown by model pickers. */
  displayName: string
  /** Wire protocol every model on the route speaks. */
  api: string
  /** Endpoint the route's models are reached through. */
  baseURL: string
  /** Credential reference resolved per request. */
  apiKeyEnv: string
  /** Attribution headers the provider documents. */
  headers: Record<string, string>
  /** Context capacity assumed for a model that declares none. */
  defaultContextWindow: number
  /** Output capability assumed for a model that declares none. */
  defaultMaxTokens: number
  /** The pooled models. */
  models: PublishedRouteModel[]
}
