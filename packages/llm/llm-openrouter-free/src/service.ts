/**
 * The OpenRouter free-model pool (`ctx.openrouterFree`).
 *
 * One service owns the whole mechanism: it scans OpenRouter's public model
 * directory for zero-price models, publishes the survivors as a `pi-ai`
 * provider route so ordinary model selection can reach them, keeps a durable
 * per-model budget ledger, and hands out leases that rotate across the pool.
 *
 * Rotation and budgeting exist because a free model is a depleting resource.
 * `acquire()` selects the least-used model that still has budget, reserves one
 * request on it, and answers `undefined` — immediately, never by waiting — when
 * the pool is spent, so a caller (the orchestrator's swarm) can report a
 * missing worker instead of hanging on one that cannot answer. `release()`
 * records what the attempt cost, and a rate-limited attempt benches that model
 * until its window turns over, which is what moves the next task to the next
 * model.
 *
 * The service writes two things into its own settings section: nothing but the
 * pool's `status` rows, which configuration surfaces read. A committed status
 * rewrite must not be mistaken for a configuration change, so the scan
 * schedule is driven by a key over the configuration fields alone.
 *
 * @module @deepseek-ai/dsh-llm-openrouter-free
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { deepEqualJson, installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import { Config, MODELS_PATH, assertServiceable, defaultOpenRouterFreeConfig, settingsOf } from './config.ts'
import type {
  OpenRouterFreeConfig, OpenRouterFreeSettings, OpenRouterFreeStatusRow, PublishedRouteProfile,
} from './config.ts'
import { parseFreeModels } from './catalog.ts'
import type { FreeModelEntry } from './catalog.ts'
import {
  applyOutcome, earliestRecovery, emptyUsage, hasCapacity, requestsRemaining, reserveRequest,
  rollUsage, selectModel, stateOf, tokensRemaining,
} from './limits.ts'
import type { BudgetLimits, LeaseOutcome, ModelState, ModelUsage, PooledModel } from './limits.ts'
import { loadLedger, saveLedger } from './state.ts'

export { Config, assertServiceable, settingsOf } from './config.ts'
export type {
  OpenRouterFreeConfig, OpenRouterFreeSettings, OpenRouterFreeStatusRow,
  PublishedRouteModel, PublishedRouteProfile,
} from './config.ts'
export { isFreeEntry, parseFreeModels } from './catalog.ts'
export type { FreeModelEntry } from './catalog.ts'
export {
  applyOutcome, dayKey, emptyUsage, hasCapacity, minuteKey, nextUtcMidnight, requestsRemaining,
  reserveRequest, rollUsage, selectModel, stateOf, tokensRemaining,
} from './limits.ts'
export type { LeaseOutcome, ModelState, ModelUsage, PooledModel } from './limits.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    openrouterFree: OpenRouterFreePool
  }
}

/** Namespace of this plugin's own settings section (Settings → Models → «OpenRouter Free»). */
export const SETTINGS_NS = settingsNamespace('openrouter-free')

/** Namespace the published route profile is written into. */
export const LLM_SETTINGS_NS = settingsNamespace('llm-pi-ai')

/** Attribution headers OpenRouter documents for API clients. */
const ATTRIBUTION_HEADERS: Record<string, string> = {
  'HTTP-Referer': 'https://github.com/deepseek-ai/deepseek-harness',
  'X-Title': 'DeepSeek Harness',
}

/** One reserved model, valid until its outcome is reported. */
export interface FreeModelLease {
  /** `pi-ai` provider route the model is reachable through. */
  readonly provider: string
  /** OpenRouter model id to pin on the delegated run. */
  readonly model: string
  /**
   * Record what the attempt cost and return the model to the pool.
   * @param outcome - the attempt's result; a rate limit benches the model.
   */
  release(outcome: LeaseOutcome): Promise<void>
}

/** Read-only view of the pool, for a caller deciding whether to start work. */
export interface FreePoolSnapshot {
  /** Whether the pool is enabled and has published its route. */
  readonly enabled: boolean
  /** Epoch milliseconds of the last successful scan, or 0. */
  readonly scannedAt: number
  /** Models the last scan pooled. */
  readonly models: readonly OpenRouterFreeStatusRow[]
  /** Whether any pooled model can take a task right now. */
  readonly hasCapacity: boolean
  /** Epoch milliseconds until the earliest benched model returns, or 0. */
  readonly nextRecoveryAt: number
}

