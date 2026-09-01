import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SubagentRuntime from '../src/index.ts'
import { subagentActivityProjectionDefinition } from '../src/projection.ts'

function event(type: SessionEvent['type'], seq: number, data: object = {}): SessionEvent {
  return { type, seq, time: seq * 10, data } as SessionEvent
}

function fold(events: SessionEvent[]) {
  let state = subagentActivityProjectionDefinition.init()
  for (const item of events) state = subagentActivityProjectionDefinition.apply(state, item)
  return subagentActivityProjectionDefinition.view(state)
}

describe('subagent activity projection', () => {
  it('registers with the optional session projection registry', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    const serviceFiber = await ctx.plugin(SubagentRuntime)

    const before = ctx.sessionProjections.snapshot(ctx.sessions.create()).values
    expect(before.subagentActivity).toEqual({ status: 'idle', detail: '' })
    await serviceFiber.dispose()
    const after = ctx.sessionProjections.snapshot(ctx.sessions.create()).values
    expect(after.subagentActivity).toBeUndefined()
  })

  it('tracks turn and tool activity with the last tool name', () => {
    expect(fold([
      event('turn/start', 0),
      event('tool/call', 1, { name: 'pwsh' }),
    ])).toEqual({ status: 'running', detail: 'pwsh' })
  })

  it('shows a bounded, whitespace-collapsed reply snippet after an assembled message', () => {
    const long = 'x'.repeat(100)
    expect(fold([
      event('turn/start', 0),
      event('assistant/message', 1, {
        message: { content: [{ type: 'text', text: `  a\n\n${long}` }] },
      }),
    ])).toEqual({ status: 'running', detail: `a ${'x'.repeat(58)}` })
  })

  it('returns to idle at turn/end and stays a stable reference for unrelated events', () => {
    const initial = subagentActivityProjectionDefinition.init()
    // Unrelated events return the same state reference (no change-feed spam).
    expect(subagentActivityProjectionDefinition.apply(
      initial,
      event('assistant/chunk', 0),
    )).toBe(initial)
    const running = fold([
      event('turn/start', 0),
      event('tool/call', 1, { name: 'read' }),
    ])
    expect(running).toEqual({ status: 'running', detail: 'read' })
    // A repeated turn/start on an already-running state is a no-op reference.
    const rerun = subagentActivityProjectionDefinition.apply(
      subagentActivityProjectionDefinition.init(),
      event('turn/start', 0),
    )
    expect(subagentActivityProjectionDefinition.apply(
      rerun,
      event('turn/start', 1),
    )).toBe(rerun)
    expect(fold([
      event('turn/start', 0),
      event('tool/call', 1, { name: 'read' }),
      event('turn/end', 2),
    ])).toEqual({ status: 'idle', detail: '' })
  })
})
