/**
 * Tests for the pure state-machine transition function.
 * Covers all valid transitions and invalid transition errors.
 * @module @deepseek-ai/dsh-execution/state-machine.spec
 */

import { describe, it, expect } from 'vitest'
import { transition, isTerminal, ExecutionTransitionError, TERMINAL_STATUSES_SET } from '../src/state-machine.ts'
import type { ExecutionStatus } from '../src/types.ts'

describe('state-machine', () => {
  describe('transition()', () => {
    it('undefined → CREATED via start', () => {
      expect(transition(undefined, { type: 'start' })).toBe('RUNNING')
    })

    it('CREATED → QUEUED via queue', () => {
      expect(transition('CREATED', { type: 'queue' })).toBe('QUEUED')
    })

    it('CREATED → CANCELLED via cancel', () => {
      expect(transition('CREATED', { type: 'cancel' })).toBe('CANCELLED')
    })

    it('QUEUED → RUNNING via start', () => {
      expect(transition('QUEUED', { type: 'start' })).toBe('RUNNING')
    })

    it('QUEUED → CANCELLED via cancel', () => {
      expect(transition('QUEUED', { type: 'cancel' })).toBe('CANCELLED')
    })

    it('RUNNING → WAITING_TOOL via wait-tool', () => {
      expect(transition('RUNNING', { type: 'wait-tool' })).toBe('WAITING_TOOL')
    })

    it('RUNNING → WAITING_SUBAGENT via wait-subagent', () => {
      expect(transition('RUNNING', { type: 'wait-subagent' })).toBe('WAITING_SUBAGENT')
    })

    it('RUNNING → WAITING_USER via wait-user', () => {
      expect(transition('RUNNING', { type: 'wait-user' })).toBe('WAITING_USER')
    })

    it('RUNNING → COMPLETED via complete', () => {
      expect(transition('RUNNING', { type: 'complete' })).toBe('COMPLETED')
    })

    it('RUNNING → FAILED via fail', () => {
      expect(transition('RUNNING', { type: 'fail' })).toBe('FAILED')
    })

    it('RUNNING → CANCELLED via cancel', () => {
      expect(transition('RUNNING', { type: 'cancel' })).toBe('CANCELLED')
    })

    it('RUNNING → INTERRUPTED via interrupt', () => {
      expect(transition('RUNNING', { type: 'interrupt' })).toBe('INTERRUPTED')
    })

    it('RUNNING → TIMEOUT via timeout', () => {
      expect(transition('RUNNING', { type: 'timeout' })).toBe('TIMEOUT')
    })

    it('RUNNING → ABORTED via abort', () => {
      expect(transition('RUNNING', { type: 'abort' })).toBe('ABORTED')
    })

    // WAITING_* transitions
    it('WAITING_TOOL → RUNNING via resume', () => {
      expect(transition('WAITING_TOOL', { type: 'resume' })).toBe('RUNNING')
    })

    it('WAITING_TOOL → CANCELLED via cancel', () => {
      expect(transition('WAITING_TOOL', { type: 'cancel' })).toBe('CANCELLED')
    })

    it('WAITING_TOOL → TIMEOUT via timeout', () => {
      expect(transition('WAITING_TOOL', { type: 'timeout' })).toBe('TIMEOUT')
    })

    it('WAITING_TOOL → ABORTED via abort', () => {
      expect(transition('WAITING_TOOL', { type: 'abort' })).toBe('ABORTED')
    })

    it('WAITING_SUBAGENT → RUNNING via resume', () => {
      expect(transition('WAITING_SUBAGENT', { type: 'resume' })).toBe('RUNNING')
    })

    it('WAITING_SUBAGENT → CANCELLED via cancel', () => {
      expect(transition('WAITING_SUBAGENT', { type: 'cancel' })).toBe('CANCELLED')
    })

    it('WAITING_USER → RUNNING via resume', () => {
      expect(transition('WAITING_USER', { type: 'resume' })).toBe('RUNNING')
    })

    it('WAITING_USER → CANCELLED via cancel', () => {
      expect(transition('WAITING_USER', { type: 'cancel' })).toBe('CANCELLED')
    })

    // INTERRUPTED transitions
    it('INTERRUPTED → RECOVERING via recover', () => {
      expect(transition('INTERRUPTED', { type: 'recover' })).toBe('RECOVERING')
    })

    it('INTERRUPTED → ABORTED via abort', () => {
      expect(transition('INTERRUPTED', { type: 'abort' })).toBe('ABORTED')
    })

    it('INTERRUPTED → FAILED via fail', () => {
      expect(transition('INTERRUPTED', { type: 'fail' })).toBe('FAILED')
    })

    // RECOVERING transitions
    it('RECOVERING → RUNNING via resume', () => {
      expect(transition('RECOVERING', { type: 'resume' })).toBe('RUNNING')
    })

    it('RECOVERING → FAILED via fail', () => {
      expect(transition('RECOVERING', { type: 'fail' })).toBe('FAILED')
    })

    // Terminal states: complete/fail/cancel from waiting
    it('WAITING_TOOL → COMPLETED via complete', () => {
      expect(transition('WAITING_TOOL', { type: 'complete' })).toBe('COMPLETED')
    })

    it('WAITING_SUBAGENT → COMPLETED via complete', () => {
      expect(transition('WAITING_SUBAGENT', { type: 'complete' })).toBe('COMPLETED')
    })

    it('WAITING_USER → COMPLETED via complete', () => {
      expect(transition('WAITING_USER', { type: 'complete' })).toBe('COMPLETED')
    })

    // fail from CREATED, QUEUED
    it('CREATED → FAILED via fail', () => {
      expect(transition('CREATED', { type: 'fail' })).toBe('FAILED')
    })

    it('QUEUED → FAILED via fail', () => {
      expect(transition('QUEUED', { type: 'fail' })).toBe('FAILED')
    })

    // abort from QUEUED
    it('QUEUED → ABORTED via abort', () => {
      expect(transition('QUEUED', { type: 'abort' })).toBe('ABORTED')
    })
  })

  describe('invalid transitions', () => {
    it('COMPLETED → RUNNING via start throws', () => {
      expect(() => transition('COMPLETED', { type: 'start' }))
        .toThrow(ExecutionTransitionError)
    })

    it('FAILED → COMPLETED via complete throws', () => {
      expect(() => transition('FAILED', { type: 'complete' }))
        .toThrow(ExecutionTransitionError)
    })

    it('CANCELLED → RUNNING via resume throws', () => {
      expect(() => transition('CANCELLED', { type: 'resume' }))
        .toThrow(ExecutionTransitionError)
    })

    it('TIMEOUT → RUNNING via resume throws', () => {
      expect(() => transition('TIMEOUT', { type: 'resume' }))
        .toThrow(ExecutionTransitionError)
    })

    it('ABORTED → RECOVERING via recover throws', () => {
      expect(() => transition('ABORTED', { type: 'recover' }))
        .toThrow(ExecutionTransitionError)
    })

    it('RUNNING → QUEUED via queue throws', () => {
      expect(() => transition('RUNNING', { type: 'queue' }))
        .toThrow(ExecutionTransitionError)
    })

    it('WAITING_TOOL → RUNNING via start throws (must use resume)', () => {
      expect(() => transition('WAITING_TOOL', { type: 'start' }))
        .toThrow(ExecutionTransitionError)
    })

    it('INTERRUPTED → RUNNING via resume throws when from RECOVERING', () => {
      // INTERRUPTED can go to RUNNING via resume
      expect(transition('INTERRUPTED', { type: 'resume' })).toBe('RUNNING')
    })

    it('COMPLETED → FAILED via fail throws', () => {
      expect(() => transition('COMPLETED', { type: 'fail' }))
        .toThrow(ExecutionTransitionError)
    })

    it('QUEUED → INTERRUPTED via interrupt throws', () => {
      expect(() => transition('QUEUED', { type: 'interrupt' }))
        .toThrow(ExecutionTransitionError)
    })
  })

  describe('isTerminal()', () => {
    it('COMPLETED is terminal', () => {
      expect(isTerminal('COMPLETED')).toBe(true)
    })

    it('FAILED is terminal', () => {
      expect(isTerminal('FAILED')).toBe(true)
    })

    it('CANCELLED is terminal', () => {
      expect(isTerminal('CANCELLED')).toBe(true)
    })

    it('TIMEOUT is terminal', () => {
      expect(isTerminal('TIMEOUT')).toBe(true)
    })

    it('ABORTED is terminal', () => {
      expect(isTerminal('ABORTED')).toBe(true)
    })

    it('RUNNING is not terminal', () => {
      expect(isTerminal('RUNNING')).toBe(false)
    })

    it('CREATED is not terminal', () => {
      expect(isTerminal('CREATED')).toBe(false)
    })

    it('QUEUED is not terminal', () => {
      expect(isTerminal('QUEUED')).toBe(false)
    })

    it('WAITING_TOOL is not terminal', () => {
      expect(isTerminal('WAITING_TOOL')).toBe(false)
    })

    it('INTERRUPTED is not terminal', () => {
      expect(isTerminal('INTERRUPTED')).toBe(false)
    })
  })

  describe('ExecutionTransitionError', () => {
    it('has correct code and properties', () => {
      const err = new ExecutionTransitionError('start', 'COMPLETED', ['RUNNING'])
      expect(err.name).toBe('ExecutionTransitionError')
      expect(err.code).toBe('INVALID_TRANSITION')
      expect(err.fromStatus).toBe('COMPLETED')
      expect(err.eventCode).toBe('start')
      expect(err.allowed).toEqual(['RUNNING'])
      expect(err.message).toContain('COMPLETED')
      expect(err.message).toContain('start')
    })

    it('fromStatus is undefined string in message for pre-CREATED', () => {
      const err = new ExecutionTransitionError('start', undefined, [])
      expect(err.fromStatus).toBeUndefined()
      expect(err.message).toContain('none')
      expect(err.allowed).toEqual([])
    })

    it('allowed contains only ExecutionStatus (no undefined)', () => {
      // transition from COMPLETED via start: allowed = {undefined, CREATED, QUEUED} → filtered to [CREATED, QUEUED]
      let caught: ExecutionTransitionError | undefined
      try { transition('COMPLETED', { type: 'start' }) }
      catch (e) { if (e instanceof ExecutionTransitionError) caught = e }
      expect(caught).toBeDefined()
      for (const s of caught!.allowed) {
        expect(s).not.toBeUndefined()
      }
    })
  })

  describe('unknown event type', () => {
    it('transition with unknown event type throws ExecutionTransitionError with allowed=[]', () => {
      // Should throw because TRANSITION_TABLE has no entry for 'bogus'
      let caught: ExecutionTransitionError | undefined
      try { transition('CREATED', { type: 'bogus' as never }) }
      catch (e) { if (e instanceof ExecutionTransitionError) caught = e }
      expect(caught).toBeInstanceOf(ExecutionTransitionError)
      const ete = caught!
      expect(ete.code).toBe('INVALID_TRANSITION')
      expect(ete.allowed).toEqual([])
    })
  })

  describe('transition from status not in allowed (filter removes undefined)', () => {
    it('COMPLETED → start throws with allowed=[CREATED, QUEUED] (no undefined)', () => {
      expect(() => transition('COMPLETED', { type: 'start' }))
        .toThrow(ExecutionTransitionError)
      let caught: ExecutionTransitionError | undefined
      try { transition('COMPLETED', { type: 'start' }) }
      catch (e) { if (e instanceof ExecutionTransitionError) caught = e }
      expect(caught).toBeDefined()
      expect(caught!.fromStatus).toBe('COMPLETED')
      expect(caught!.eventCode).toBe('start')
      expect(caught!.allowed).toEqual(['CREATED', 'QUEUED'])
    })
  })

  describe('TERMINAL_STATUSES_SET', () => {
    it('contains all terminal statuses', () => {
      const terminal: ExecutionStatus[] = ['COMPLETED', 'FAILED', 'CANCELLED', 'TIMEOUT', 'ABORTED']
      for (const status of terminal) {
        expect(TERMINAL_STATUSES_SET.has(status)).toBe(true)
      }
    })

    it('contains no non-terminal statuses', () => {
      const nonTerminal: ExecutionStatus[] = ['CREATED', 'QUEUED', 'RUNNING', 'WAITING_TOOL', 'WAITING_SUBAGENT', 'WAITING_USER', 'INTERRUPTED', 'RECOVERING']
      for (const status of nonTerminal) {
        expect(TERMINAL_STATUSES_SET.has(status)).toBe(false)
      }
    })
  })
})