/** Project configured budgets onto the ledger's limit fields. */
function limitsOf(settings: OpenRouterFreeSettings): BudgetLimits {
  return {
    requestsPerMinutePerModel: settings.requestsPerMinutePerModel,
    requestsPerDayPerModel: settings.requestsPerDayPerModel,
    tokensPerDayPerModel: settings.tokensPerDayPerModel,
  }
}

/** The name of the model-facing pool tool this service registers. */
export const FREE_MODELS_TOOL = 'free_models'

/** One model row as the tool reports it. */
export interface FreeModelsToolRow {
  /** OpenRouter model id. */
  id: string
  /** Selectability: `ready`, `cooling`, `exhausted`, or `error`. */
  state: ModelState
  /** Requests still available today under the configured daily budget. */
  requestsRemainingToday: number
  /** Tokens still available today, or 0 when no token budget is configured. */
  tokensRemainingToday: number
  /** Epoch milliseconds until which the model is benched, or 0. */
  cooldownUntil: number
}

/** The tool's canonical result value. */
export interface FreeModelsToolValue {
  /** Whether the pool is enabled and has published its route. */
  enabled: boolean
  /** Whether any pooled model can take a task right now. */
  hasCapacity: boolean
  /** Epoch milliseconds of the last successful scan, or 0. */
  scannedAt: number
  /** The pooled models, in scan order. */
  models: FreeModelsToolRow[]
}

/**
 * Render the pool report as the model-facing text.
 * @param value - the tool's canonical value.
 * @returns one line per model, with a header naming the pool's state.
 */
export function freeModelsText(value: FreeModelsToolValue): string {
  const header = value.enabled
    ? `Free OpenRouter pool: ${String(value.models.length)} model(s), `
      + `${value.hasCapacity ? 'capacity available' : 'NO capacity right now'}, `
      + `last scan ${value.scannedAt === 0 ? 'never' : new Date(value.scannedAt).toISOString()}`
    : 'Free OpenRouter pool is disabled or has not published its route'
  const rows = value.models.map(row =>
    `${row.id} — ${row.state}, ${String(row.requestsRemainingToday)} request(s) left today`
    + (row.cooldownUntil === 0 ? '' : `, benched until ${new Date(row.cooldownUntil).toISOString()}`))
  return [header, ...rows].join('\n')
}

/**
 * The pool service. Enabled through its own settings namespace; while enabled
 * it scans on an interval, republishes the `pi-ai` route after every scan, and
 * serves leases.
 */
export class OpenRouterFreePool extends Service {
  static Config: z<OpenRouterFreeConfig> = Config

  private current: () => OpenRouterFreeConfig
  private entries: FreeModelEntry[] = []
  private ledger: Record<string, ModelUsage> = {}
  private scannedAt = 0
  private published: string | undefined
  private timer: ReturnType<typeof setInterval> | undefined
  private scheduleKey: string | undefined
  private configKey: string | undefined
  private persistTail: Promise<void> = Promise.resolve()
  private scanning: Promise<void> | undefined
  private stopped = false

