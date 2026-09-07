/**
 * Tests for ExecutionService: full integration via Context.plugin.
 * Covers register, transition, end, get, list, listByKind, on/off, registryRef.
 * @module @deepseek-ai/dsh-execution/execution-service.spec
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import ExecutionService from '../src/index.ts'
import type { ExecutionEvent } from '../src/types.ts'
import type { ExecutionEventListener } from '../src/registry.ts'

// ---------------------------------------------------------------------------
// Service tests — real composition through Context.plugin. The product plugin
// must activate without the diagnostics registry (shipping profiles omit it).
// ---------------------------------------------------------------------------

describe('ExecutionService', () => {
  let ctx: Context
  let service: ExecutionService

  beforeEach(async () => {
    ctx = new Context()
    await ctx.plugin(ExecutionService)
    service = ctx.executions
  })

  describe('constructor', () => {
    it('activates without the invariants service', () => {
      expect(service.list()).toEqual([])
    })

    it('creates a registry', () => {
      expect(service.registryRef).toBeDefined()
      expect(service.registryRef).toBeInstanceOf(Object)
    })
  })

  describe('register()', () => {
    it('registers an execution and returns CREATED state', () => {
      const state = service.register('job', 'job:1')
      expect(state.executionId).toBe('job:1')
      expect(state.kind).toBe('job')
      expect(state.status).toBe('CREATED')
      expect(state.attempt).toBe(1)
    })

    it('register with options sets parent/attempt/operationId', () => {
      const state = service.register('goal', 'goal:1', {
        parentExecutionId: 'parent-1',
        attempt: 2,
        operationId: 'op-abc',
      })
      expect(state.parentExecutionId).toBe('parent-1')
      expect(state.attempt).toBe(2)
      expect(state.operationId).toBe('op-abc')
    })

    it('register throws for duplicate executionId', () => {
      service.register('job', 'dup-1')
      expect(() => service.register('job', 'dup-1'))
        .toThrow('already registered')
    })
  })

  describe('transition()', () => {
    it('transitions CREATED→QUEUED→RUNNING', () => {
      service.register('job', 't:1')
      const s1 = service.transition('t:1', 'queue')
      expect(s1.status).toBe('QUEUED')
      const s2 = service.transition('t:1', 'start')
      expect(s2.status).toBe('RUNNING')
      expect(s2.startedAt).toBeDefined()
    })

    it('transition on non-registered execution throws', () => {
      expect(() => service.transition('nope', 'start'))
        .toThrow('not registered')
    })

    it('transition on terminal execution throws', () => {
      service.register('job', 'term:1')
      service.transition('term:1', 'queue')
      service.transition('term:1', 'start')
      service.transition('term:1', 'complete')
      expect(() => service.transition('term:1', 'resume'))
        .toThrow('terminal')
    })
  })

  describe('end()', () => {
    it('forces a terminal status', () => {
      service.register('job', 'end:1')
      const state = service.end('end:1', 'FAILED')
      expect(state.status).toBe('FAILED')
      expect(state.endedAt).toBeDefined()
    })

    it('end with non-terminal status throws', () => {
      service.register('job', 'end2:1')
      expect(() => service.end('end2:1', 'QUEUED')).toThrow('not terminal')
    })

    it('end on non-registered execution throws', () => {
      expect(() => service.end('nope', 'FAILED')).toThrow('not registered')
    })
  })

  describe('get()', () => {
    it('returns a deep copy of state', () => {
      service.register('job', 'get:1')
      const s1 = service.get('get:1')!
      s1.status = 'FAILED'
      const s2 = service.get('get:1')!
      expect(s2.status).toBe('CREATED')
    })

    it('returns undefined for unknown id', () => {
      expect(service.get('nope')).toBeUndefined()
    })
  })

  describe('list()', () => {
    it('returns deep copies of all states', () => {
      service.register('job', 'list:1')
      service.register('goal', 'list:2')
      const all = service.list()
      expect(all).toHaveLength(2)
      // Mutating returned copy does not affect internal state
      all[0]!.status = 'FAILED'
      expect(service.list()[0]!.status).toBe('CREATED')
    })
  })

  describe('listByKind()', () => {
    it('filters by kind', () => {
      service.register('job', 'bk:1')
      service.register('workflow', 'bk:2')
      service.register('job', 'bk:3')
      expect(service.listByKind('job')).toHaveLength(2)
      expect(service.listByKind('workflow')).toHaveLength(1)
      expect(service.listByKind('goal')).toHaveLength(0)
    })
  })

  describe('on()', () => {
    it('listener receives events', () => {
      const events: ExecutionEvent[] = []
      const dispose = service.on((ev) => { events.push(ev) })
      service.register('job', 'on:1')
      expect(events).toHaveLength(1)
      expect(events[0]!.type).toBe('execution.created')
      expect(events[0]!.executionId).toBe('on:1')
      // Disposer removes listener
      dispose()
      service.transition('on:1', 'queue')
      expect(events).toHaveLength(1) // no new events after dispose
    })

    it('registry off() removes a listener', () => {
      const events: ExecutionEvent[] = []
      const listener: ExecutionEventListener = (ev) => { events.push(ev) }
      service.registryRef.off(listener) // off before on (no-op)
      const dispose = service.registryRef.on(listener)
      service.register('job', 'off:1')
      service.transition('off:1', 'start')
      expect(events).toHaveLength(2) // created + transition
      // off also works
      service.registryRef.off(listener)
      service.transition('off:1', 'complete')
      expect(events).toHaveLength(2) // listener not called after off
      dispose() // cleanup
    })

    it('listener that throws is non-fatal', () => {
      const events: ExecutionEvent[] = []
      const badListener: ExecutionEventListener = () => { throw new Error('boom') }
      const goodListener: ExecutionEventListener = (ev) => { events.push(ev) }
      service.registryRef.on(badListener)
      service.registryRef.on(goodListener)
      service.register('job', 'throw:1')
      expect(events).toHaveLength(1) // good listener still called
      service.registryRef.off(goodListener)
      service.registryRef.off(badListener)
    })

    it('listener that returns a rejected promise is non-fatal', () => {
      const events: ExecutionEvent[] = []
      const badPromiseListener: ExecutionEventListener = () => Promise.reject(new Error('reject'))
      const goodListener: ExecutionEventListener = (ev) => { events.push(ev) }
      service.registryRef.on(badPromiseListener)
      service.registryRef.on(goodListener)
      service.register('job', 'reject:1')
      expect(events).toHaveLength(1) // good listener still called
      service.registryRef.off(goodListener)
      service.registryRef.off(badPromiseListener)
    })
  })

  describe('registryRef', () => {
    it('returns the underlying ExecutionRegistry', () => {
      expect(service.registryRef).toBeDefined()
      service.registryRef.register({ executionId: 'ref:1', kind: 'job' })
      expect(service.get('ref:1')).toBeDefined()
    })
  })
})
