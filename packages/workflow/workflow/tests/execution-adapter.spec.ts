/**
 * Tests for `registerWorkflowExecutionAdapter` and `projectWorkflowEvent`: projection
 * of `workflow/start` and `workflow/end` Cordis events into the unified execution
 * state machine via `ctx.executions`.
 *
 * Coverage goals: every branch of `stopReasonEvent`, the registration /
 * transition flow in `projectWorkflowStart` / `projectWorkflowEnd` /
 * `projectWorkflowEvent`, disposer teardown, the missing-service guard,
 * catch paths for register/throws, first-sight terminal, delayed register
 * (adapter starts after `workflow/start`), non-relevant events ignored,
 * idempotency of first-sight, and exhaustive stopReason mapping.
 * @module @deepseek-ai/dsh-workflow/execution-adapter.spec
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { WorkflowRunId } from '../src/index.ts'
import type { WorkflowRunInfo, WorkflowResultInfo } from '../src/index.ts'
import type { ExecutionEventTypeCode } from '@deepseek-ai/dsh-execution'
import { projectWorkflowEvent, registerWorkflowExecutionAdapter } from '../src/execution-adapter.ts'
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

/** Build a minimal workflow/info object matching the event payload. */
function workflowInfo(id: string): { id: string } {
  return { id }
}

/** Build a full WorkflowRunInfo for ctx.emit calls. */
function makeWorkflowRunInfo(id: string): WorkflowRunInfo {
  return { id: WorkflowRunId(id), meta: { name: 'w', description: 'd' } }
}

/** Emit a typed workflow event via ctx.emit with safe casting. */
function emitWorkflowStart(ctx: Context, id: string) {
  ctx.emit('workflow/start', makeWorkflowRunInfo(id))
}

function emitWorkflowEnd(ctx: Context, id: string, stopReason: 'completed' | 'cancelled' | 'error') {
  ctx.emit('workflow/end', makeWorkflowRunInfo(id), {
    stopReason,
    agentsStarted: 0,
  } as WorkflowResultInfo)
}

// ---------------------------------------------------------------------------
// projectWorkflowEvent tests
// ---------------------------------------------------------------------------