  /**
   * @param ctx - host context carrying settings and credentials.
   * @param config - composition entry config, used as the settings base layer.
   */
  constructor(ctx: Context, config: OpenRouterFreeConfig = defaultOpenRouterFreeConfig()) {
    super(ctx, 'openrouterFree')
    this.current = () => config
    ctx.effect(() => {
      void loadLedger()
        .then((ledger) => { this.ledger = ledger })
        .catch((error: unknown) => {
          this.ctx.logger.warn(`llm-openrouter-free: could not read the ledger: ${String(error)}`)
        })
        .finally(() => {
          if (!this.stopped) this.sync()
        })
      return () => {
        this.stopped = true
        this.stopTimer()
      }
    }, 'llm-openrouter-free: ledger load and scan schedule')

    installSettingsSection(ctx, SETTINGS_NS, Config, config, {
      validate: assertServiceable,
      setSource: (source) => { this.current = source },
      onChange: () => { this.sync() },
    })

    // The model-facing half of the pool: a caller can read what is left before
    // it fans work out, and rescan on demand instead of waiting for the
    // interval. Registration rides the tools service, so a deployment without
    // one simply has no such tool.
    ctx.inject(['tools'], (toolCtx) => {
      toolCtx.tools.register(defineTool({
        name: FREE_MODELS_TOOL,
        description:
          'Inspect or rescan the pool of FREE OpenRouter models this deployment runs work on. '
          + '`status` reports every pooled model, the requests each has left today, and when the pool was last '
          + 'scanned; `refresh` rescans the OpenRouter catalog now (the pool also rescans on its own interval) and '
          + 'then reports the same fields. Call `status` before fanning independent tasks out, so no worker is '
          + 'sent to a model with nothing left; call `refresh` when a model you expected is missing or the list '
          + 'looks stale.',
        parameters: {
          action: {
            type: 'string',
            required: true,
            enum: ['status', 'refresh'],
            description: '`status` reads the current pool; `refresh` rescans the catalog first.',
          },
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              enabled: { type: 'boolean', required: true },
              hasCapacity: { type: 'boolean', required: true },
              scannedAt: { type: 'number', required: true },
              models: {
                type: 'array',
                required: true,
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    id: { type: 'string', required: true },
                    state: { type: 'string', required: true, enum: ['ready', 'cooling', 'exhausted', 'error'] },
                    requestsRemainingToday: { type: 'number', required: true },
                    tokensRemainingToday: { type: 'number', required: true },
                    cooldownUntil: { type: 'number', required: true },
                  },
                },
              },
            },
          },
          render: (_args, value) => [{ type: 'text', text: freeModelsText(value) }],
        },
        isConcurrencySafe: () => true,
        execute: async (args): Promise<FreeModelsToolValue> => {
          if (args.action === 'refresh') await this.refresh()
          const snapshot = this.snapshot()
          return {
            enabled: snapshot.enabled,
            hasCapacity: snapshot.hasCapacity,
            scannedAt: snapshot.scannedAt,
            models: snapshot.models.map(row => ({
              id: row.id,
              state: row.state,
              requestsRemainingToday: row.requestsRemainingToday,
              tokensRemainingToday: row.tokensRemainingToday,
              cooldownUntil: row.cooldownUntil,
            })),
          }
        },
        presentCall: args => ({
          card: 'generic',
          title: args.action === 'refresh' ? 'Free models: rescan' : 'Free models: status',
          kind: 'read',
        }),
      }))
    })
  }

  /** The resolved settings section. */
  private settings(): OpenRouterFreeConfig {
    return this.current()
  }

  /** The pool with each model's ledger attached at the current instant. */
  private pool(now: number): PooledModel[] {
    return this.entries.map(entry => ({
      entry,
      usage: this.ledger[entry.id] ?? emptyUsage(now),
    }))
  }

  /**
   * Current pool status. Cheap: it reads the last scan and the ledger, never the
   * network, so a caller may consult it before every delegation.
   * @returns the snapshot a caller needs to decide whether to start work.
   */
  snapshot(): FreePoolSnapshot {
    const settings = this.settings()
    const now = Date.now()
    const limits = limitsOf(settings)
    const pool = this.pool(now)
    return {
      enabled: settings.enabled && this.published === settings.providerRoute,
      scannedAt: this.scannedAt,
      models: pool.map(pooled => this.rowOf(pooled, limits, now)),
      hasCapacity: settings.enabled && hasCapacity(pool, limits, now),
      nextRecoveryAt: earliestRecovery(pool, now),
    }
  }

  /**
   * Whether the pool can hand out a lease right now.
   * @returns whether at least one pooled model has budget left.
   */
  available(): boolean {
    return this.snapshot().hasCapacity
  }

  /**
   * Reserve the next model to run on: the least-used selectable one.
   * @returns a lease to release when the attempt settles, or `undefined` when
   * the pool is disabled, empty, or fully spent — never a wait.
   */
  acquire(): FreeModelLease | undefined {
    const settings = this.settings()
    if (!settings.enabled || this.published !== settings.providerRoute) return undefined
    const now = Date.now()
    const limits = limitsOf(settings)
    const picked = selectModel(this.pool(now), limits, now)
    if (picked === undefined) return undefined
    const id = picked.entry.id
    this.ledger[id] = reserveRequest(picked.usage, now)
    void this.flush()
    let settled = false
    return {
      provider: settings.providerRoute,
      model: id,
      release: async (outcome) => {
        if (settled) return
        settled = true
        const at = Date.now()
        this.ledger[id] = applyOutcome(this.ledger[id] ?? emptyUsage(at), outcome, limits, at)
        await this.flush()
        await this.publishStatus()
      },
    }
  }

  /**
   * Scan the directory, publish the route, and report the pool. Concurrent
   * callers share one scan.
   * @returns after the scan settled, whether it succeeded or not.
   */
  refresh(): Promise<void> {
    if (this.scanning !== undefined) return this.scanning
    const scan = this.scan()
      .catch((error: unknown) => {
        this.ctx.logger.warn(`llm-openrouter-free: scan failed: ${error instanceof Error ? error.message : String(error)}`)
      })
      .finally(() => { this.scanning = undefined })
    this.scanning = scan
    return scan
  }

  /** One scan: fetch, filter, publish, report. */
  private async scan(): Promise<void> {
    const settings = this.settings()
    if (!settings.enabled) {
      await this.unpublish()
      await this.publishStatus()
      return
    }
    const url = `${settings.baseURL.replace(/\/+$/, '')}${MODELS_PATH}`
    const credentials = this.ctx.get('credentials')
    const key = credentials === undefined
      ? undefined
      : (await credentials.resolve(credentialRef(settings.apiKeyEnv)))?.value
    if (key === undefined || key === '') {
      throw new Error(
        `llm-openrouter-free: no API key under ${settings.apiKeyEnv}; set it in Settings → Models → OpenRouter Free`,
      )
    }
    const response = await fetch(url, {
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${key}`,
      },
      signal: AbortSignal.timeout(settings.requestTimeoutMs),
    })
    if (!response.ok) throw new Error(`the model directory answered HTTP ${String(response.status)}`)
    const payload: unknown = await response.json()
    const entries = parseFreeModels(payload, {
      minContextWindow: settings.minContextWindow,
      excludeModels: settings.excludeModels,
      maxModels: settings.maxModels,
      requireToolSupport: settings.requireToolSupport,
    })
    this.entries = entries
    this.scannedAt = Date.now()
    this.ctx.logger.info(
      'llm-openrouter-free: scan pooled %d free model(s) from %s',
      entries.length,
      url,
    )
    // Ledger rows for models that left the directory are dropped: the id may
    // come back with its quota genuinely reset, and a stale row would bench a
    // model the account just regained.
    const kept: Record<string, ModelUsage> = {}
    for (const entry of entries) {
      const usage = this.ledger[entry.id]
      if (usage !== undefined) kept[entry.id] = usage
    }
    this.ledger = kept
    await this.flush()
    await this.publishRoute(entries)
    await this.publishStatus()
  }

  /** Write the pool's status into its own settings section for configuration surfaces. */
  private async publishStatus(): Promise<void> {
    const settingsService = this.ctx.get('settings')
    if (settingsService === undefined) return
    const resolved = settingsService.get(SETTINGS_NS)
    if (resolved === undefined) return
    const current = resolved as OpenRouterFreeConfig
    const settings = this.settings()
    const now = Date.now()
    const limits = limitsOf(settings)
    const rows = this.pool(now).map(pooled => this.rowOf(pooled, limits, now))
    const statusStale = !deepEqualJson(current.status, rows)
    const scannedStale = current.scannedAt !== this.scannedAt
    if (!statusStale && !scannedStale) return
    try {
      await settingsService.mutate(SETTINGS_NS, [
        ...statusStale ? [{ op: 'set' as const, path: ['status'], value: rows }] : [],
        ...scannedStale ? [{ op: 'set' as const, path: ['scannedAt'], value: this.scannedAt }] : [],
      ])
    } catch (error: unknown) {
      this.ctx.logger.warn(`llm-openrouter-free: could not report pool status: ${String(error)}`)
    }
  }

  /** One model as a reported status row. */
  private rowOf(pooled: PooledModel, limits: BudgetLimits, now: number): OpenRouterFreeStatusRow {
    const usage = rollUsage(pooled.usage, now)
    return {
      id: pooled.entry.id,
      name: pooled.entry.name,
      contextLength: pooled.entry.contextLength,
      requestsUsedToday: usage.requestsToday,
      requestsRemainingToday: requestsRemaining(pooled, limits, now),
      tokensUsedToday: usage.tokensToday,
      tokensRemainingToday: tokensRemaining(pooled, limits, now),
      cooldownUntil: usage.cooldownUntil,
      state: stateOf(pooled, limits, now),
      ...usage.lastError === undefined ? {} : { lastError: usage.lastError },
    }
  }

  /**
   * Publish the pooled models as a `pi-ai` route profile, so the ordinary model
   * registry, the picker, and `agentOptions` all reach them by route and id.
   */
  private async publishRoute(entries: readonly FreeModelEntry[]): Promise<void> {
    const settings = this.settings()
    const settingsService = this.ctx.get('settings')
    if (settingsService === undefined) {
      this.ctx.logger.warn('llm-openrouter-free: no settings service; the free route was not published')
      return
    }
    if (settingsService.get(LLM_SETTINGS_NS) === undefined) {
      this.ctx.logger.warn('llm-openrouter-free: the llm-pi-ai namespace is absent; the free route was not published')
      return
    }
    if (this.published !== undefined && this.published !== settings.providerRoute) {
      await settingsService.mutate(LLM_SETTINGS_NS, [{ op: 'unset', path: ['providers', this.published] }])
      this.published = undefined
    }
    const [lead] = entries
    if (lead === undefined) {
      if (this.published !== undefined) {
        await settingsService.mutate(LLM_SETTINGS_NS, [{ op: 'unset', path: ['providers', this.published] }])
        this.published = undefined
      }
      this.ctx.logger.warn('llm-openrouter-free: the model directory yielded no free models; the route was withdrawn')
      return
    }
    const profile: PublishedRouteProfile = {
      displayName: 'OpenRouter (free)',
      api: 'openai-completions',
      baseURL: settings.baseURL,
      apiKeyEnv: settings.apiKeyEnv,
      headers: { ...ATTRIBUTION_HEADERS },
      defaultContextWindow: lead.contextLength,
      defaultMaxTokens: lead.maxTokens,
      models: entries.map(entry => ({
        id: entry.id,
        name: entry.name,
        contextWindow: entry.contextLength,
        maxTokens: entry.maxTokens,
        input: ['text'],
      })),
    }
    await settingsService.mutate(LLM_SETTINGS_NS, [
      { op: 'set', path: ['providers', settings.providerRoute], value: profile },
    ])
    this.published = settings.providerRoute
  }

  /** Withdraw the published route while the pool is disabled. */
  private async unpublish(): Promise<void> {
    const settingsService = this.ctx.get('settings')
    if (settingsService === undefined || this.published === undefined) return
    const route = this.published
    this.published = undefined
    this.entries = []
    this.scannedAt = 0
    try {
      await settingsService.mutate(LLM_SETTINGS_NS, [{ op: 'unset', path: ['providers', route] }])
    } catch (error: unknown) {
      this.ctx.logger.warn(`llm-openrouter-free: could not withdraw route "${route}": ${String(error)}`)
    }
  }

  /**
   * Apply the live settings. Only a change to the configuration fields may
   * schedule a scan: `status` is this service's own report, and reacting to it
   * would make every reported lease start a network scan.
   */
  private sync(): void {
    if (this.stopped) return
    const settings = this.settings()
    const configKey = JSON.stringify(settingsOf(settings))
    const changed = this.configKey !== configKey
    this.configKey = configKey
    if (!settings.enabled) {
      this.stopTimer()
      this.scheduleKey = undefined
      if (this.published !== undefined) void this.unpublish().then(() => this.publishStatus())
      else if (changed) void this.publishStatus()
      return
    }
    const key = `${String(settings.refreshMinutes)}|${settings.baseURL}|${settings.providerRoute}`
    if (this.scheduleKey !== key) {
      this.stopTimer()
      this.timer = setInterval(() => { void this.refresh() }, settings.refreshMinutes * 60_000)
      // A pending scan must never hold the host process open on its own.
      this.timer.unref()
      this.scheduleKey = key
    }
    if (changed || this.published === undefined) void this.refresh()
  }

  /** Stop the scan interval. */
  private stopTimer(): void {
    if (this.timer === undefined) return
    clearInterval(this.timer)
    this.timer = undefined
  }

  /** Persist the ledger behind the current write, so writes never interleave. */
  private flush(): Promise<void> {
    const snapshot = { ...this.ledger }
    this.persistTail = this.persistTail
      .catch(() => undefined)
      .then(() => saveLedger(snapshot))
      .catch((error: unknown) => {
        this.ctx.logger.warn(`llm-openrouter-free: could not persist the ledger: ${String(error)}`)
      })
    return this.persistTail
  }
}

export default OpenRouterFreePool
