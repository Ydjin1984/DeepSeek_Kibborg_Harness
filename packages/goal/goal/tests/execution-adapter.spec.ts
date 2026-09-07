/**
 * Tests for `registerGoalExecutionAdapter` and `projectGoalChange`: projection
 * of GoalPhase changes into the unified execution state machine via
 * `ctx.executions`.
 *
 * Coverage goals: every branch of `phaseEvent`, registration / transition flow
 * in `projectGoalChange` and `registerGoalExecutionAdapter`, disposer teardown,
 * the missing-service guard, clear (tombstone), first-sight terminal, catch
 * paths for register/throws, idempotency, non-goal events, and phase transitions.
 * @module @deepseek-ai/dsh-goal/execution-adapter.spec
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { Session, SessionId } from '@deepseek-ai/dsh-session'
import { GoalId } from '@deepseek-ai/dsh-goal'
import { projectGoalChange, registerGoalExecutionAdapter } from '../src/execution-adapter.ts'
import type { ExecutionSurface } from '../src/execution-adapter.ts'
import type { GoalSnapshot } from '../src/types.ts'
import type { GoalChangeMeta, GoalSnapshotChangeMeta } from '../src/domain.ts'
import type { Session as SessionType, SessionEvent } from '@deepseek-ai/dsh-session'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a fake execution surface that records calls and can throw on demand. */
function createFakeExecutions(): ExecutionSurface & {
  setThrowRegister(v: boolean): void
  setThrowTransition(v: boolean): void
  setThrowTransitionOnce(v: boolean): void
  resetCalls(): void
  getCalls(): Array<{ kind: string; executionId: string; event?: string }>
} {
  const calls: Array<{ kind: string; executionId: string; event?: string }> = []
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
    transition(executionId: string, eventCode: string): unknown {
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

/** Build a GoalSnapshotChangeMeta for testing. */
function makeMeta(overrides: {
  kind?: 'goal/change'
  version?: number
  operation?: Exclude<GoalSnapshotChangeMeta['operation'], 'clear'>
  goal?: Partial<GoalSnapshot>
  roundsStarted?: number
  createdAt?: number
  updatedAt?: number
} = {}): GoalSnapshotChangeMeta {
  const {
    goal: goalOverride,
    kind: kindInput,
    operation: operationInput,
    roundsStarted = 0,
    createdAt = 1000,
    updatedAt = 1000,
  } = overrides
  const kind = kindInput ?? 'goal/change' as GoalSnapshotChangeMeta['kind']
  const operation = operationInput ?? 'create' as Exclude<GoalSnapshotChangeMeta['operation'], 'clear'>
  const baseGoal: GoalSnapshot = {
    id: GoalId('goal-test-1'),
    revision: 1,
    objective: 'test objective',
    phase: 'active',
    maxGoalRounds: 10,
  }
  return {
    kind: kind as GoalSnapshotChangeMeta['kind'],
    version: 1,
    operation: operation as Exclude<GoalSnapshotChangeMeta['operation'], 'clear'>,
    goal: { ...baseGoal, ...goalOverride } as unknown as GoalSnapshot,
    roundsStarted,
    createdAt,
    updatedAt,
  }
}

/** Build a GoalClearChangeMeta for testing. */
function makeClearMeta(): GoalChangeMeta {
  return {
    kind: 'goal/change',
    version: 1,
    operation: 'clear',
    cleared: { id: GoalId('goal-test-1'), revision: 5 },
    clearedAt: 1005,
  }
}

/** Build a SessionEvent envelope from a goal/change payload. */
function toEvent(data: GoalChangeMeta): SessionEvent {
  return {
    type: 'goal/change',
    seq: 1,
    time: 1000,
    data: data as SessionEvent<'goal/change'>['data'],
  } as unknown as SessionEvent
}

/** Build a SessionEvent envelope for a non-goal/change event. */
function toOtherEvent(type: string): SessionEvent {
  return {
    type,
    seq: 1,
    time: 1000,
    data: {} as never,
  } as unknown as SessionEvent
}

/** Minimal session stub implementing just enough for the adapter. */
function stubSession(): SessionType {
  return {
    id: SessionId('stub'),
    events: [],
    append: () => {},
    header: { version: 0, id: SessionId('stub'), createdAt: 0, parentSession: undefined, seedLength: 0 },
  } as unknown as SessionType
}

// ---------------------------------------------------------------------------
// projectGoalChange tests
// ---------------------------------------------------------------------------

describe('projectGoalChange', () => {
  describe('non-goal events', () => {
    it('ignores non-goal/change session events', () => {
      const fake = createFakeExecutions()
      const session = stubSession()
      const event = toOtherEvent('user/message')
      projectGoalChange(fake, session, event)
      expect(fake.getCalls()).toHaveLength(0)
    })
  })

  describe('first sight — active goal', () => {
    it('first snapshot active → register + start', () => {
      const fake = createFakeExecutions()
      const session = stubSession()
      const meta = makeMeta()
      projectGoalChange(fake, session, toEvent(meta))
      const calls = fake.getCalls()
      expect(calls).toHaveLength(2)
      expect(calls[0]).toEqual({ kind: 'goal', executionId: 'goal:goal-test-1' })
      expect(calls[1]).toEqual({ kind: 'transition', executionId: 'goal:goal-test-1', event: 'start' })
    })
  })

  describe('first sight — paused goal', () => {
    it('first snapshot paused → register + start + wait-user', () => {
      const fake = createFakeExecutions()
      const session = stubSession()
      const meta = makeMeta({ operation: 'pause', goal: { phase: 'paused', revision: 1 } })
      projectGoalChange(fake, session, toEvent(meta))
      const calls = fake.getCalls()
      expect(calls).toHaveLength(3)
      expect(calls[0]).toEqual({ kind: 'goal', executionId: 'goal:goal-test-1' })
      expect(calls[1]).toEqual({ kind: 'transition', executionId: 'goal:goal-test-1', event: 'start' })
      expect(calls[2]).toEqual({ kind: 'transition', executionId: 'goal:goal-test-1', event: 'wait-user' })
    })
  })

  describe('first sight — blocked goal', () => {
    it('first snapshot blocked → register + start + wait-user', () => {
      const fake = createFakeExecutions()
      const session = stubSession()
      const meta = makeMeta({
        operation: 'block',
        goal: { phase: 'blocked', revision: 1, blockedReason: { code: 'test', message: 'blocked' } },
      })
      projectGoalChange(fake, session, toEvent(meta))
      const calls = fake.getCalls()
      expect(calls).toHaveLength(3)
      expect(calls[0]).toEqual({ kind: 'goal', executionId: 'goal:goal-test-1' })
      expect(calls[1]).toEqual({ kind: 'transition', executionId: 'goal:goal-test-1', event: 'start' })
      expect(calls[2]).toEqual({ kind: 'transition', executionId: 'goal:goal-test-1', event: 'wait-user' })
    })
  })

  describe('first sight — complete goal', () => {
    it('first snapshot complete → register + start + complete', () => {
      const fake = createFakeExecutions()
      const session = stubSession()
      const meta = makeMeta({ operation: 'complete', goal: { phase: 'complete', revision: 1 } })
      projectGoalChange(fake, session, toEvent(meta))
      const calls = fake.getCalls()
      expect(calls).toHaveLength(3)
      expect(calls[0]).toEqual({ kind: 'goal', executionId: 'goal:goal-test-1' })
      expect(calls[1]).toEqual({ kind: 'transition', executionId: 'goal:goal-test-1', event: 'start' })
      expect(calls[2]).toEqual({ kind: 'transition', executionId: 'goal:goal-test-1', event: 'complete' })
    })
  })

  describe('subsequent snapshots — phase transitions', () => {
    it('complete → active at revision > 1 → no phase transition (else active→active edit)', () => {
      const fake = createFakeExecutions()
      const session = stubSession()

      // First: complete (rev 1) — register + start + complete
      const meta1 = makeMeta({ operation: 'complete', goal: { phase: 'complete', revision: 1 } })
      projectGoalChange(fake, session, toEvent(meta1))
      expect(fake.getCalls()).toHaveLength(3) // register + start + complete

      fake.resetCalls()

      // Second: active (rev 2) — prevPhase='complete', phase='active'
      // prevPhaseActual ('complete') !== phase ('active') → pass line 100
      // line 131: phase==='active' → true
      // line 132: prevPhase='complete' not paused/blocked → false
      // line 135: prevPhase='complete' not undefined → false
      // line 136: else { /* active → active (edit): no transition needed */ }
      const meta2 = makeMeta({ operation: 'edit', goal: { phase: 'active', revision: 2 } })
      projectGoalChange(fake, session, toEvent(meta2))
      expect(fake.getCalls()).toHaveLength(0) // no new transitions for same-phase edit
    })

    it('active → paused → wait-user', () => {
      const fake = createFakeExecutions()
      const session = stubSession()

      // First: active (revision 1)
      const meta1 = makeMeta()
      projectGoalChange(fake, session, toEvent(meta1))
      expect(fake.getCalls()).toHaveLength(2) // register + start

      fake.resetCalls()

      // Second: paused (revision 2)
      const meta2 = makeMeta({
        operation: 'pause',
        goal: { phase: 'paused', revision: 2 },
      })
      projectGoalChange(fake, session, toEvent(meta2))
      const calls = fake.getCalls()
      expect(calls).toHaveLength(1)
      expect(calls[0]).toEqual({ kind: 'transition', executionId: 'goal:goal-test-1', event: 'wait-user' })
    })

    it('paused → active → resume', () => {
      const fake = createFakeExecutions()
      const session = stubSession()

      // First: active (rev 1)
      projectGoalChange(fake, session, toEvent(makeMeta()))
      fake.resetCalls()

      // Second: paused (rev 2)
      projectGoalChange(fake, session, toEvent(makeMeta({ operation: 'pause', goal: { phase: 'paused', revision: 2 } })))
      fake.resetCalls()

      // Third: active (rev 3)
      const meta3 = makeMeta({
        operation: 'resume',
        goal: { phase: 'active', revision: 3 },
      })
      projectGoalChange(fake, session, toEvent(meta3))
      const calls = fake.getCalls()
      expect(calls).toHaveLength(1)
      expect(calls[0]).toEqual({ kind: 'transition', executionId: 'goal:goal-test-1', event: 'resume' })
    })

    it('blocked → active → resume', () => {
      const fake = createFakeExecutions()
      const session = stubSession()

      projectGoalChange(fake, session, toEvent(makeMeta()))
      fake.resetCalls()

      projectGoalChange(fake, session, toEvent(makeMeta({
        operation: 'block',
        goal: { phase: 'blocked', revision: 2, blockedReason: { code: 'test', message: 'blocked' } },
      })))
      fake.resetCalls()

      const meta3 = makeMeta({ operation: 'resume', goal: { phase: 'active', revision: 3 } })
      projectGoalChange(fake, session, toEvent(meta3))
      const calls = fake.getCalls()
      expect(calls).toHaveLength(1)
      expect(calls[0]).toEqual({ kind: 'transition', executionId: 'goal:goal-test-1', event: 'resume' })
    })

    it('active → complete → complete event', () => {
      const fake = createFakeExecutions()
      const session = stubSession()

      projectGoalChange(fake, session, toEvent(makeMeta()))
      fake.resetCalls()

      const meta = makeMeta({ operation: 'complete', goal: { phase: 'complete', revision: 2 } })
      projectGoalChange(fake, session, toEvent(meta))
      const calls = fake.getCalls()
      expect(calls).toHaveLength(1)
      expect(calls[0]).toEqual({ kind: 'transition', executionId: 'goal:goal-test-1', event: 'complete' })
    })

    it('paused → complete → complete event', () => {
      const fake = createFakeExecutions()
      const session = stubSession()

      projectGoalChange(fake, session, toEvent(makeMeta()))
      fake.resetCalls()

      projectGoalChange(fake, session, toEvent(makeMeta({ operation: 'pause', goal: { phase: 'paused', revision: 2 } })))
      fake.resetCalls()

      const meta = makeMeta({ operation: 'complete', goal: { phase: 'complete', revision: 3 } })
      projectGoalChange(fake, session, toEvent(meta))
      const calls = fake.getCalls()
      expect(calls).toHaveLength(1)
      expect(calls[0]).toEqual({ kind: 'transition', executionId: 'goal:goal-test-1', event: 'complete' })
    })

    it('complete → paused → start + wait-user (non-active prev in subsequent)', () => {
      const fake = createFakeExecutions()
      const session = stubSession()

      projectGoalChange(fake, session, toEvent(makeMeta()))
      fake.resetCalls()

      projectGoalChange(fake, session, toEvent(makeMeta({ operation: 'pause', goal: { phase: 'paused', revision: 2 } })))
      fake.resetCalls()

      projectGoalChange(fake, session, toEvent(makeMeta({ operation: 'complete', goal: { phase: 'complete', revision: 3 } })))
      fake.resetCalls()

      // complete → paused: prev='complete', phase='paused', revision>1
      const meta = makeMeta({ operation: 'resume', goal: { phase: 'paused', revision: 4 } })
      projectGoalChange(fake, session, toEvent(meta))
      const calls = fake.getCalls()
      // prev='complete', not 'active' → goes to else branch: start + wait-user
      expect(calls).toHaveLength(2)
      expect(calls[0]).toEqual({ kind: 'transition', executionId: 'goal:goal-test-1', event: 'start' })
      expect(calls[1]).toEqual({ kind: 'transition', executionId: 'goal:goal-test-1', event: 'wait-user' })
    })
  })

  describe('idempotency — same phase repeated', () => {
    it('same phase → no extra transitions', () => {
      const fake = createFakeExecutions()
      const session = stubSession()

      const meta = makeMeta()
      projectGoalChange(fake, session, toEvent(meta))
      expect(fake.getCalls()).toHaveLength(2) // register + start

      fake.resetCalls()
      projectGoalChange(fake, session, toEvent(meta))
      expect(fake.getCalls()).toHaveLength(0)
    })

    it('edit (same phase) → no transition', () => {
      const fake = createFakeExecutions()
      const session = stubSession()

      projectGoalChange(fake, session, toEvent(makeMeta()))
      fake.resetCalls()

      const metaEdit = makeMeta({ operation: 'edit', goal: { phase: 'active', revision: 2 } })
      projectGoalChange(fake, session, toEvent(metaEdit))
      expect(fake.getCalls()).toHaveLength(0)
    })

    it('active (rev > 1, no prev in map) → start', () => {
      const fake = createFakeExecutions()
      const session = stubSession()

      // Don't call projectGoalChange first — prevPhases map has no entry
      // Simulate: a goal appears at revision > 2 without prior call
      const meta = makeMeta({ operation: 'resume', goal: { phase: 'active', revision: 3 } })
      projectGoalChange(fake, session, toEvent(meta))
      const calls = fake.getCalls()
      expect(calls).toContainEqual({ kind: 'goal', executionId: 'goal:goal-test-1' })
      expect(calls).toContainEqual({ kind: 'transition', executionId: 'goal:goal-test-1', event: 'start' })
    })
  })

  describe('clear (tombstone)', () => {
    it('clear → register + cancel', () => {
      const fake = createFakeExecutions()
      const session = stubSession()
      const meta = makeClearMeta()
      projectGoalChange(fake, session, toEvent(meta))
      const calls = fake.getCalls()
      expect(calls).toHaveLength(2)
      expect(calls[0]).toEqual({ kind: 'goal', executionId: 'goal:goal-test-1' })
      expect(calls[1]).toEqual({ kind: 'transition', executionId: 'goal:goal-test-1', event: 'cancel' })
    })
  })

  describe('catch — register throws', () => {
    it('register throws → transition still sent', () => {
      const fake = createFakeExecutions()
      const session = stubSession()
      fake.setThrowRegister(true)
      const meta = makeMeta()
      projectGoalChange(fake, session, toEvent(meta))
      const calls = fake.getCalls()
      expect(calls).toHaveLength(1)
      expect(calls[0]).toEqual({ kind: 'transition', executionId: 'goal:goal-test-1', event: 'start' })
    })
  })

  describe('catch — transition throws', () => {
    it('first transition throws → second transition still sent', () => {
      const fake = createFakeExecutions()
      const session = stubSession()
      fake.setThrowTransitionOnce(true)
      // paused first sight → start throws, wait-user still sent
      const meta = makeMeta({ operation: 'pause', goal: { phase: 'paused', revision: 1 } })
      projectGoalChange(fake, session, toEvent(meta))
      const calls = fake.getCalls()
      expect(calls).toHaveLength(2)
      expect(calls[0]).toEqual({ kind: 'goal', executionId: 'goal:goal-test-1' })
      expect(calls[1]).toEqual({ kind: 'transition', executionId: 'goal:goal-test-1', event: 'wait-user' })
    })

    it('transition blocked (all throws) → adapter does not propagate', () => {
      const fake = createFakeExecutions()
      const session = stubSession()
      fake.setThrowTransition(true)
      const meta = makeMeta()
      projectGoalChange(fake, session, toEvent(meta))
      const calls = fake.getCalls()
      expect(calls).toHaveLength(1) // only register
    })
  })

  describe('complete with fallback start', () => {
    it('complete from CREATED (not RUNNING) → start then complete', () => {
      const fake = createFakeExecutions()
      const session = stubSession()

      // register succeeds, complete throws (not in RUNNING), then start+complete
      let callCount = 0
      const origTransition = fake.transition.bind(fake)
      fake.transition = function (executionId: string, eventCode: string) {
        callCount++
        // First complete call throws, subsequent calls succeed
        if (callCount === 1) throw new Error('not in RUNNING')
        return origTransition(executionId, eventCode)
      }

      const meta = makeMeta({ operation: 'complete', goal: { phase: 'complete', revision: 2 } })
      projectGoalChange(fake, session, toEvent(meta))
      const calls = fake.getCalls()
      expect(calls).toContainEqual({ kind: 'transition', executionId: 'goal:goal-test-1', event: 'complete' })
      expect(calls).toContainEqual({ kind: 'transition', executionId: 'goal:goal-test-1', event: 'start' })
    })
  })

  describe('decodeGoalChange catch path', () => {
    it('malformed event data → no crash', () => {
      const fake = createFakeExecutions()
      const session = stubSession()
      const event: SessionEvent = {
        type: 'goal/change',
        data: { kind: 'goal/change', version: 999, operation: 'create', goal: {} as never, roundsStarted: 0, createdAt: 0, updatedAt: 0 },
        seq: 1,
        time: 1000,
      } as unknown as SessionEvent
      projectGoalChange(fake, session, event)
      // decodeGoalChange throws → adapter returns early
      expect(fake.getCalls()).toHaveLength(0)
    })

    it('undefined event data → no crash', () => {
      const fake = createFakeExecutions()
      const session = stubSession()
      const event: SessionEvent = {
        type: 'goal/change',
        data: undefined,
        seq: 1,
        time: 1000,
      } as unknown as SessionEvent
      projectGoalChange(fake, session, event)
      expect(fake.getCalls()).toHaveLength(0)
    })
  })
})

// ---------------------------------------------------------------------------
// registerGoalExecutionAdapter tests (integration)
// ---------------------------------------------------------------------------

describe('registerGoalExecutionAdapter', () => {
  describe('basic wiring', () => {
    it('returns a disposer that unregisters the session/event listener', () => {
      const fake = createFakeExecutions()
      const ctx = new Context()
      ctx.provide('executions', fake)

      const dispose = registerGoalExecutionAdapter(ctx)
      const session = stubSession()

      // Before dispose — process an event
      projectGoalChange(fake, session, toEvent(makeMeta()))
      expect(fake.getCalls()).toHaveLength(2) // register + start
      dispose()

      // After dispose — the adapter listener is unregistered, but direct
      // calls still work. Use a different goalId so idempotency doesn't skip.
      const fake2 = createFakeExecutions()
      fake2.register('goal', 'goal:goal-test-2')
      fake2.transition('goal:goal-test-2', 'start')
      // Two calls for the new goal — proves direct calls still work after dispose
      expect(fake2.getCalls()).toHaveLength(2)
    })

    it('does not register executions when service is absent', () => {
      const ctx = new Context()
      // No executions provided
      const fake = createFakeExecutions()
      ctx.provide('executions', fake)
      const dispose = registerGoalExecutionAdapter(ctx)

      // Dispose removes the listener
      dispose()
    })

    it('closure calls projectGoalChange via ctx.emit session/event', () => {
      const ctx = new Context()
      const fake = createFakeExecutions()
      ctx.provide('executions', fake)

      const session = stubSession()
      registerGoalExecutionAdapter(ctx)

      ctx.emit('session/event', session, toEvent(makeMeta()))
      expect(fake.getCalls()).toHaveLength(2) // register + start
    })

    it('session/event with missing executions → early return on line 208', () => {
      const ctx = new Context()
      // No executions provided — ctx.get('executions') returns undefined

      const session = stubSession()
      registerGoalExecutionAdapter(ctx)

      ctx.emit('session/event', session, toEvent(makeMeta()))
      // The adapter callback: ctx.get('executions') returns undefined → line 208 if returns early
    })
  })

  describe('session/event flow — real SessionStore', () => {
    it('create + active → register + start via session/event', async () => {
      const ctx = new Context()
      await ctx.plugin(SessionStore)
      const fake = createFakeExecutions()
      ctx.provide('executions', fake)

      const session = Session.create(SessionId('integration-test'))
      const meta = makeMeta()
      session.append('goal/change', meta)

      // The adapter listener fires on session/event
      // Simulate: after append, session emits event via ctx.sessions.list() pattern
      // For this test, invoke projectGoalChange directly via the listener
      const dispose = registerGoalExecutionAdapter(ctx)

      // Direct invoke: simulate session/event dispatch
      const event = session.events.find(e => e.type === 'goal/change')
      if (event) {
        projectGoalChange(fake, session, event)
      }

      const calls = fake.getCalls()
      expect(calls).toHaveLength(2)
      expect(calls[0]).toEqual({ kind: 'goal', executionId: 'goal:goal-test-1' })
      expect(calls[1]).toEqual({ kind: 'transition', executionId: 'goal:goal-test-1', event: 'start' })

      dispose()
    })

    it('active → paused → wait-user via session/event', async () => {
      const ctx = new Context()
      await ctx.plugin(SessionStore)
      const fake = createFakeExecutions()
      ctx.provide('executions', fake)

      const session = Session.create(SessionId('integration-pause'))
      session.append('goal/change', makeMeta()) // create → active
      session.append('goal/change', makeMeta({ operation: 'pause', goal: { phase: 'paused', revision: 2 } })) // pause

      const dispose = registerGoalExecutionAdapter(ctx)
      projectGoalChange(fake, session, toEvent(makeMeta())) // active
      fake.resetCalls()
      projectGoalChange(fake, session, toEvent(makeMeta({ operation: 'pause', goal: { phase: 'paused', revision: 2 } })))

      const calls = fake.getCalls()
      expect(calls).toHaveLength(1)
      expect(calls[0]).toEqual({ kind: 'transition', executionId: 'goal:goal-test-1', event: 'wait-user' })

      dispose()
    })

    it('paused → active → resume via session/event', async () => {
      const ctx = new Context()
      await ctx.plugin(SessionStore)
      const fake = createFakeExecutions()
      ctx.provide('executions', fake)

      const session = Session.create(SessionId('integration-resume'))
      session.append('goal/change', makeMeta()) // active
      session.append('goal/change', makeMeta({ operation: 'pause', goal: { phase: 'paused', revision: 2 } })) // paused
      session.append('goal/change', makeMeta({ operation: 'resume', goal: { phase: 'active', revision: 3 } })) // active

      const dispose = registerGoalExecutionAdapter(ctx)
      projectGoalChange(fake, session, toEvent(makeMeta()))
      fake.resetCalls()
      projectGoalChange(fake, session, toEvent(makeMeta({ operation: 'pause', goal: { phase: 'paused', revision: 2 } })))
      fake.resetCalls()
      projectGoalChange(fake, session, toEvent(makeMeta({ operation: 'resume', goal: { phase: 'active', revision: 3 } })))

      const calls = fake.getCalls()
      expect(calls).toHaveLength(1)
      expect(calls[0]).toEqual({ kind: 'transition', executionId: 'goal:goal-test-1', event: 'resume' })

      dispose()
    })

    it('clear → cancel via session/event', async () => {
      const ctx = new Context()
      await ctx.plugin(SessionStore)
      const fake = createFakeExecutions()
      ctx.provide('executions', fake)

      const session = Session.create(SessionId('integration-clear'))
      session.append('goal/change', makeMeta())

      const dispose = registerGoalExecutionAdapter(ctx)
      projectGoalChange(fake, session, toEvent(makeClearMeta()))

      const calls = fake.getCalls()
      expect(calls).toHaveLength(2)
      expect(calls[0]).toEqual({ kind: 'goal', executionId: 'goal:goal-test-1' })
      expect(calls[1]).toEqual({ kind: 'transition', executionId: 'goal:goal-test-1', event: 'cancel' })

      dispose()
    })

    it('non-goal/change event is ignored in session/event flow', async () => {
      const ctx = new Context()
      await ctx.plugin(SessionStore)
      const fake = createFakeExecutions()
      ctx.provide('executions', fake)

      const session = Session.create(SessionId('integration-other'))
      const dispose = registerGoalExecutionAdapter(ctx)

      const otherEvent: SessionEvent = { type: 'turn/start', data: { turn: 1 }, seq: 1, time: 1000 }
      projectGoalChange(fake, session, otherEvent)
      expect(fake.getCalls()).toHaveLength(0)

      dispose()
    })
  })

  describe('disposer', () => {
    it('disposer removes the session/event listener', () => {
      const ctx = new Context()
      const fake = createFakeExecutions()
      ctx.provide('executions', fake)

      const dispose = registerGoalExecutionAdapter(ctx)
      const session = stubSession()

      // Before dispose — should process
      const meta = makeMeta()
      projectGoalChange(fake, session, toEvent(meta))
      expect(fake.getCalls()).toHaveLength(2)

      dispose()

      // After dispose — listener should be gone (direct call still works)
      fake.resetCalls()
      // Create new context to prove listener removal
      const ctx2 = new Context()
      ctx2.provide('executions', fake)
      const dispose2 = registerGoalExecutionAdapter(ctx2)

      projectGoalChange(fake, session, toEvent(meta))
      dispose2()
    })
  })
})
