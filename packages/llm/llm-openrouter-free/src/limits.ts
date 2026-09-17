/**
 * Per-model request and token budgets, and the rotation they drive.
 *
 * OpenRouter reports its free-tier exhaustion as a `429` on the request that
 * hits the ceiling, never as a quota object a client can read first, so the
 * pool keeps its own ledger: each selection reserves one request, each settled
 * lease records what the attempt cost, and a rate-limited lease benches that
 * model until its window turns over. Selection then walks the ledger and picks
 * the least-used selectable model, which is the whole rotation — one model
 * running dry moves the next task to the next model, and a caller never waits
 * on a model that has nothing left.
 *
 * Windows are UTC: OpenRouter resets the free daily allowance at midnight UTC,
 * and a local-midnight rollover would hold a model back for hours after its
 * quota returned.
 *
 * @module @deepseek-ai/dsh-llm-openrouter-free/limits
 */

import type { FreeModelEntry } from './catalog.ts'

/** Selectability of one pooled model. */
export type ModelState = 'ready' | 'cooling' | 'exhausted' | 'error'

/** Persisted usage ledger for one model id. */
export interface ModelUsage {
  /** UTC day key (`YYYY-MM-DD`) the daily counters belong to. */
  day: string
  /** UTC minute key (`YYYY-MM-DDTHH:mm`) the minute counter belongs to. */
  minute: string
  /** Requests reserved in the current day. */
  requestsToday: number
  /** Requests reserved in the current minute. */
  requestsMinute: number
  /** Tokens the pool was told this model spent today. */
  tokensToday: number
  /** Epoch milliseconds until which the model is benched, or 0. */
  cooldownUntil: number
  /** Consecutive failures reported for this model; cleared by a success. */
  failures: number
  /** Last failure message reported for this model. */
  lastError?: string
}

/** Budget and cadence fields one ledger update reads. */
export interface BudgetLimits {
  /** Requests per model per UTC minute. */
  requestsPerMinutePerModel: number
  /** Requests per model per UTC day. */
  requestsPerDayPerModel: number
  /** Tokens per model per UTC day; 0 disables the token limit. */
  tokensPerDayPerModel: number
}

/** One pooled model with its metadata and ledger together. */
export interface PooledModel {
  /** Directory metadata for the model. */
  entry: FreeModelEntry
  /** Usage ledger for the model. */
  usage: ModelUsage
}

/** What one settled lease reported about the attempt it ran. */
export type LeaseOutcome =
  | { kind: 'success'; tokens?: number }
  | { kind: 'rate-limited'; retryAfterMs?: number }
  | { kind: 'failure'; message: string }

/** Milliseconds in one UTC day; the fallback bench for a rate-limited model. */
const DAY_MS = 86_400_000

/** Failure count that benches a model for a short backoff instead of one task. */
const FAILURES_BEFORE_BACKOFF = 2

/** Backoff applied per consecutive failure once {@link FAILURES_BEFORE_BACKOFF} is reached. */
const BACKOFF_MS = 60_000

/**
 * UTC day key of one instant.
 * @param now - epoch milliseconds.
 * @returns `YYYY-MM-DD`.
 */
export function dayKey(now: number): string {
  return new Date(now).toISOString().slice(0, 10)
}

/**
 * UTC minute key of one instant.
 * @param now - epoch milliseconds.
 * @returns `YYYY-MM-DDTHH:mm`.
 */
export function minuteKey(now: number): string {
  return new Date(now).toISOString().slice(0, 16)
}

/**
 * Start of the next UTC day after one instant.
 * @param now - epoch milliseconds.
 * @returns epoch milliseconds of the next midnight UTC.
 */
export function nextUtcMidnight(now: number): number {
  const date = new Date(now)
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1)
}

/**
 * One model's fresh ledger at an instant.
 * @param now - epoch milliseconds.
 * @returns a zeroed ledger stamped with the current windows.
 */
