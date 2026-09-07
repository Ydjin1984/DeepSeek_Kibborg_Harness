/**
 * Tests for `registerSubagentExecutionAdapter` and `projectSubagentEvent`: projection
 * of `subagent/start` and `subagent/end` Cordis events into the unified execution
 * state machine via `ctx.executions`.
 *
 * Coverage goals: every branch of `stopReasonEvent`, the registration /
 * transition flow in `projectSubagentStart` / `projectSubagentEnd` /
 * `projectSubagentEvent`, disposer teardown, the missing-service guard,
 * catch paths for register/throws, first-sight terminal, delayed register
 * (adapter starts after `subagent/start`), non-relevant events ignored,
 * idempotency of first-sight, and exhaustive stopReason mapping.
 * @module @deepseek-ai/dsh-subagent/execution-adapter.spec
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SubagentRunId } from '../src/types.ts'
import type { SubagentRunEndInfo, SubagentRunInfo, SubagentStopReason } from '../src/types.ts'
import type { ExecutionEventTypeCode } from '@deepseek-ai/dsh-execution'
import { projectSubagentEvent, registerSubagentExecutionAdapter } from '../src/execution-adapter.ts'
import type { ExecutionSurface } from '../src/execution-adapter.ts'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a fake execution surface that records calls and can throw on demand. */
function createFakeExecutions(): ExecutionSurface & {
  setThrowRegister(v: boolean): void
  setThrowTransition(v: boolean): void
  setThrowTransitionOnce(v: boolean): void
  resetCalls(): void
  getCalls(): Array<{ kind: string; executionId: string; event?: ExecutionEventTypeCode }>
} {
  const calls: Array<{ kind: string; executionId: string; event?: ExecutionEventTypeCode }> = []
  let throwRegister = false
  let throwTransition = false
  let throwTransitionOnce = false

  const fake: ExecutionSurface & {
    setThrowRegister(v: boolean): void
    setThrowTransition(v: boolean): void
    setThrowTransitionOnce(v: boolean): void
    resetCalls(): void
    getCalls(): typeof calls
  } = {
    register(kind: string, executionId: string): unknown {
      if (throwRegister) throw new Error('register already exists')
      calls.push({ kind, executionId })
      return undefined
    },
    transition(executionId: string, eventCode: ExecutionEventTypeCode): unknown {
      if (throwTransitionOnce) {
        throwTransitionOnce = false
        throw new Error('transition already terminal')
      }
      if (throwTransition) throw new Error('transition blocked')
      calls.push({ kind: 'transition', executionId, event: eventCode })
      return undefined
    },
    setThrowRegister(v: boolean) { throwRegister = v },
    setThrowTransition(v: boolean) { throwTransition = v },
    setThrowTransitionOnce(v: boolean) { throwTransitionOnce = v },
    resetCalls() { calls.length = 0 },
    getCalls() { return [...calls] },
  }

  return fake
}

/** Build a minimal SubagentRunInfo for testing. */
function subagentRunInfo(id: string): SubagentRunInfo {
  return {
    runId: SubagentRunId(id),
    provider: 'test-provider',
    id: id as never,
    local: false,
  }
}

/** Build a SubagentRunEndInfo for testing. */
function subagentEndInfo(id: string, stopReason: SubagentStopReason): SubagentRunEndInfo {
  return {
    runId: SubagentRunId(id),
    provider: 'test-provider',
    id: id as never,
    local: false,
    stopReason,
  }
}

// ---------------------------------------------------------------------------
// projectSubagentEvent tests
// ---------------------------------------------------------------------------