describe('projectWorkflowEvent', () => {
  describe('non-relevant events', () => {
    it('ignores events other than workflow/start and workflow/end', () => {
      const fake = createFakeExecutions()
      projectWorkflowEvent(fake, 'workflow/phase', workflowInfo('run-1'))
      expect(fake.getCalls()).toHaveLength(0)
    })

    it('workflow/end without result is a no-op', () => {
      const fake = createFakeExecutions()
      projectWorkflowEvent(fake, 'workflow/end', workflowInfo('run-1'), undefined)
      expect(fake.getCalls()).toHaveLength(0)
    })
  })

  describe('workflow/start', () => {
    it('first start → register + start', () => {
      const fake = createFakeExecutions()
      projectWorkflowEvent(fake, 'workflow/start', workflowInfo('run-1'))
      const calls = fake.getCalls()
      expect(calls).toHaveLength(2)
      expect(calls[0]).toEqual({ kind: 'workflow', executionId: 'workflow:run-1' })
      expect(calls[1]).toEqual({ kind: 'transition', executionId: 'workflow:run-1', event: 'start' })
    })

    it('duplicate start → no extra transitions (idempotent)', () => {
      const fake = createFakeExecutions()
      projectWorkflowEvent(fake, 'workflow/start', workflowInfo('run-1'))
      fake.resetCalls()

      projectWorkflowEvent(fake, 'workflow/start', workflowInfo('run-1'))
      expect(fake.getCalls()).toHaveLength(0)
    })
  })

  describe('workflow/end — completed', () => {
    it('end completed → register + complete', () => {
      const fake = createFakeExecutions()
      // No prior start — adapter must register on first sight of terminal.
      projectWorkflowEvent(fake, 'workflow/end', workflowInfo('run-1'), { stopReason: 'completed' })
      const calls = fake.getCalls()
      expect(calls).toHaveLength(2)
      expect(calls[0]).toEqual({ kind: 'workflow', executionId: 'workflow:run-1' })
      expect(calls[1]).toEqual({ kind: 'transition', executionId: 'workflow:run-1', event: 'complete' })
    })

    it('end completed after start → only complete (start already done)', () => {
      const fake = createFakeExecutions()
      projectWorkflowEvent(fake, 'workflow/start', workflowInfo('run-1'))
      fake.resetCalls()

      projectWorkflowEvent(fake, 'workflow/end', workflowInfo('run-1'), { stopReason: 'completed' })
      const calls = fake.getCalls()
      expect(calls).toHaveLength(1)
      expect(calls[0]).toEqual({ kind: 'transition', executionId: 'workflow:run-1', event: 'complete' })
    })
  })

  describe('workflow/end — cancelled', () => {
    it('end cancelled → register + cancel', () => {
      const fake = createFakeExecutions()
      projectWorkflowEvent(fake, 'workflow/end', workflowInfo('run-1'), { stopReason: 'cancelled' })
      const calls = fake.getCalls()
      expect(calls).toHaveLength(2)
      expect(calls[0]).toEqual({ kind: 'workflow', executionId: 'workflow:run-1' })
      expect(calls[1]).toEqual({ kind: 'transition', executionId: 'workflow:run-1', event: 'cancel' })
    })
  })

  describe('workflow/end — error', () => {
    it('end error → register + fail', () => {
      const fake = createFakeExecutions()
      projectWorkflowEvent(fake, 'workflow/end', workflowInfo('run-1'), { stopReason: 'error' })
      const calls = fake.getCalls()
      expect(calls).toHaveLength(2)
      expect(calls[0]).toEqual({ kind: 'workflow', executionId: 'workflow:run-1' })
      expect(calls[1]).toEqual({ kind: 'transition', executionId: 'workflow:run-1', event: 'fail' })
    })
  })

  describe('workflow/end — fallback start when not RUNNING', () => {
    it('end (no prior start) → register + complete succeeds directly', () => {
      const fake = createFakeExecutions()
      projectWorkflowEvent(fake, 'workflow/end', workflowInfo('run-1'), { stopReason: 'completed' })
      const calls = fake.getCalls()
      expect(calls).toContainEqual({ kind: 'transition', executionId: 'workflow:run-1', event: 'complete' })
    })

    it('end (no prior start) but complete throws → start + complete', () => {
      const fake = createFakeExecutions()
      fake.setThrowTransitionOnce(true) // first complete call throws

      projectWorkflowEvent(fake, 'workflow/end', workflowInfo('run-1'), { stopReason: 'completed' })
      const calls = fake.getCalls()
      expect(calls).toContainEqual({ kind: 'workflow', executionId: 'workflow:run-1' })
      // complete threw → fallback: start then complete
      expect(calls).toContainEqual({ kind: 'transition', executionId: 'workflow:run-1', event: 'start' })
      expect(calls).toContainEqual({ kind: 'transition', executionId: 'workflow:run-1', event: 'complete' })
    })
  })

  describe('workflow/end — delayed register when adapter starts late', () => {
    it('end before start (adapter registered after workflow/start already fired)', () => {
      const fake = createFakeExecutions()
      // Adapter starts listening only now — no prior start event.
      // Must register itself on terminal first sight.
      projectWorkflowEvent(fake, 'workflow/end', workflowInfo('run-1'), { stopReason: 'error' })
      const calls = fake.getCalls()
      expect(calls[0]).toEqual({ kind: 'workflow', executionId: 'workflow:run-1' })
      expect(calls[1]).toEqual({ kind: 'transition', executionId: 'workflow:run-1', event: 'fail' })
    })
  })

  describe('catch — register throws', () => {
    it('register throws → transition still sent', () => {
      const fake = createFakeExecutions()
      fake.setThrowRegister(true)
      projectWorkflowEvent(fake, 'workflow/start', workflowInfo('run-1'))
      const calls = fake.getCalls()
      expect(calls).toHaveLength(1)
      expect(calls[0]).toEqual({ kind: 'transition', executionId: 'workflow:run-1', event: 'start' })
    })

    it('register throws on end → transition still sent', () => {
      const fake = createFakeExecutions()
      fake.setThrowRegister(true)
      projectWorkflowEvent(fake, 'workflow/end', workflowInfo('run-1'), { stopReason: 'completed' })
      const calls = fake.getCalls()
      expect(calls).toHaveLength(1)
      expect(calls[0]).toEqual({ kind: 'transition', executionId: 'workflow:run-1', event: 'complete' })
    })
  })

  describe('catch — transition throws', () => {
    it('start transition throws → adapter does not propagate', () => {
      const fake = createFakeExecutions()
      fake.setThrowTransition(true)
      projectWorkflowEvent(fake, 'workflow/start', workflowInfo('run-1'))
      const calls = fake.getCalls()
      expect(calls).toHaveLength(1)
      expect(calls[0]).toEqual({ kind: 'workflow', executionId: 'workflow:run-1' })
    })

    it('end transition throws → fallback start+end', () => {
      const fake = createFakeExecutions()
      fake.setThrowTransitionOnce(true) // first call throws, second succeeds
      projectWorkflowEvent(fake, 'workflow/end', workflowInfo('run-1'), { stopReason: 'completed' })
      const calls = fake.getCalls()
      // register succeeded, complete threw (consumed), fallback start+complete sent
      expect(calls).toContainEqual({ kind: 'workflow', executionId: 'workflow:run-1' })
      expect(calls).toContainEqual({ kind: 'transition', executionId: 'workflow:run-1', event: 'start' })
      expect(calls).toContainEqual({ kind: 'transition', executionId: 'workflow:run-1', event: 'complete' })
    })

    it('both end and fallback start throw → adapter does not propagate', () => {
      const fake = createFakeExecutions()
      fake.setThrowTransition(true)
      projectWorkflowEvent(fake, 'workflow/end', workflowInfo('run-1'), { stopReason: 'completed' })
      const calls = fake.getCalls()
      // register succeeded, complete threw, start also throws (catch)
      expect(calls).toHaveLength(1)
      expect(calls[0]).toEqual({ kind: 'workflow', executionId: 'workflow:run-1' })
    })
  })

  describe('multiple runs', () => {
    it('two different runs → both projected independently', () => {
      const fake = createFakeExecutions()
      projectWorkflowEvent(fake, 'workflow/start', workflowInfo('run-a'))
      projectWorkflowEvent(fake, 'workflow/start', workflowInfo('run-b'))
      const calls = fake.getCalls()
      expect(calls).toHaveLength(4)
      expect(calls[0]).toEqual({ kind: 'workflow', executionId: 'workflow:run-a' })
      expect(calls[1]).toEqual({ kind: 'transition', executionId: 'workflow:run-a', event: 'start' })
      expect(calls[2]).toEqual({ kind: 'workflow', executionId: 'workflow:run-b' })
      expect(calls[3]).toEqual({ kind: 'transition', executionId: 'workflow:run-b', event: 'start' })
    })
  })

  describe('stopReasonEvent — exhaustive mapping', () => {
    it.each([
      { stopReason: 'completed' as const, expectedEvent: 'complete' as const },
      { stopReason: 'cancelled' as const, expectedEvent: 'cancel' as const },
      { stopReason: 'error' as const, expectedEvent: 'fail' as const },
    ])('stopReason "$stopReason" → "$expectedEvent"', ({ stopReason, expectedEvent }) => {
      const fake = createFakeExecutions()
      projectWorkflowEvent(fake, 'workflow/end', workflowInfo('run-x'), { stopReason })
      const calls = fake.getCalls()
      expect(calls).toHaveLength(2)
      expect(calls[0]).toEqual({ kind: 'workflow', executionId: 'workflow:run-x' })
      expect(calls[1]).toEqual({ kind: 'transition', executionId: 'workflow:run-x', event: expectedEvent })
    })
  })
})