export function emptyUsage(now: number): ModelUsage {
  return {
    day: dayKey(now),
    minute: minuteKey(now),
    requestsToday: 0,
    requestsMinute: 0,
    tokensToday: 0,
    cooldownUntil: 0,
    failures: 0,
  }
}

/**
 * Roll an existing ledger onto the current windows, clearing counters whose
 * window has turned over. A cooldown that has elapsed is cleared too, which is
 * what makes a benched model selectable again without a separate sweeper.
 * @param usage - ledger to roll forward.
 * @param now - epoch milliseconds.
 * @returns the rolled ledger (the input object when nothing changed).
 */
export function rollUsage(usage: ModelUsage, now: number): ModelUsage {
  const day = dayKey(now)
  const minute = minuteKey(now)
  const dayChanged = usage.day !== day
  const minuteChanged = usage.minute !== minute
  const cooling = usage.cooldownUntil > 0 && usage.cooldownUntil <= now
  if (!dayChanged && !minuteChanged && !cooling) return usage
  return {
    day,
    minute,
    requestsToday: dayChanged ? 0 : usage.requestsToday,
    requestsMinute: minuteChanged ? 0 : usage.requestsMinute,
    tokensToday: dayChanged ? 0 : usage.tokensToday,
    cooldownUntil: cooling ? 0 : usage.cooldownUntil,
    failures: usage.failures,
    ...usage.lastError === undefined ? {} : { lastError: usage.lastError },
  }
}

/**
 * Selectability of one model at an instant.
 * @param pooled - the model and its ledger.
 * @param limits - configured per-model budgets.
 * @param now - epoch milliseconds.
 * @returns the model's state.
 */
export function stateOf(pooled: PooledModel, limits: BudgetLimits, now: number): ModelState {
  const usage = rollUsage(pooled.usage, now)
  if (usage.cooldownUntil > now) return 'cooling'
  if (usage.requestsToday >= limits.requestsPerDayPerModel) return 'exhausted'
  if (usage.requestsMinute >= limits.requestsPerMinutePerModel) return 'cooling'
  if (limits.tokensPerDayPerModel > 0 && usage.tokensToday >= limits.tokensPerDayPerModel) return 'exhausted'
  return 'ready'
}

/**
 * Requests one model has left in the current UTC day.
 * @param pooled - the model and its ledger.
 * @param limits - configured per-model budgets.
 * @param now - epoch milliseconds.
 * @returns the remaining request count, never negative.
 */
export function requestsRemaining(pooled: PooledModel, limits: BudgetLimits, now: number): number {
  const usage = rollUsage(pooled.usage, now)
  return Math.max(0, limits.requestsPerDayPerModel - usage.requestsToday)
}

/**
 * Tokens one model has left in the current UTC day.
 * @param pooled - the model and its ledger.
 * @param limits - configured per-model budgets.
 * @param now - epoch milliseconds.
 * @returns the remaining token count, or 0 when no token budget is configured.
 */
export function tokensRemaining(pooled: PooledModel, limits: BudgetLimits, now: number): number {
  if (limits.tokensPerDayPerModel <= 0) return 0
  const usage = rollUsage(pooled.usage, now)
  return Math.max(0, limits.tokensPerDayPerModel - usage.tokensToday)
}

/**
 * Pick the next model to run on: the selectable one with the fewest requests
 * spent today, ties broken by tokens then by id so the choice is deterministic.
 * @param models - the whole pool.
 * @param limits - configured per-model budgets.
 * @param now - epoch milliseconds.
 * @returns the selected model, or `undefined` when none is selectable.
 */
