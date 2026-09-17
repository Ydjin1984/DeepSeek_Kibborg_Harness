import { describe, expect, it } from 'vitest'
import {
  applyOutcome, earliestRecovery, emptyUsage, hasCapacity, requestsRemaining,
  reserveRequest, rollUsage, selectModel, stateOf, tokensRemaining,
} from '../src/limits.ts'
import type { BudgetLimits, ModelUsage, PooledModel } from '../src/limits.ts'

const LIMITS: BudgetLimits = {
  requestsPerMinutePerModel: 2,
  requestsPerDayPerModel: 3,
  tokensPerDayPerModel: 0,
}

/** One instant inside a fixed UTC day, so window math never depends on the clock. */
const NOON = Date.UTC(2026, 0, 15, 12, 0, 0)

/** Build one pooled model with a ledger derived from a base usage. */
function model(id: string, usage: ModelUsage = emptyUsage(NOON)): PooledModel {
  return { entry: { id, name: id, contextLength: 100_000, maxTokens: 8_192, supportsTools: true }, usage }
}

describe('free-model budgets', () => {
  it('resets the daily and minute counters when their windows turn over', () => {
    const charged = reserveRequest(emptyUsage(NOON), NOON)
    const nextMinute = rollUsage(charged, NOON + 60_000)
    expect(nextMinute.requestsToday).toBe(1)
    expect(nextMinute.requestsMinute).toBe(0)
    const nextDay = rollUsage(nextMinute, NOON + 86_400_000)
    expect(nextDay.requestsToday).toBe(0)
  })

  it('clears an elapsed cooldown on the read that follows it', () => {
    const benched: ModelUsage = { ...emptyUsage(NOON), cooldownUntil: NOON + 1_000 }
    expect(stateOf(model('a', benched), LIMITS, NOON)).toBe('cooling')
    expect(stateOf(model('a', benched), LIMITS, NOON + 1_001)).toBe('ready')
  })

  it('separates an exhausted daily budget from a minute-rate bench', () => {
    const spentDay: ModelUsage = { ...emptyUsage(NOON), requestsToday: 3 }
    expect(stateOf(model('a', spentDay), LIMITS, NOON)).toBe('exhausted')
    const spentMinute: ModelUsage = { ...emptyUsage(NOON), requestsToday: 1, requestsMinute: 2 }
    expect(stateOf(model('b', spentMinute), LIMITS, NOON)).toBe('cooling')
  })

  it('reports remaining requests and tokens against the configured budgets', () => {
    const pooled = model('a', { ...emptyUsage(NOON), requestsToday: 1, tokensToday: 400 })
    expect(requestsRemaining(pooled, LIMITS, NOON)).toBe(2)
    expect(tokensRemaining(pooled, LIMITS, NOON)).toBe(0)
    const metered = { ...LIMITS, tokensPerDayPerModel: 1_000 }
    expect(tokensRemaining(pooled, metered, NOON)).toBe(600)
  })
})

describe('rotation across the pool', () => {
  it('picks the least-used model and moves on once it is spent', () => {
    const first = model('a')
    const second = model('b', { ...emptyUsage(NOON), requestsToday: 1 })
    expect(selectModel([first, second], LIMITS, NOON)?.entry.id).toBe('a')
    const used = model('a', { ...emptyUsage(NOON), requestsToday: 3 })
    expect(selectModel([used, second], LIMITS, NOON)?.entry.id).toBe('b')
    const both = model('b', { ...emptyUsage(NOON), requestsToday: 3 })
    expect(selectModel([used, both], LIMITS, NOON)).toBeUndefined()
    expect(hasCapacity([used, both], LIMITS, NOON)).toBe(false)
  })

  it('breaks ties by tokens then by id, so the choice is deterministic', () => {
    const heavy = model('b', { ...emptyUsage(NOON), requestsToday: 1, tokensToday: 900 })
    const light = model('a', { ...emptyUsage(NOON), requestsToday: 1, tokensToday: 10 })
    expect(selectModel([heavy, light], LIMITS, NOON)?.entry.id).toBe('a')
    const sameA = model('a', { ...emptyUsage(NOON), requestsToday: 1 })
    const sameB = model('b', { ...emptyUsage(NOON), requestsToday: 1 })
    expect(selectModel([sameB, sameA], LIMITS, NOON)?.entry.id).toBe('a')
  })

  it('reserves one request per selection so concurrent leases cannot overdraw', () => {
    const picked = model('a')
    const reserved = reserveRequest(picked.usage, NOON)
    expect(reserved.requestsToday).toBe(1)
    expect(reserved.requestsMinute).toBe(1)
    const twice = reserveRequest(reserved, NOON)
    expect(twice.requestsToday).toBe(2)
    expect(selectModel([{ ...picked, usage: twice }], LIMITS, NOON)).toBeUndefined()
  })

  it('benches a short rate limit as a minute cooldown, not a spent day', () => {
    const usage = applyOutcome(emptyUsage(NOON), { kind: 'rate-limited' }, LIMITS, NOON)
    expect(usage.requestsMinute).toBe(LIMITS.requestsPerMinutePerModel)
    expect(usage.requestsToday).toBe(0)
    expect(usage.cooldownUntil).toBe(NOON + 60_000)
    const pooled = model('a', usage)
    expect(stateOf(pooled, LIMITS, NOON)).toBe('cooling')
    expect(earliestRecovery([pooled], NOON)).toBe(NOON + 60_000)
    expect(stateOf(pooled, LIMITS, NOON + 60_001)).toBe('ready')
  })

  it('treats a long retry-after as a daily exhaustion', () => {
    const usage = applyOutcome(emptyUsage(NOON), { kind: 'rate-limited', retryAfterMs: 90_000_000 }, LIMITS, NOON)
    expect(usage.requestsToday).toBe(LIMITS.requestsPerDayPerModel)
    expect(usage.cooldownUntil).toBe(NOON + 90_000_000)
  })

  it('counts reported tokens on success and clears the failure record', () => {
    const failed = applyOutcome(emptyUsage(NOON), { kind: 'failure', message: 'boom' }, LIMITS, NOON)
    expect(failed.failures).toBe(1)
    expect(failed.lastError).toBe('boom')
    const recovered = applyOutcome(failed, { kind: 'success', tokens: 1_234 }, LIMITS, NOON)
    expect(recovered.tokensToday).toBe(1_234)
    expect(recovered.failures).toBe(0)
    expect(recovered.lastError).toBeUndefined()
  })

  it('backs a repeatedly failing model off instead of retrying it forever', () => {
    const limits = { ...LIMITS, requestsPerDayPerModel: 100 }
    let usage = emptyUsage(NOON)
    usage = applyOutcome(usage, { kind: 'failure', message: 'one' }, limits, NOON)
    expect(usage.cooldownUntil).toBe(0)
    usage = applyOutcome(usage, { kind: 'failure', message: 'two' }, limits, NOON)
    expect(usage.cooldownUntil).toBeGreaterThan(NOON)
    expect(stateOf(model('a', usage), limits, NOON)).toBe('cooling')
  })

  it('reports no recovery when nothing is benched', () => {
    expect(earliestRecovery([model('a'), model('b')], NOON)).toBe(0)
  })
})
