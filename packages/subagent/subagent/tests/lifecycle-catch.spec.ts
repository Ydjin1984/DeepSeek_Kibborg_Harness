/**
 * Regression tests for observeRun error handling (review finding B4a#1).
 *
 * Verify that observeRun does not swallow rejection errors and that
 * lifecycle listener rejections are logged (not swallowed silently).
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import { createLifecycleEmitter, observeRun } from '../src/lifecycle.ts'
import type { SubagentRun, SubagentRunEndInfo, SubagentRunInfo } from '../src/types.ts'

/** A listener stub receives the emitted info payload (start or end edge). */
type EdgePayload = SubagentRunInfo | SubagentRunEndInfo

function ctxWithListenerCapture(emitted: Array<{ name: string; stopReason?: string }>): Context {
  const ctx = new Context()
  // The emitter dispatches to the 'emit' channel; capture every edge it pushes.
  ctx.events.dispatch = (() => {
    return [(payload: EdgePayload) => emitted.push({
      name: 'stopReason' in payload ? 'end' : 'start',
      stopReason: 'stopReason' in payload ? payload.stopReason : undefined,
    })]
  }) as unknown as Context['events']['dispatch']
  return ctx
}

/** Minimal parent stand-in: observeRun only passes it to the carrier for dispatch args. */
const parent = {} as unknown as Agent

/** Build a run whose result rejects with the given reason. */
function rejectingRun(id: string, rejection: unknown): SubagentRun {
  return {
    id: SessionId(id),
    result: Promise.reject(rejection),
    localAgent: undefined,
    dispose: async () => {},
  }
}

describe('observeRun error propagation', () => {
  it('emits subagent/end with error when run.result rejects', async () => {
    const emitted: Array<{ name: string; stopReason?: string }> = []
    const ctx = ctxWithListenerCapture(emitted)
    const emitter = createLifecycleEmitter(ctx, (_agent: Agent) => ({}))

    observeRun(emitter, 'test-provider', parent, rejectingRun('child-1', new Error('transport gone')))

    // start is emitted synchronously
    const start = emitted.find(e => e.name === 'start')
    expect(start).toBeDefined()

    // wait for result settlement
    await new Promise(resolve => setTimeout(resolve, 0))

    const end = emitted.find(e => e.name === 'end')
    expect(end).toBeDefined()
    expect(end!.stopReason).toBe('error')
  })

  it('listener rejection is logged, not swallowed', async () => {
    const warnMessages: string[] = []
    const ctx = new Context()
    ctx.logger = { warn: (message: string) => warnMessages.push(message) } as unknown as Context['logger']
    ctx.events.dispatch = (() => {
      return [
        () => { throw new Error('listener boom') },
      ]
    }) as unknown as Context['events']['dispatch']
    const emitter = createLifecycleEmitter(ctx, (_agent: Agent) => ({}))

    // Should not throw — synchronous throw is caught by try/catch
    expect(() => emitter('subagent/provider-removed', 'my-provider')).not.toThrow()

    expect(warnMessages.length).toBe(1)
    expect(warnMessages[0]).toContain('subagent: subagent/provider-removed listener threw')
    expect(warnMessages[0]).toContain('Error: listener boom')
  })

  it('observeRun does not swallow non-standard error codes', async () => {
    const emitted: Array<{ name: string; stopReason?: string }> = []
    const ctx = ctxWithListenerCapture(emitted)
    const emitter = createLifecycleEmitter(ctx, (_agent: Agent) => ({}))

    observeRun(emitter, 'test-provider', parent, rejectingRun('child-err', new TypeError('unexpected')))

    await new Promise(resolve => setTimeout(resolve, 0))

    const end = emitted.find(e => e.name === 'end')
    expect(end?.stopReason).toBe('error')
  })
})