export function selectModel(
  models: readonly PooledModel[],
  limits: BudgetLimits,
  now: number,
): PooledModel | undefined {
  let best: PooledModel | undefined
  let bestUsage: ModelUsage | undefined
  for (const pooled of models) {
    if (stateOf(pooled, limits, now) !== 'ready') continue
    const usage = rollUsage(pooled.usage, now)
    if (bestUsage === undefined
      || usage.requestsToday < bestUsage.requestsToday
      || (usage.requestsToday === bestUsage.requestsToday && usage.tokensToday < bestUsage.tokensToday)
      || (usage.requestsToday === bestUsage.requestsToday
        && usage.tokensToday === bestUsage.tokensToday
        && pooled.entry.id.localeCompare(best?.entry.id ?? pooled.entry.id) < 0)) {
      best = pooled
      bestUsage = usage
    }
  }
  return best
}

/**
 * Reserve one request on a model's ledger. Reservation happens at selection,
 * before the attempt, so two leases handed out in the same instant cannot both
 * read the last remaining request.
 * @param usage - ledger to charge.
 * @param now - epoch milliseconds.
 * @returns the charged ledger.
 */
export function reserveRequest(usage: ModelUsage, now: number): ModelUsage {
  const rolled = rollUsage(usage, now)
  return { ...rolled, requestsToday: rolled.requestsToday + 1, requestsMinute: rolled.requestsMinute + 1 }
}

/**
 * Apply one settled lease to a model's ledger.
 * @param usage - ledger to update.
 * @param outcome - what the attempt reported.
 * @param limits - configured per-model budgets.
 * @param now - epoch milliseconds.
 * @returns the updated ledger.
 */
export function applyOutcome(
  usage: ModelUsage,
  outcome: LeaseOutcome,
  limits: BudgetLimits,
  now: number,
): ModelUsage {
  const rolled = rollUsage(usage, now)
  switch (outcome.kind) {
    case 'success': {
      const { lastError: _cleared, ...rest } = rolled
      return {
        ...rest,
        tokensToday: rolled.tokensToday + Math.max(0, Math.floor(outcome.tokens ?? 0)),
        failures: 0,
      }
    }
    case 'rate-limited': {
      const retryAfter = outcome.retryAfterMs === undefined ? 60_000 : Math.max(0, outcome.retryAfterMs)
      const until = now + retryAfter
      const minuteExhausted = retryAfter < 3_600_000
      return {
        ...rolled,
        ...minuteExhausted
          ? { requestsMinute: Math.max(rolled.requestsMinute, limits.requestsPerMinutePerModel) }
          : { requestsToday: Math.max(rolled.requestsToday, limits.requestsPerDayPerModel) },
        cooldownUntil: until,
        failures: rolled.failures + 1,
        lastError: 'rate limited by OpenRouter',
      }
    }
    case 'failure': {
      const failures = rolled.failures + 1
      return {
        ...rolled,
        failures,
        cooldownUntil: failures >= FAILURES_BEFORE_BACKOFF ? now + BACKOFF_MS * failures : rolled.cooldownUntil,
        lastError: outcome.message,
      }
    }
    /* v8 ignore next -- closed union over the lease-outcome vocabulary */
    default: {
      const _exhaustive: never = outcome
      return _exhaustive
    }
  }
}

/**
 * Whether any model in the pool can take a task right now.
 * @param models - the whole pool.
 * @param limits - configured per-model budgets.
 * @param now - epoch milliseconds.
 * @returns whether at least one model is selectable.
 */
export function hasCapacity(models: readonly PooledModel[], limits: BudgetLimits, now: number): boolean {
  return models.some(pooled => stateOf(pooled, limits, now) === 'ready')
}

/**
 * Epoch milliseconds until the earliest benched model becomes selectable again.
 * @param models - the whole pool.
 * @param now - epoch milliseconds.
 * @returns the earliest wait, or 0 when no model is cooling.
 */
export function earliestRecovery(models: readonly PooledModel[], now: number): number {
  let earliest = 0
  for (const pooled of models) {
    const until = pooled.usage.cooldownUntil
    if (until <= now) continue
    if (earliest === 0 || until < earliest) earliest = until
  }
  return earliest
}

/** Milliseconds in one UTC day, exported for callers reasoning about the daily window. */
export const UTC_DAY_MS = DAY_MS
