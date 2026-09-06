/**
 * Tests for ExecutionRegistry: register, transition, end, observe, list.
 * @module @deepseek-ai/dsh-execution/registry.spec
 */

import { describe, it, expect } from 'vitest'
import { ExecutionRegistry } from '../src/registry.ts'
import { ExecutionTransitionError } from '../src/state-machine.ts'
import type { ExecutionEvent } from '../src/types.ts'
import type { ExecutionEventListener } from '../src/registry.ts'
import type { Context } from '@deepseek-ai/cordis'

// Minimal mock context for registry tests
function mockContext(): Context {
  const events: Array<{ name: string; args: unknown[] }> = []
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>()
  return {
    emit: (name: string, ...args: unknown[]) => {
      events.push({ name, args })
      const lsn = listeners.get(name)
      if (lsn) {
        for (const fn of lsn) {
          fn(...args)
        }
      }
    },
    on: (name: string, fn: (...args: unknown[]) => void) => {
      const existing = listeners.get(name) ?? []
      existing.push(fn)
      listeners.set(name, existing)
      return () => {}
    },
  } as unknown as Context
}

describe('ExecutionRegistry', () => {
  it('register creates a CREATED state', () => {
    const reg = new ExecutionRegistry(mockContext())
    const state = reg.register({
      executionId: 'job:1',
      kind: 'job',
    })
    expect(state.executionId).toBe('job:1')
    expect(state.kind).toBe('job')
    expect(state.status).toBe('CREATED')
    expect(state.attempt).toBe(1)
    expect(state.updatedAt).toBeGreaterThan(0)
  })

  it('register with options sets parent, attempt, operationId', () => {
    const reg = new ExecutionRegistry(mockContext())
    const state = reg.register({
      executionId: 'job:2',
      kind: 'job',
      parentExecutionId: 'parent-1',
      attempt: 3,
      operationId: 'op-123',
    })
    expect(state.parentExecutionId).toBe('parent-1')
    expect(state.attempt).toBe(3)
    expect(state.operationId).toBe('op-123')
  })

  it('register throws for duplicate executionId', () => {
    const reg = new ExecutionRegistry(mockContext())
    reg.register({ executionId: 'dup', kind: 'job' })
    expect(() => reg.register({ executionId: 'dup', kind: 'job' }))
      .toThrow('already registered')
  })

  it('full happy path: CREATED→QUEUED→RUNNING→WAITING_TOOL→RUNNING→COMPLETED', () => {
    const reg = new ExecutionRegistry(mockContext())
    const s0 = reg.register({ executionId: 'job:1', kind: 'job' })
    expect(s0.status).toBe('CREATED')

    const s1 = reg.transition('job:1', 'queue')
    expect(s1.status).toBe('QUEUED')

    const s2 = reg.transition('job:1', 'start')
    expect(s2.status).toBe('RUNNING')
    expect(s2.startedAt).toBeDefined()

    const s3 = reg.transition('job:1', 'wait-tool')
    expect(s3.status).toBe('WAITING_TOOL')

    const s4 = reg.transition('job:1', 'resume')
    expect(s4.status).toBe('RUNNING')

    const s5 = reg.transition('job:1', 'complete')
    expect(s5.status).toBe('COMPLETED')
    expect(s5.endedAt).toBeDefined()
  })

  it('events are appended with monotonically increasing seq', () => {
    const reg = new ExecutionRegistry(mockContext())
    const events: ExecutionEvent[] = []
    reg.on((ev) => { events.push(ev) })

    reg.register({ executionId: 'ev:1', kind: 'job' })
    expect(events[0]!.seq).toBe(1)
    expect(events[0]!.type).toBe('execution.created')

    reg.transition('ev:1', 'queue')
    expect(events[1]!.seq).toBe(2)
    expect(events[1]!.type).toBe('execution.transition')
    expect(events[1]!.seq).toBeGreaterThan(events[0]!.seq)
  })

  it('observe receives events', () => {
    const reg = new ExecutionRegistry(mockContext())
    const received: ExecutionEvent[] = []
    const dispose = reg.on((ev) => { received.push(ev) })

    reg.register({ executionId: 'obs:1', kind: 'workflow' })
    expect(received).toHaveLength(1)
    expect(received[0]!.executionId).toBe('obs:1')

    dispose()
    reg.transition('obs:1', 'start')
    expect(received).toHaveLength(1) // disposed listener not called
  })

  it('invalid transition throws and does NOT change state', () => {
    const reg = new ExecutionRegistry(mockContext())
    reg.register({ executionId: 'inv:1', kind: 'job' })

    const before = reg.get('inv:1')
    expect(before?.status).toBe('CREATED')

    expect(() => reg.transition('inv:1', 'complete'))
      .toThrow(ExecutionTransitionError)

    const after = reg.get('inv:1')
    expect(after?.status).toBe('CREATED') // unchanged
  })

  it('invalid transition does NOT append event', () => {
    const reg = new ExecutionRegistry(mockContext())
    const events: ExecutionEvent[] = []
    reg.on((ev) => { events.push(ev) })

    reg.register({ executionId: 'noev:1', kind: 'job' })
    expect(events).toHaveLength(1) // only created

    try {
      reg.transition('noev:1', 'complete')
    } catch { /* expected */ }

    expect(events).toHaveLength(1) // no new event
  })

  it('attempt/parent/operationId preserved through transitions', () => {
    const reg = new ExecutionRegistry(mockContext())
    reg.register({
      executionId: 'pres:1',
      kind: 'subagent',
      parentExecutionId: 'parent-abc',
      attempt: 2,
      operationId: 'op-x',
    })

    reg.transition('pres:1', 'queue')
    reg.transition('pres:1', 'start')

    const state = reg.get('pres:1')
    expect(state?.parentExecutionId).toBe('parent-abc')
    expect(state?.attempt).toBe(2)
    expect(state?.operationId).toBe('op-x')
  })

  it('terminal status does not accept transitions', () => {
    const reg = new ExecutionRegistry(mockContext())
    reg.register({ executionId: 'term:1', kind: 'goal' })
    reg.transition('term:1', 'queue')
    reg.transition('term:1', 'start')
    reg.transition('term:1', 'complete')

    expect(() => reg.transition('term:1', 'resume'))
      .toThrow('terminal')
  })

  it('end() forces a terminal status', () => {
    const reg = new ExecutionRegistry(mockContext())
    reg.register({ executionId: 'end:1', kind: 'job' })

    const state = reg.end('end:1', 'FAILED')
    expect(state.status).toBe('FAILED')
    expect(state.endedAt).toBeDefined()
  })

  it('end() on non-terminal status throws', () => {
    const reg = new ExecutionRegistry(mockContext())
    reg.register({ executionId: 'end2:1', kind: 'job' })
    expect(() => reg.end('end2:1', 'QUEUED')).toThrow('not terminal')
  })

  it('get() returns undefined for unknown id', () => {
    const reg = new ExecutionRegistry(mockContext())
    expect(reg.get('nope')).toBeUndefined()
  })

  it('list() returns all states', () => {
    const reg = new ExecutionRegistry(mockContext())
    reg.register({ executionId: 'list:1', kind: 'job' })
    reg.register({ executionId: 'list:2', kind: 'goal' })
    const all = reg.list()
    expect(all).toHaveLength(2)
  })

  it('listByKind() filters correctly', () => {
    const reg = new ExecutionRegistry(mockContext())
    reg.register({ executionId: 'bk:1', kind: 'job' })
    reg.register({ executionId: 'bk:2', kind: 'workflow' })
    reg.register({ executionId: 'bk:3', kind: 'job' })

    expect(reg.listByKind('job')).toHaveLength(2)
    expect(reg.listByKind('workflow')).toHaveLength(1)
    expect(reg.listByKind('goal')).toHaveLength(0)
  })

  it('get() returns deep copy', () => {
    const reg = new ExecutionRegistry(mockContext())
    reg.register({ executionId: 'dc:1', kind: 'job' })
    const s1 = reg.get('dc:1')!
    s1.status = 'FAILED'
    const s2 = reg.get('dc:1')!
    expect(s2.status).toBe('CREATED') // original unchanged
  })

  it('off() removes a listener', () => {
    const reg = new ExecutionRegistry(mockContext())
    const events: ExecutionEvent[] = []
    const listener: ExecutionEventListener = (ev) => { events.push(ev) }
    reg.on(listener)
    reg.register({ executionId: 'off:1', kind: 'job' })
    expect(events).toHaveLength(1)
    reg.off(listener)
    reg.transition('off:1', 'start')
    expect(events).toHaveLength(1) // listener not called after off
  })

  it('listener that throws is non-fatal', () => {
    const reg = new ExecutionRegistry(mockContext())
    const events: ExecutionEvent[] = []
    const goodListener: ExecutionEventListener = (ev) => { events.push(ev) }
    const badListener: ExecutionEventListener = () => { throw new Error('boom') }
    reg.on(badListener)
    reg.on(goodListener)
    reg.register({ executionId: 'throw:1', kind: 'job' })
    expect(events).toHaveLength(1) // good listener still called
    reg.off(goodListener)
    reg.off(badListener)
  })

  it('listener that returns a rejected promise is non-fatal', () => {
    const reg = new ExecutionRegistry(mockContext())
    const events: ExecutionEvent[] = []
    const badPromiseListener: ExecutionEventListener = () => Promise.reject(new Error('reject'))
    const goodListener: ExecutionEventListener = (ev) => { events.push(ev) }
    reg.on(badPromiseListener)
    reg.on(goodListener)
    reg.register({ executionId: 'reject:1', kind: 'job' })
    expect(events).toHaveLength(1) // good listener still called
    reg.off(goodListener)
    reg.off(badPromiseListener)
  })
})
