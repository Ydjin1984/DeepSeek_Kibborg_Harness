/**
 * `compaction` session projection unit: the browser-safe policy and lock
 * status fold (auto flag, per-route threshold ratio, in-flight bracket).
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { CompactionId } from '@deepseek-ai/dsh-compaction'
import type { CompactionProjection } from '@deepseek-ai/dsh-compaction/client'
import { resolveConfig } from '../src/config.ts'
import { compactProjectionDefinition } from '../src/projection.ts'

async function harness(config: Record<string, unknown> = {}): Promise<{ ctx: Context; session: Session }> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  ctx.sessionProjections.register(compactProjectionDefinition(resolveConfig(config)))
  return { ctx, session: ctx.sessions.create() }
}

function projected(ctx: Context, session: Session): CompactionProjection {
  const value = ctx.sessionProjections.snapshot(session).values.compaction
  if (value === undefined) throw new Error('compaction projection is not registered')
  return value
}

const ID = CompactionId('test-compaction')
const start = (session: Session): void => {
  session.append('compaction/start', { compactionId: ID, turn: null })
}
const end = (session: Session): void => {
  session.append('compaction/end', { compactionId: ID, turn: null })
}
const route = (session: Session, provider = 'deepseek', model = 'deepseek-chat'): void => {
  session.append('request/context', { provider, model, contextWindow: 128_000 })
}

describe('compaction projection', () => {
  it('starts with auto from config and no threshold before a route is known', async () => {
    const { ctx, session } = await harness({ thresholdRatio: 0.75 })
    expect(projected(ctx, session)).toEqual({ auto: true, active: false })
  })

  it('publishes the default threshold ratio once a route is logged', async () => {
    const { ctx, session } = await harness({ thresholdRatio: 0.75 })
    route(session)
    expect(projected(ctx, session)).toEqual({ auto: true, thresholdRatio: 0.75, active: false })
  })

  it('resolves an exact modelPolicies override and falls back to the default for other routes', async () => {
    const { ctx, session } = await harness({
      thresholdRatio: 0.75,
      modelPolicies: [
        { provider: 'deepseek', model: 'deepseek-chat', thresholdRatio: 0.6 },
      ],
    })
    route(session, 'deepseek', 'deepseek-chat')
    expect(projected(ctx, session).thresholdRatio).toBe(0.6)
    route(session, 'other', 'model')
    expect(projected(ctx, session).thresholdRatio).toBe(0.75)
  })

  it('tracks the in-flight compaction bracket', async () => {
    const { ctx, session } = await harness()
    start(session)
    expect(projected(ctx, session).active).toBe(true)
    end(session)
    expect(projected(ctx, session).active).toBe(false)
  })

  it('clears a stale unmatched start when a new lifecycle seed lands', async () => {
    const { ctx, session } = await harness()
    start(session)
    session.append('session/end-seed', {})
    expect(projected(ctx, session).active).toBe(false)
  })

  it('reports auto: false from configuration', async () => {
    const { ctx, session } = await harness({ auto: false })
    route(session)
    expect(projected(ctx, session)).toEqual({ auto: false, thresholdRatio: 0.8, active: false })
  })

  it('keeps an already-in-flight bracket when another compaction/start lands', async () => {
    const { ctx, session } = await harness()
    start(session)
    const before = projected(ctx, session)
    start(session)
    expect(projected(ctx, session)).toEqual(before)
  })

  it('ignores a compaction/end with no in-flight bracket', async () => {
    const { ctx, session } = await harness()
    end(session)
    expect(projected(ctx, session).active).toBe(false)
  })

  it('ignores a session/end-seed with no stale unmatched start', async () => {
    const { ctx, session } = await harness()
    session.append('session/end-seed', {})
    expect(projected(ctx, session).active).toBe(false)
  })

  it('keeps the resolved ratio when the same route is logged again', async () => {
    const { ctx, session } = await harness({ thresholdRatio: 0.75 })
    route(session)
    const before = projected(ctx, session)
    route(session)
    expect(projected(ctx, session)).toEqual(before)
  })

  it('ignores unrelated events', async () => {
    const { ctx, session } = await harness({ thresholdRatio: 0.75 })
    session.append('session/title', { title: 'ignored', messageSeqs: [], source: { kind: 'user' } })
    expect(projected(ctx, session)).toEqual({ auto: true, active: false })
  })
})