describe('projectSubagentEvent', () => {
  describe('non-relevant events', () => {
    it('ignores events other than subagent/start and subagent/end', () => {
      const fake = createFakeExecutions()
      projectSubagentEvent(fake, 'subagent/phase', subagentRunInfo('run-1'))
      expect(fake.getCalls()).toHaveLength(0)
    })

    it('subagent/end without result is a no-op', () => {
      const fake = createFakeExecutions()
      projectSubagentEvent(fake, 'subagent/end', subagentRunInfo('run-1'), undefined)
      expect(fake.getCalls()).toHaveLength(0)
    })
  })

  describe('subagent/start', () => {
    it('first start → register + start', () => {
      const fake = createFakeExecutions()
      projectSubagentEvent(fake, 'subagent/start', subagentRunInfo('run-1'))
      const calls = fake.getCalls()
      expect(calls).toHaveLength(2)
      expect(calls[0]).toEqual({ kind: 'subagent', executionId: 'subagent:run-1' })
      expect(calls[1]).toEqual({ kind: 'transition', executionId: 'subagent:run-1', event: 'start' })
    })

    it('duplicate start → no extra transitions (idempotent)', () => {
      const fake = createFakeExecutions()
      projectSubagentEvent(fake, 'subagent/start', subagentRunInfo('run-1'))
      fake.resetCalls()

      projectSubagentEvent(fake, 'subagent/start', subagentRunInfo('run-1'))
      expect(fake.getCalls()).toHaveLength(0)
    })
  })

  describe('subagent/end — completed', () => {
    it('end completed → register + complete', () => {
      const fake = createFakeExecutions()
      // No prior start — adapter must register on first sight of terminal.
      projectSubagentEvent(fake, 'subagent/end', subagentRunInfo('run-1'), { stopReason: 'completed' })
      const calls = fake.getCalls()
      expect(calls).toHaveLength(2)
      expect(calls[0]).toEqual({ kind: 'subagent', executionId: 'subagent:run-1' })
      expect(calls[1]).toEqual({ kind: 'transition', executionId: 'subagent:run-1', event: 'complete' })
    })

    it('end completed after start → only complete (start already done)', () => {
      const fake = createFakeExecutions()
      projectSubagentEvent(fake, 'subagent/start', subagentRunInfo('run-1'))
      fake.resetCalls()

      projectSubagentEvent(fake, 'subagent/end', subagentRunInfo('run-1'), { stopReason: 'completed' })
      const calls = fake.getCalls()
      expect(calls).toHaveLength(1)
      expect(calls[0]).toEqual({ kind: 'transition', executionId: 'subagent:run-1', event: 'complete' })
    })
  })

  describe('subagent/end — aborted', () => {
    it('end aborted → register + abort', () => {
      const fake = createFakeExecutions()
      projectSubagentEvent(fake, 'subagent/end', subagentRunInfo('run-1'), { stopReason: 'aborted' })
      const calls = fake.getCalls()
      expect(calls).toHaveLength(2)
      expect(calls[0]).toEqual({ kind: 'subagent', executionId: 'subagent:run-1' })
      expect(calls[1]).toEqual({ kind: 'transition', executionId: 'subagent:run-1', event: 'abort' })
    })
  })

  describe('subagent/end — error', () => {
    it('end error → register + fail', () => {
      const fake = createFakeExecutions()
      projectSubagentEvent(fake, 'subagent/end', subagentRunInfo('run-1'), { stopReason: 'error' })
      const calls = fake.getCalls()
      expect(calls).toHaveLength(2)
      expect(calls[0]).toEqual({ kind: 'subagent', executionId: 'subagent:run-1' })
      expect(calls[1]).toEqual({ kind: 'transition', executionId: 'subagent:run-1', event: 'fail' })
    })
  })

  describe('subagent/end — max-tokens', () => {
    it('end max-tokens → register + fail', () => {
      const fake = createFakeExecutions()
      projectSubagentEvent(fake, 'subagent/end', subagentRunInfo('run-1'), { stopReason: 'max-tokens' })
      const calls = fake.getCalls()
      expect(calls).toHaveLength(2)
      expect(calls[0]).toEqual({ kind: 'subagent', executionId: 'subagent:run-1' })
      expect(calls[1]).toEqual({ kind: 'transition', executionId: 'subagent:run-1', event: 'fail' })
    })
  })

  describe('subagent/end — refusal', () => {
    it('end refusal → register + fail', () => {
      const fake = createFakeExecutions()
      projectSubagentEvent(fake, 'subagent/end', subagentRunInfo('run-1'), { stopReason: 'refusal' })
      const calls = fake.getCalls()
      expect(calls).toHaveLength(2)
      expect(calls[0]).toEqual({ kind: 'subagent', executionId: 'subagent:run-1' })
      expect(calls[1]).toEqual({ kind: 'transition', executionId: 'subagent:run-1', event: 'fail' })
    })
  })

  describe('subagent/end — fallback start when not RUNNING', () => {
    it('end (no prior start) → register + complete succeeds directly', () => {
      const fake = createFakeExecutions()
      projectSubagentEvent(fake, 'subagent/end', subagentRunInfo('run-1'), { stopReason: 'completed' })
      const calls = fake.getCalls()
      expect(calls).toContainEqual({ kind: 'transition', executionId: 'subagent:run-1', event: 'complete' })
    })

    it('end (no prior start) but complete throws → start + complete', () => {
      const fake = createFakeExecutions()
      fake.setThrowTransitionOnce(true) // first complete call throws

      projectSubagentEvent(fake, 'subagent/end', subagentRunInfo('run-1'), { stopReason: 'completed' })
      const calls = fake.getCalls()
      expect(calls).toContainEqual({ kind: 'subagent', executionId: 'subagent:run-1' })
      // complete threw → fallback: start then complete
      expect(calls).toContainEqual({ kind: 'transition', executionId: 'subagent:run-1', event: 'start' })
      expect(calls).toContainEqual({ kind: 'transition', executionId: 'subagent:run-1', event: 'complete' })
    })
  })

  describe('catch — register throws', () => {
    it('register throws → transition still sent', () => {
      const fake = createFakeExecutions()
      fake.setThrowRegister(true)
      projectSubagentEvent(fake, 'subagent/start', subagentRunInfo('run-1'))
      const calls = fake.getCalls()
      expect(calls).toHaveLength(1)
      expect(calls[0]).toEqual({ kind: 'transition', executionId: 'subagent:run-1', event: 'start' })
    })

    it('register throws on end → transition still sent', () => {
      const fake = createFakeExecutions()
      fake.setThrowRegister(true)
      projectSubagentEvent(fake, 'subagent/end', subagentRunInfo('run-1'), { stopReason: 'completed' })
      const calls = fake.getCalls()
      expect(calls).toHaveLength(1)
      expect(calls[0]).toEqual({ kind: 'transition', executionId: 'subagent:run-1', event: 'complete' })
    })
  })

  describe('catch — transition throws', () => {
    it('start transition throws → adapter does not propagate', () => {
      const fake = createFakeExecutions()
      fake.setThrowTransition(true)
      projectSubagentEvent(fake, 'subagent/start', subagentRunInfo('run-1'))
      const calls = fake.getCalls()
      expect(calls).toHaveLength(1)
      expect(calls[0]).toEqual({ kind: 'subagent', executionId: 'subagent:run-1' })
    })

    it('end transition throws → fallback start+end', () => {
      const fake = createFakeExecutions()
      fake.setThrowTransitionOnce(true) // first call throws, second succeeds
      projectSubagentEvent(fake, 'subagent/end', subagentRunInfo('run-1'), { stopReason: 'completed' })
      const calls = fake.getCalls()
      // register succeeded, complete threw (consumed), fallback start+complete sent
      expect(calls).toContainEqual({ kind: 'subagent', executionId: 'subagent:run-1' })
      expect(calls).toContainEqual({ kind: 'transition', executionId: 'subagent:run-1', event: 'start' })
      expect(calls).toContainEqual({ kind: 'transition', executionId: 'subagent:run-1', event: 'complete' })
    })

    it('both end and fallback start throw → adapter does not propagate', () => {
      const fake = createFakeExecutions()
      fake.setThrowTransition(true)
      projectSubagentEvent(fake, 'subagent/end', subagentRunInfo('run-1'), { stopReason: 'completed' })
      const calls = fake.getCalls()
      // register succeeded, complete threw, start also throws (catch)
      expect(calls).toHaveLength(1)
      expect(calls[0]).toEqual({ kind: 'subagent', executionId: 'subagent:run-1' })
    })
  })

  describe('multiple runs', () => {
    it('two different runs → both projected independently', () => {
      const fake = createFakeExecutions()
      projectSubagentEvent(fake, 'subagent/start', subagentRunInfo('run-a'))
      projectSubagentEvent(fake, 'subagent/start', subagentRunInfo('run-b'))
      const calls = fake.getCalls()
      expect(calls).toHaveLength(4)
      expect(calls[0]).toEqual({ kind: 'subagent', executionId: 'subagent:run-a' })
      expect(calls[1]).toEqual({ kind: 'transition', executionId: 'subagent:run-a', event: 'start' })
      expect(calls[2]).toEqual({ kind: 'subagent', executionId: 'subagent:run-b' })
      expect(calls[3]).toEqual({ kind: 'transition', executionId: 'subagent:run-b', event: 'start' })
    })
  })

  describe('stopReasonEvent — exhaustive mapping', () => {
    it.each([
      { stopReason: 'completed' as const, expectedEvent: 'complete' as const },
      { stopReason: 'aborted' as const, expectedEvent: 'abort' as const },
      { stopReason: 'error' as const, expectedEvent: 'fail' as const },
      { stopReason: 'max-tokens' as const, expectedEvent: 'fail' as const },
      { stopReason: 'refusal' as const, expectedEvent: 'fail' as const },
    ])('stopReason "$stopReason" → "$expectedEvent"', ({ stopReason, expectedEvent }) => {
      const fake = createFakeExecutions()
      projectSubagentEvent(fake, 'subagent/end', subagentRunInfo('run-x'), { stopReason })
      const calls = fake.getCalls()
      expect(calls).toHaveLength(2)
      expect(calls[0]).toEqual({ kind: 'subagent', executionId: 'subagent:run-x' })
      expect(calls[1]).toEqual({ kind: 'transition', executionId: 'subagent:run-x', event: expectedEvent })
    })
  })
})