// ---------------------------------------------------------------------------
// registerWorkflowExecutionAdapter tests (integration)
// ---------------------------------------------------------------------------

describe('registerWorkflowExecutionAdapter', () => {
  describe('basic wiring', () => {
    it('returns a disposer that unregisters the workflow/start and workflow/end listeners', () => {
      const fake = createFakeExecutions()
      const ctx = new Context()
      ctx.provide('executions', fake)

      const dispose = registerWorkflowExecutionAdapter(ctx)

      // Before dispose — process events
      emitWorkflowStart(ctx, 'run-1')
      expect(fake.getCalls()).toHaveLength(2) // register + start

      const beforeDisposeCalls = fake.getCalls()

      dispose()

      // After dispose — the adapter listeners are unregistered.
      emitWorkflowStart(ctx, 'run-2')
      expect(fake.getCalls()).toEqual(beforeDisposeCalls) // no new calls
    })

    it('workflow/start + end → register + start + complete via ctx.emit', () => {
      const fake = createFakeExecutions()
      const ctx = new Context()
      ctx.provide('executions', fake)

      registerWorkflowExecutionAdapter(ctx)

      emitWorkflowStart(ctx, 'run-1')
      fake.resetCalls()
      emitWorkflowEnd(ctx, 'run-1', 'completed')

      const calls = fake.getCalls()
      expect(calls).toHaveLength(1)
      expect(calls[0]).toEqual({ kind: 'transition', executionId: 'workflow:run-1', event: 'complete' })
    })

    it('does not register executions when service is absent', () => {
      const ctx = new Context()
      // No executions provided
      registerWorkflowExecutionAdapter(ctx)

      emitWorkflowStart(ctx, 'run-1')
      // ctx.get('executions') returns undefined → early return
    })

    it('workflow/end without executions → early return on line ~170', () => {
      const ctx = new Context()
      registerWorkflowExecutionAdapter(ctx)
      emitWorkflowEnd(ctx, 'run-1', 'completed')
      // No executions → adapter callback returns early
    })
  })

  describe('disposer', () => {
    it('disposer removes both listeners', () => {
      const fake = createFakeExecutions()
      const ctx = new Context()
      ctx.provide('executions', fake)

      const dispose = registerWorkflowExecutionAdapter(ctx)

      // Before dispose
      emitWorkflowStart(ctx, 'run-1')
      expect(fake.getCalls()).toHaveLength(2)
      fake.resetCalls()

      dispose()

      // After dispose — listeners should be gone
      emitWorkflowStart(ctx, 'run-2')
      emitWorkflowEnd(ctx, 'run-2', 'completed')
      expect(fake.getCalls()).toHaveLength(0)
    })
  })

  describe('first sight terminal through adapter', () => {
    it('workflow/end at first sight → register + complete', () => {
      const fake = createFakeExecutions()
      const ctx = new Context()
      ctx.provide('executions', fake)

      registerWorkflowExecutionAdapter(ctx)
      emitWorkflowEnd(ctx, 'run-1', 'completed')

      const calls = fake.getCalls()
      expect(calls).toHaveLength(2)
      expect(calls[0]).toEqual({ kind: 'workflow', executionId: 'workflow:run-1' })
      expect(calls[1]).toEqual({ kind: 'transition', executionId: 'workflow:run-1', event: 'complete' })
    })

    it('workflow/end cancelled at first sight → register + cancel', () => {
      const fake = createFakeExecutions()
      const ctx = new Context()
      ctx.provide('executions', fake)

      registerWorkflowExecutionAdapter(ctx)
      emitWorkflowEnd(ctx, 'run-1', 'cancelled')

      const calls = fake.getCalls()
      expect(calls).toHaveLength(2)
      expect(calls[0]).toEqual({ kind: 'workflow', executionId: 'workflow:run-1' })
      expect(calls[1]).toEqual({ kind: 'transition', executionId: 'workflow:run-1', event: 'cancel' })
    })

    it('workflow/end error at first sight → register + fail', () => {
      const fake = createFakeExecutions()
      const ctx = new Context()
      ctx.provide('executions', fake)

      registerWorkflowExecutionAdapter(ctx)
      emitWorkflowEnd(ctx, 'run-1', 'error')

      const calls = fake.getCalls()
      expect(calls).toHaveLength(2)
      expect(calls[0]).toEqual({ kind: 'workflow', executionId: 'workflow:run-1' })
      expect(calls[1]).toEqual({ kind: 'transition', executionId: 'workflow:run-1', event: 'fail' })
    })
  })

  describe('full lifecycle through adapter', () => {
    it('start → end(completed) → register + start + complete', () => {
      const fake = createFakeExecutions()
      const ctx = new Context()
      ctx.provide('executions', fake)

      registerWorkflowExecutionAdapter(ctx)

      emitWorkflowStart(ctx, 'run-1')
      fake.resetCalls()
      emitWorkflowEnd(ctx, 'run-1', 'completed')

      const calls = fake.getCalls()
      expect(calls).toHaveLength(1)
      expect(calls[0]).toEqual({ kind: 'transition', executionId: 'workflow:run-1', event: 'complete' })
    })

    it('start → end(cancelled) → only cancel', () => {
      const fake = createFakeExecutions()
      const ctx = new Context()
      ctx.provide('executions', fake)

      registerWorkflowExecutionAdapter(ctx)

      emitWorkflowStart(ctx, 'run-1')
      fake.resetCalls()
      emitWorkflowEnd(ctx, 'run-1', 'cancelled')

      const calls = fake.getCalls()
      expect(calls).toHaveLength(1)
      expect(calls[0]).toEqual({ kind: 'transition', executionId: 'workflow:run-1', event: 'cancel' })
    })

    it('start → end(error) → only fail', () => {
      const fake = createFakeExecutions()
      const ctx = new Context()
      ctx.provide('executions', fake)

      registerWorkflowExecutionAdapter(ctx)

      emitWorkflowStart(ctx, 'run-1')
      fake.resetCalls()
      emitWorkflowEnd(ctx, 'run-1', 'error')

      const calls = fake.getCalls()
      expect(calls).toHaveLength(1)
      expect(calls[0]).toEqual({ kind: 'transition', executionId: 'workflow:run-1', event: 'fail' })
    })
  })

  describe('multiple runs through adapter', () => {
    it('two runs with start → end → both projected', () => {
      const fake = createFakeExecutions()
      const ctx = new Context()
      ctx.provide('executions', fake)

      registerWorkflowExecutionAdapter(ctx)

      emitWorkflowStart(ctx, 'run-a')
      emitWorkflowStart(ctx, 'run-b')
      const callsAfterStart = fake.getCalls()
      expect(callsAfterStart).toHaveLength(4) // 2 registers + 2 starts

      fake.resetCalls()

      emitWorkflowEnd(ctx, 'run-a', 'completed')
      emitWorkflowEnd(ctx, 'run-b', 'cancelled')
      const callsAfterEnd = fake.getCalls()
      expect(callsAfterEnd).toHaveLength(2)
      expect(callsAfterEnd[0]).toEqual({ kind: 'transition', executionId: 'workflow:run-a', event: 'complete' })
      expect(callsAfterEnd[1]).toEqual({ kind: 'transition', executionId: 'workflow:run-b', event: 'cancel' })
    })
  })
})
