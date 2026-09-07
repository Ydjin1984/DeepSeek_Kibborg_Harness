/**
 * Tests for `registerExecutionAdapter`: projection of JobStatus changes into
 * the unified execution state-machine via `ctx.executions`.
 *
 * Coverage goals: every branch of `jobStatusEvent`, the registration /
 * transition flow in `registerExecutionAdapter`, disposer teardown, the
 * missing-service guard, the "first-sight terminal" logic, catch paths for
 * register/throws, multi-job commits, and status-idempotency.
 * @module @deepseek-ai/dsh-jobs/execution-adapter.spec
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { JobId } from '@deepseek-ai/dsh-jobs/brand'
import type { JobSnapshot } from '@deepseek-ai/dsh-jobs'
import type { ExecutionEventTypeCode } from '@deepseek-ai/dsh-execution'
import { registerExecutionAdapter } from '../src/execution-adapter.ts'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal fake execution-surface that records calls and can throw on demand. */
function createFakeExecutions() {
  const calls: Array<{ kind: string; executionId: string; event?: ExecutionEventTypeCode }> = []
  let throwRegister = false
  let throwTransition = false
  let throwTransitionOnce = false // throws exactly once then recovers

  const fake = {
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

/** Build a JobSnapshot from an id string and status. */
function snap(id: string, status: JobSnapshot['status']): JobSnapshot {
  return {
    id: JobId(id),
    kind: 'bash',
    label: 'test-job',
    status,
    startedAt: 1000,
    reported: false,
  }
}

/**
 * Build a harness: a fresh Context with jobs and (optionally) executions
 * services wired in, plus a listener callback that the caller invokes with
 * snapshots.
 */
function buildHarness(fakeExec?: ReturnType<typeof createFakeExecutions>) {
  const ctx = new Context()

  const snapshots: JobSnapshot[] = []
  let listener: ((owner: Agent | undefined) => void) | undefined

  ctx.provide('jobs', {
    onJobsChanged(cb: (owner: Agent | undefined) => void) {
      listener = cb
      return () => { listener = undefined }
    },
    list(): JobSnapshot[] {
      return snapshots
    },
  })

  if (fakeExec) {
    ctx.provide('executions', fakeExec)
  }

  const dispose = registerExecutionAdapter(ctx)

  return {
    ctx,
    dispose,
    snapshots,
    fire() {
      if (listener) listener(undefined)
    },
    get listenerFn() { return listener },
    getCalls() {
      return fakeExec?.getCalls() ?? []
    },
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('registerExecutionAdapter', () => {
  describe('basic wiring', () => {
    it('returns a disposer that unregisters the onJobsChanged listener', () => {
      const fake = createFakeExecutions()
      const h = buildHarness(fake)

      h.snapshots.push(snap('bash-1', 'running'))
      h.fire() // register + start
      expect(h.getCalls()).toHaveLength(2) // register + start

      const beforeDisposeCalls = fake.getCalls()

      h.dispose()

      // After dispose the listener is removed, so firing again is a no-op.
      h.snapshots.length = 0
      h.snapshots.push(snap('bash-2', 'running'))
      h.fire()
      // No NEW calls because the adapter was disposed (listener is undefined).
      expect(fake.getCalls()).toEqual(beforeDisposeCalls)
    })

    it('does not register executions when service is absent', () => {
      const h = buildHarness()
      h.snapshots.push(snap('bash-1', 'running'))
      h.fire()
      // Without executions service the adapter returns early.
      expect(h.getCalls()).toHaveLength(0)
    })
  })

  describe('first sight — terminal job', () => {
    it('first snapshot completed → register + start + complete', () => {
      const fake = createFakeExecutions()
      const h = buildHarness(fake)
      h.snapshots.push(snap('bash-1', 'completed'))
      h.fire()

      const calls = fake.getCalls()
      // register + start (first-sight terminal) + complete
      expect(calls).toHaveLength(3)
      expect(calls[0]).toEqual({ kind: 'job', executionId: 'job:bash-1' })
      expect(calls[1]).toEqual({ kind: 'transition', executionId: 'job:bash-1', event: 'start' })
      expect(calls[2]).toEqual({ kind: 'transition', executionId: 'job:bash-1', event: 'complete' })
    })

    it('first snapshot killed → register + start + abort', () => {
      const fake = createFakeExecutions()
      const h = buildHarness(fake)
      h.snapshots.push(snap('bash-1', 'killed'))
      h.fire()

      const calls = fake.getCalls()
      expect(calls).toHaveLength(3)
      expect(calls[0]).toEqual({ kind: 'job', executionId: 'job:bash-1' })
      expect(calls[1]).toEqual({ kind: 'transition', executionId: 'job:bash-1', event: 'start' })
      expect(calls[2]).toEqual({ kind: 'transition', executionId: 'job:bash-1', event: 'abort' })
    })

    it('first snapshot failed → register + start + fail', () => {
      const fake = createFakeExecutions()
      const h = buildHarness(fake)
      h.snapshots.push(snap('bash-1', 'failed'))
      h.fire()

      const calls = fake.getCalls()
      expect(calls).toHaveLength(3)
      expect(calls[0]).toEqual({ kind: 'job', executionId: 'job:bash-1' })
      expect(calls[1]).toEqual({ kind: 'transition', executionId: 'job:bash-1', event: 'start' })
      expect(calls[2]).toEqual({ kind: 'transition', executionId: 'job:bash-1', event: 'fail' })
    })
  })

  describe('first sight — terminal start throws', () => {
    it('transition("start") throws → still sends terminal event', () => {
      const fake = createFakeExecutions()
      fake.setThrowTransitionOnce(true)
      const h = buildHarness(fake)
      h.snapshots.push(snap('bash-1', 'completed'))
      h.fire()

      const calls = fake.getCalls()
      // register succeeded, start threw (consumed by catch), complete still sent
      expect(calls).toHaveLength(2)
      expect(calls[0]).toEqual({ kind: 'job', executionId: 'job:bash-1' })
      // start threw → not in calls; complete succeeded
      expect(calls[1]).toEqual({ kind: 'transition', executionId: 'job:bash-1', event: 'complete' })
    })

    it('register throws → start and terminal transition still happen', () => {
      const fake = createFakeExecutions()
      fake.setThrowRegister(true)
      const h = buildHarness(fake)
      h.snapshots.push(snap('bash-1', 'completed'))
      h.fire()

      const calls = fake.getCalls()
      // register threw (consumed), start succeeds, complete succeeds
      expect(calls).toHaveLength(2)
      expect(calls[0]).toEqual({ kind: 'transition', executionId: 'job:bash-1', event: 'start' })
      expect(calls[1]).toEqual({ kind: 'transition', executionId: 'job:bash-1', event: 'complete' })
    })

    it('transition(terminal) throws → adapter does not propagate', () => {
      const fake = createFakeExecutions()
      // start throws (throwTransitionOnce = true), fail does not
      fake.setThrowTransitionOnce(true)
      const h = buildHarness(fake)
      h.snapshots.push(snap('bash-1', 'failed'))
      h.fire()

      const calls = fake.getCalls()
      // register succeeded, start threw (consumed), fail succeeded
      expect(calls).toHaveLength(2)
      expect(calls[0]).toEqual({ kind: 'job', executionId: 'job:bash-1' })
      expect(calls[1]).toEqual({ kind: 'transition', executionId: 'job:bash-1', event: 'fail' })
    })
  })

  describe('status transitions between fires', () => {
    it('running → completed: transition "start" then "complete"', () => {
      const fake = createFakeExecutions()
      const h = buildHarness(fake)

      // First fire: running → register + start
      h.snapshots.push(snap('bash-1', 'running'))
      h.fire()
      expect(fake.getCalls()).toHaveLength(2)
      expect(fake.getCalls()[0]).toEqual({ kind: 'job', executionId: 'job:bash-1' })
      expect(fake.getCalls()[1]).toEqual({ kind: 'transition', executionId: 'job:bash-1', event: 'start' })

      fake.resetCalls()

      // Second fire: status changed to completed → projected map sees diff
      // status !== 'running' → start + complete
      h.snapshots[0] = snap('bash-1', 'completed')
      h.fire()
      expect(fake.getCalls()).toHaveLength(2)
      expect(fake.getCalls()[0]).toEqual({ kind: 'transition', executionId: 'job:bash-1', event: 'start' })
      expect(fake.getCalls()[1]).toEqual({ kind: 'transition', executionId: 'job:bash-1', event: 'complete' })
    })
  })

  describe('status idempotency', () => {
    it('repeated fire with same status → no extra transitions', () => {
      const fake = createFakeExecutions()
      const h = buildHarness(fake)

      h.snapshots.push(snap('bash-1', 'running'))
      h.fire()
      expect(fake.getCalls()).toHaveLength(2) // register + start

      fake.resetCalls()

      h.fire() // same status, projected map has it
      expect(fake.getCalls()).toHaveLength(0)
    })

    it('stopping → register only, no event transition (continue skips start too)', () => {
      const fake = createFakeExecutions()
      const h = buildHarness(fake)

      h.snapshots.push(snap('bash-1', 'stopping'))
      h.fire()
      // jobStatusEvent('stopping') = undefined → continue → skip start transition too
      const calls = fake.getCalls()
      expect(calls).toHaveLength(1)
      expect(calls[0]).toEqual({ kind: 'job', executionId: 'job:bash-1' })

      fake.resetCalls()

      // Another fire with same status → nothing (projected map has it)
      h.fire()
      expect(fake.getCalls()).toHaveLength(0)
    })
  })

  describe('jobStatusEvent — all statuses', () => {
    it.each([
      { status: 'running' as const, expectedEvent: 'start' as const, totalCalls: 2 },
      { status: 'completed' as const, expectedEvent: 'complete' as const, totalCalls: 3 },
      { status: 'failed' as const, expectedEvent: 'fail' as const, totalCalls: 3 },
      { status: 'killed' as const, expectedEvent: 'abort' as const, totalCalls: 3 },
      { status: 'stopping' as const, expectedEvent: undefined as unknown as 'start', totalCalls: 1 },
    ])('status "$status" → event $expectedEvent (totalCalls=$totalCalls)', ({ status, expectedEvent, totalCalls }) => {
      const fake = createFakeExecutions()
      const h = buildHarness(fake)
      h.snapshots.push(snap('bash-1', status))
      h.fire()

      const calls = fake.getCalls()
      expect(calls).toHaveLength(totalCalls)

      // register is always first
      expect(calls[0]).toEqual({ kind: 'job', executionId: 'job:bash-1' })

      if (status === 'running') {
        // only register + start (running IS the start event)
        expect(calls[1]).toEqual({ kind: 'transition', executionId: 'job:bash-1', event: 'start' })
      } else if (expectedEvent === undefined) {
        // stopping: jobStatusEvent returns undefined → continue → skip start + event
        // Only register is recorded
      } else {
        // terminal first-sight: register + start + event
        expect(calls[1]).toEqual({ kind: 'transition', executionId: 'job:bash-1', event: 'start' })
        expect(calls[2]).toEqual({
          kind: 'transition',
          executionId: 'job:bash-1',
          event: expectedEvent,
        })
      }
    })
  })

  describe('multiple jobs in one fire', () => {
    it('two jobs in same fire → both projected', () => {
      const fake = createFakeExecutions()
      const h = buildHarness(fake)

      h.snapshots.push(
        snap('bash-1', 'running'),
        snap('bash-2', 'completed'),
      )
      h.fire()

      const calls = fake.getCalls()
      // bash-1: register + start (running, no extra start)
      // bash-2: register + start (first-sight terminal) + complete
      expect(calls).toHaveLength(5)

      expect(calls[0]).toEqual({ kind: 'job', executionId: 'job:bash-1' })
      expect(calls[1]).toEqual({ kind: 'transition', executionId: 'job:bash-1', event: 'start' })
      expect(calls[2]).toEqual({ kind: 'job', executionId: 'job:bash-2' })
      expect(calls[3]).toEqual({ kind: 'transition', executionId: 'job:bash-2', event: 'start' })
      expect(calls[4]).toEqual({ kind: 'transition', executionId: 'job:bash-2', event: 'complete' })
    })

    it('one job added in second fire → only new job gets transitions', () => {
      const fake = createFakeExecutions()
      const h = buildHarness(fake)

      // First fire: only job 1
      h.snapshots.push(snap('bash-1', 'running'))
      h.fire()
      expect(fake.getCalls()).toHaveLength(2)

      fake.resetCalls()

      // Second fire: add job 2 (first sight, terminal)
      h.snapshots.push(snap('bash-2', 'failed'))
      h.fire()

      const calls = fake.getCalls()
      // bash-1: no change (already running, projected has it)
      // bash-2: register + start (first-sight) + fail
      expect(calls).toHaveLength(3)
      expect(calls[0]).toEqual({ kind: 'job', executionId: 'job:bash-2' })
      expect(calls[1]).toEqual({ kind: 'transition', executionId: 'job:bash-2', event: 'start' })
      expect(calls[2]).toEqual({ kind: 'transition', executionId: 'job:bash-2', event: 'fail' })
    })
  })

  describe('running — first sight', () => {
    it('running → register + start, no extra start for first-sight', () => {
      const fake = createFakeExecutions()
      const h = buildHarness(fake)
      h.snapshots.push(snap('bash-1', 'running'))
      h.fire()

      const calls = fake.getCalls()
      // running → status !== 'running' is false → no extra start before the event
      expect(calls).toHaveLength(2)
      expect(calls[0]).toEqual({ kind: 'job', executionId: 'job:bash-1' })
      expect(calls[1]).toEqual({ kind: 'transition', executionId: 'job:bash-1', event: 'start' })
    })
  })

  describe('catch — register throws', () => {
    it('register throws on first job → subsequent jobs still processed', () => {
      const fake = createFakeExecutions()
      const h = buildHarness(fake)

      h.snapshots.push(
        snap('bash-1', 'running'),
        snap('bash-2', 'running'),
      )
      // Make register throw on first call (bash-1), succeed on second
      let first = true
      const origRegister = fake.register.bind(fake)
      fake.register = function (kind, executionId) {
        if (first) { first = false; throw new Error('already registered') }
        return origRegister(kind, executionId)
      }

      h.fire()

      const calls = fake.getCalls()
      // bash-1: register threw (consumed), start succeeded
      // bash-2: register succeeded, start succeeded
      expect(calls).toHaveLength(3)
      expect(calls[0]).toEqual({ kind: 'transition', executionId: 'job:bash-1', event: 'start' })
      expect(calls[1]).toEqual({ kind: 'job', executionId: 'job:bash-2' })
      expect(calls[2]).toEqual({ kind: 'transition', executionId: 'job:bash-2', event: 'start' })
    })
  })
})