// ---------------------------------------------------------------------------
// registerSubagentExecutionAdapter tests (integration)
// ---------------------------------------------------------------------------

describe('registerSubagentExecutionAdapter', () => {
  describe('basic wiring', () => {
    it('returns a disposer that unregisters the subagent/start and subagent/end listeners', () => {
      const fake = createFakeExecutions()
      const ctx = new Context()
      ctx.provide('executions', fake)

      const dispose = registerSubagentExecutionAdapter(ctx)

      // Before dispose — process events
      ctx.emit('subagent/start', subagentRunInfo('run-1'))
      expect(fake.getCalls()).toHaveLength(2) // register + start

      const beforeDisposeCalls = fake.getCalls()

      dispose()

      // After dispose — the adapter listeners are unregistered.
      ctx.emit('subagent/start', subagentRunInfo('run-2'))
      expect(fake.getCalls()).toEqual(beforeDisposeCalls) // no new calls
    })

    it('subagent/start + end → register + start + complete via ctx.emit', () => {
      const fake = createFakeExecutions()
      const ctx = new Context()
      ctx.provide('executions', fake)

      registerSubagentExecutionAdapter(ctx)

      ctx.emit('subagent/start', subagentRunInfo('run-1'))
      fake.resetCalls()
      ctx.emit('subagent/end', subagentEndInfo('run-1', 'completed'))

      const calls = fake.getCalls()
      expect(calls).toHaveLength(1)
      expect(calls[0]).toEqual({ kind: 'transition', executionId: 'subagent:run-1', event: 'complete' })
    })

    it('does not register executions when service is absent', () => {
      const ctx = new Context()
      // No executions provided
      registerSubagentExecutionAdapter(ctx)

      ctx.emit('subagent/start', subagentRunInfo('run-1'))
      // ctx.get('executions') returns undefined → early return
    })

    it('subagent/end without executions → early return on ctx.get', () => {
      const ctx = new Context()
      registerSubagentExecutionAdapter(ctx)
      ctx.emit('subagent/end', subagentEndInfo('run-1', 'completed'))
      // No executions → adapter callback returns early
    })
  })

  describe('disposer', () => {
    it('disposer removes both listeners', () => {
      const fake = createFakeExecutions()
      const ctx = new Context()
      ctx.provide('executions', fake)

      const dispose = registerSubagentExecutionAdapter(ctx)

      // Before dispose
      ctx.emit('subagent/start', subagentRunInfo('run-1'))
      expect(fake.getCalls()).toHaveLength(2)
      fake.resetCalls()

      dispose()

      // After dispose — listeners should be gone
      ctx.emit('subagent/start', subagentRunInfo('run-2'))
      ctx.emit('subagent/end', subagentEndInfo('run-2', 'completed'))
      expect(fake.getCalls()).toHaveLength(0)
    })
  })

  describe('first sight terminal through adapter', () => {
    it('subagent/end at first sight → register + complete', () => {
      const fake = createFakeExecutions()
      const ctx = new Context()
      ctx.provide('executions', fake)

      registerSubagentExecutionAdapter(ctx)
      ctx.emit('subagent/end', subagentEndInfo('run-1', 'completed'))

      const calls = fake.getCalls()
      expect(calls).toHaveLength(2)
      expect(calls[0]).toEqual({ kind: 'subagent', executionId: 'subagent:run-1' })
      expect(calls[1]).toEqual({ kind: 'transition', executionId: 'subagent:run-1', event: 'complete' })
    })

    it('subagent/end aborted at first sight → register + abort', () => {
      const fake = createFakeExecutions()
      const ctx = new Context()
      ctx.provide('executions', fake)

      registerSubagentExecutionAdapter(ctx)
      ctx.emit('subagent/end', subagentEndInfo('run-1', 'aborted'))

      const calls = fake.getCalls()
      expect(calls).toHaveLength(2)
      expect(calls[0]).toEqual({ kind: 'subagent', executionId: 'subagent:run-1' })
      expect(calls[1]).toEqual({ kind: 'transition', executionId: 'subagent:run-1', event: 'abort' })
    })

    it('subagent/end error at first sight → register + fail', () => {
      const fake = createFakeExecutions()
      const ctx = new Context()
      ctx.provide('executions', fake)

      registerSubagentExecutionAdapter(ctx)
      ctx.emit('subagent/end', subagentEndInfo('run-1', 'error'))

      const calls = fake.getCalls()
      expect(calls).toHaveLength(2)
      expect(calls[0]).toEqual({ kind: 'subagent', executionId: 'subagent:run-1' })
      expect(calls[1]).toEqual({ kind: 'transition', executionId: 'subagent:run-1', event: 'fail' })
    })

    it('subagent/end max-tokens at first sight → register + fail', () => {
      const fake = createFakeExecutions()
      const ctx = new Context()
      ctx.provide('executions', fake)

      registerSubagentExecutionAdapter(ctx)
      ctx.emit('subagent/end', subagentEndInfo('run-1', 'max-tokens'))

      const calls = fake.getCalls()
      expect(calls).toHaveLength(2)
      expect(calls[0]).toEqual({ kind: 'subagent', executionId: 'subagent:run-1' })
      expect(calls[1]).toEqual({ kind: 'transition', executionId: 'subagent:run-1', event: 'fail' })
    })

    it('subagent/end refusal at first sight → register + fail', () => {
      const fake = createFakeExecutions()
      const ctx = new Context()
      ctx.provide('executions', fake)

      registerSubagentExecutionAdapter(ctx)
      ctx.emit('subagent/end', subagentEndInfo('run-1', 'refusal'))

      const calls = fake.getCalls()
      expect(calls).toHaveLength(2)
      expect(calls[0]).toEqual({ kind: 'subagent', executionId: 'subagent:run-1' })
      expect(calls[1]).toEqual({ kind: 'transition', executionId: 'subagent:run-1', event: 'fail' })
    })
  })

  describe('full lifecycle through adapter', () => {
    it('start → end(completed) → register + start + complete', () => {
      const fake = createFakeExecutions()
      const ctx = new Context()
      ctx.provide('executions', fake)

      registerSubagentExecutionAdapter(ctx)

      ctx.emit('subagent/start', subagentRunInfo('run-1'))
      fake.resetCalls()
      ctx.emit('subagent/end', subagentEndInfo('run-1', 'completed'))

      const calls = fake.getCalls()
      expect(calls).toHaveLength(1)
      expect(calls[0]).toEqual({ kind: 'transition', executionId: 'subagent:run-1', event: 'complete' })
    })

    it('start → end(aborted) → only abort', () => {
      const fake = createFakeExecutions()
      const ctx = new Context()
      ctx.provide('executions', fake)

      registerSubagentExecutionAdapter(ctx)

      ctx.emit('subagent/start', subagentRunInfo('run-1'))
      fake.resetCalls()
      ctx.emit('subagent/end', subagentEndInfo('run-1', 'aborted'))

      const calls = fake.getCalls()
      expect(calls).toHaveLength(1)
      expect(calls[0]).toEqual({ kind: 'transition', executionId: 'subagent:run-1', event: 'abort' })
    })

    it('start → end(error) → only fail', () => {
      const fake = createFakeExecutions()
      const ctx = new Context()
      ctx.provide('executions', fake)

      registerSubagentExecutionAdapter(ctx)

      ctx.emit('subagent/start', subagentRunInfo('run-1'))
      fake.resetCalls()
      ctx.emit('subagent/end', subagentEndInfo('run-1', 'error'))

      const calls = fake.getCalls()
      expect(calls).toHaveLength(1)
      expect(calls[0]).toEqual({ kind: 'transition', executionId: 'subagent:run-1', event: 'fail' })
    })

    it('start → end(max-tokens) → only fail', () => {
      const fake = createFakeExecutions()
      const ctx = new Context()
      ctx.provide('executions', fake)

      registerSubagentExecutionAdapter(ctx)

      ctx.emit('subagent/start', subagentRunInfo('run-1'))
      fake.resetCalls()
      ctx.emit('subagent/end', subagentEndInfo('run-1', 'max-tokens'))

      const calls = fake.getCalls()
      expect(calls).toHaveLength(1)
      expect(calls[0]).toEqual({ kind: 'transition', executionId: 'subagent:run-1', event: 'fail' })
    })

    it('start → end(refusal) → only fail', () => {
      const fake = createFakeExecutions()
      const ctx = new Context()
      ctx.provide('executions', fake)

      registerSubagentExecutionAdapter(ctx)

      ctx.emit('subagent/start', subagentRunInfo('run-1'))
      fake.resetCalls()
      ctx.emit('subagent/end', subagentEndInfo('run-1', 'refusal'))

      const calls = fake.getCalls()
      expect(calls).toHaveLength(1)
      expect(calls[0]).toEqual({ kind: 'transition', executionId: 'subagent:run-1', event: 'fail' })
    })
  })

  describe('multiple runs through adapter', () => {
    it('two runs with start → end → both projected', () => {
      const fake = createFakeExecutions()
      const ctx = new Context()
      ctx.provide('executions', fake)

      registerSubagentExecutionAdapter(ctx)

      ctx.emit('subagent/start', subagentRunInfo('run-a'))
      ctx.emit('subagent/start', subagentRunInfo('run-b'))
      const callsAfterStart = fake.getCalls()
      expect(callsAfterStart).toHaveLength(4) // 2 registers + 2 starts

      fake.resetCalls()

      ctx.emit('subagent/end', subagentEndInfo('run-a', 'completed'))
      ctx.emit('subagent/end', subagentEndInfo('run-b', 'aborted'))
      const callsAfterEnd = fake.getCalls()
      expect(callsAfterEnd).toHaveLength(2)
      expect(callsAfterEnd[0]).toEqual({ kind: 'transition', executionId: 'subagent:run-a', event: 'complete' })
      expect(callsAfterEnd[1]).toEqual({ kind: 'transition', executionId: 'subagent:run-b', event: 'abort' })
    })
  })

  describe('no executions service', () => {
    it('adapter registration with absent executions → no-op on events', () => {
      const ctx = new Context()
      // No executions provided
      registerSubagentExecutionAdapter(ctx)

      ctx.emit('subagent/start', subagentRunInfo('run-1'))
      ctx.emit('subagent/end', subagentEndInfo('run-1', 'completed'))
      // ctx.get('executions') returns undefined → callbacks return early
    })
  })
})
