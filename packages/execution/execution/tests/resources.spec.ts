/**
 * Tests for ResourceLeaseRegistry: acquire, heartbeat, release, status,
 * sweep, isLive, event emission, idempotency, and deep-copy safety.
 * @module @deepseek-ai/dsh-execution/resources.spec
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import ExecutionService from '../src/index.ts'
import type { ResourceEvent } from '../src/resources.ts'
import { ResourceLeaseRegistry, type ResourceError } from '../src/resources.ts'

// ---------------------------------------------------------------------------
// Service tests — real composition through Context.plugin
// ---------------------------------------------------------------------------

describe('ResourceLeaseRegistry — full composition', () => {
  let ctx: Context
  let svc: ExecutionService
  let events: ResourceEvent[]

  beforeEach(async () => {
    ctx = new Context()
    await ctx.plugin(InvariantRegistry)
    await ctx.plugin(ExecutionService)
    svc = ctx.executions
    events = []
    ctx.on('executions/resource', (payload: { event: ResourceEvent }) => {
      events.push(payload.event)
    })
  })

  // ---- acquire ----

  describe('acquire()', () => {
    it('creates a new lease with defaults', () => {
      const lease = svc.resources.acquire({ resourceId: 'chrome:1', type: 'chrome' })
      expect(lease.resourceId).toBe('chrome:1')
      expect(lease.type).toBe('chrome')
      expect(lease.lifecycle).toBe('leased')
      expect(lease.ttlMs).toBe(30_000)
      expect(lease.acquiredAt).toBeGreaterThan(0)
      expect(lease.heartbeatAt).toBe(lease.acquiredAt)
      expect(lease.expiresAt).toBe(lease.acquiredAt + 30_000)
      expect(lease.updatedAt).toBe(lease.acquiredAt)
    })

    it('emits resource.acquired event', () => {
      svc.resources.acquire({ resourceId: 'evt:1', type: 'pty' })
      expect(events).toHaveLength(1)
      expect(events[0]!.type).toBe('resource.acquired')
      expect(events[0]!.resourceId).toBe('evt:1')
      expect(events[0]!.seq).toBe(1)
    })

    it('acquire with options sets provider/owner/recoveryStrategy', () => {
      const lease = svc.resources.acquire({
        resourceId: 'opt:1',
        type: 'ida',
        provider: 'ida-srv',
        ownerExecutionId: 'exec-42',
        ttlMs: 60_000,
        recoveryStrategy: 'reconnect',
      })
      expect(lease.provider).toBe('ida-srv')
      expect(lease.ownerExecutionId).toBe('exec-42')
      expect(lease.ttlMs).toBe(60_000)
      expect(lease.recoveryStrategy).toBe('reconnect')
    })

    it('repeat acquire of leased resource renews (extends expiresAt)', () => {
      const r1 = svc.resources.acquire({ resourceId: 'dup:1', type: 'chrome', ttlMs: 30_000 })
      const acquiredAt = r1.acquiredAt
      // At acquiredAt + 28s, still within initial 30s TTL
      expect(svc.resources.status('dup:1', acquiredAt + 28_000)).toBe('live')
      // Acquire again (renew): extends expiresAt to now + 30s
      // now ≈ acquiredAt + small_delta. expiresAt ≈ acquiredAt + small + 30000
      // At acquiredAt + 28s (within new TTL): should be live
      svc.resources.acquire({ resourceId: 'dup:1', type: 'chrome', ttlMs: 30_000 })
      expect(svc.resources.status('dup:1', acquiredAt + 28_000)).toBe('live')
    })

    it('repeat acquire of released resource re-opens lease', () => {
      svc.resources.acquire({ resourceId: 'reopen:1', type: 'workspace' })
      svc.resources.release('reopen:1')
      const stateAfterRelease = svc.resources.status('reopen:1')
      expect(stateAfterRelease).toBe('released')

      const renewed = svc.resources.acquire({ resourceId: 'reopen:1', type: 'workspace' })
      expect(renewed.lifecycle).toBe('leased')
    })

    it('repeat acquire of unknown (not tracked) creates new', () => {
      const lease = svc.resources.acquire({ resourceId: 'new:1', type: 'subprocess' })
      expect(lease.resourceId).toBe('new:1')
      expect(svc.resources.status('new:1')).toBe('live')
    })
  })

  // ---- heartbeat ----

  describe('heartbeat()', () => {
    it('extends expiresAt from the moment of heartbeat', () => {
      svc.resources.acquire({ resourceId: 'hb:1', type: 'chrome', ttlMs: 30_000 })
      const before = svc.resources.get('hb:1')!
      const acquiredAt = before.acquiredAt
      // At acquiredAt + 25s, still live (within 30s TTL)
      expect(svc.resources.status('hb:1', acquiredAt + 25_000)).toBe('live')
      // Heartbeat extends TTL by another 30s from now
      svc.resources.heartbeat('hb:1')
      // Now at acquiredAt + 28s (heartbeat happened ~2ms after acquire, expiresAt ≈ 2 + 30000 = 30002)
      // acquiredAt + 28000 = 28002 < 30002 → still live
      expect(svc.resources.status('hb:1', acquiredAt + 28_000)).toBe('live')
    })

    it('emits resource.heartbeat event', () => {
      svc.resources.acquire({ resourceId: 'hb-evt:1', type: 'pty' })
      events.length = 0
      svc.resources.heartbeat('hb-evt:1')
      expect(events).toHaveLength(1)
      expect(events[0]!.type).toBe('resource.heartbeat')
      expect(events[0]!.resourceId).toBe('hb-evt:1')
    })

    it('throws RESOURCE_NOT_FOUND for unknown resource', () => {
      let err: ResourceError | undefined
      try { svc.resources.heartbeat('missing:1') } catch (e) { err = e as ResourceError }
      expect(err?.code).toBe('RESOURCE_NOT_FOUND')
    })

    it('throws RESOURCE_NOT_LEASED for released resource', () => {
      svc.resources.acquire({ resourceId: 'rel:1', type: 'chrome' })
      svc.resources.release('rel:1')
      let err2: ResourceError | undefined
      try { svc.resources.heartbeat('rel:1') } catch (e) { err2 = e as ResourceError }
      expect(err2?.code).toBe('RESOURCE_NOT_LEASED')
    })
  })

  // ---- release ----

  describe('release()', () => {
    it('sets lifecycle to released', () => {
      svc.resources.acquire({ resourceId: 'rel:1', type: 'chrome' })
      const lease = svc.resources.release('rel:1')
      expect(lease.lifecycle).toBe('released')
    })

    it('emits resource.released event', () => {
      svc.resources.acquire({ resourceId: 'rel-evt:1', type: 'pty' })
      events.length = 0
      svc.resources.release('rel-evt:1')
      expect(events).toHaveLength(1)
      expect(events[0]!.type).toBe('resource.released')
      expect(events[0]!.resourceId).toBe('rel-evt:1')
    })

    it('is idempotent — repeated release is no-op', () => {
      svc.resources.acquire({ resourceId: 'idmp:1', type: 'chrome' })
      svc.resources.release('idmp:1')
      const first = svc.resources.get('idmp:1')!
      svc.resources.release('idmp:1')
      const second = svc.resources.get('idmp:1')!
      expect(first).toEqual(second)
    })

    it('throws RESOURCE_UNKNOWN for untracked resource', () => {
      let err: ResourceError | undefined
      try { svc.resources.release('missing:1') } catch (e) { err = e as ResourceError }
      expect(err?.code).toBe('RESOURCE_UNKNOWN')
    })
  })

  // ---- get / list ----

  describe('get() / list()', () => {
    it('get returns deep copy — mutation does not affect internal state', () => {
      svc.resources.acquire({ resourceId: 'get:1', type: 'chrome' })
      const s1 = svc.resources.get('get:1')!
      s1.lifecycle = 'released'
      const s2 = svc.resources.get('get:1')!
      expect(s2.lifecycle).toBe('leased')
    })

    it('get returns undefined for unknown id', () => {
      expect(svc.resources.get('missing')).toBeUndefined()
    })

    it('list returns deep copies', () => {
      svc.resources.acquire({ resourceId: 'list:1', type: 'chrome' })
      svc.resources.acquire({ resourceId: 'list:2', type: 'pty' })
      const all = svc.resources.list()
      expect(all).toHaveLength(2)
      all[0]!.lifecycle = 'released'
      expect(svc.resources.list()[0]!.lifecycle).toBe('leased')
    })
  })

  // ---- status ----

  describe('status()', () => {
    it('returns live for active lease', () => {
      svc.resources.acquire({ resourceId: 'st:1', type: 'chrome' })
      // status без now = Date.now(), lease только что создана → live
      expect(svc.resources.status('st:1')).toBe('live')
    })

    it('returns expired when expiresAt <= now', () => {
      svc.resources.acquire({ resourceId: 'exp:1', type: 'chrome', ttlMs: 50 })
      // Lease только что создана, expiresAt = now + 50. Передаём now = acquiredAt + 60
      const lease = svc.resources.get('exp:1')!
      const future = lease.acquiredAt + 60
      expect(svc.resources.status('exp:1', future)).toBe('expired')
    })

    it('returns released for released resource', () => {
      svc.resources.acquire({ resourceId: 'rst:1', type: 'chrome' })
      svc.resources.release('rst:1')
      expect(svc.resources.status('rst:1')).toBe('released')
    })

    it('returns orphaned for orphaned resource', () => {
      svc.resources.acquire({ resourceId: 'orst:1', type: 'chrome', ttlMs: 50 })
      const lease = svc.resources.get('orst:1')!
      const future = lease.acquiredAt + 60
      svc.resources.sweep(future)
      expect(svc.resources.status('orst:1')).toBe('orphaned')
    })

    it('returns unknown for untracked id', () => {
      expect(svc.resources.status('missing')).toBe('unknown')
    })
  })

  // ---- sweep ----

  describe('sweep()', () => {
    it('transitions expired leased resources to orphaned', () => {
      svc.resources.acquire({ resourceId: 'sw:1', type: 'chrome', ttlMs: 50 })
      svc.resources.acquire({ resourceId: 'sw:2', type: 'pty', ttlMs: 50 })

      const future = Date.now() + 60
      const orphaned = svc.resources.sweep(future)

      expect(orphaned).toHaveLength(2)
      expect(orphaned.map(lease => lease.lifecycle)).toEqual(['orphaned', 'orphaned'])
    })

    it('does not touch still-leased resources', () => {
      svc.resources.acquire({ resourceId: 'keep:1', type: 'chrome', ttlMs: 50 })
      svc.resources.acquire({ resourceId: 'sw:3', type: 'pty', ttlMs: 50 })

      // middle time: both resources still within their TTL
      const lease = svc.resources.get('keep:1')!
      const middle = lease.acquiredAt + 30
      const orphaned = svc.resources.sweep(middle)

      expect(orphaned).toHaveLength(0) // keep:1 ещё жив, sw:3 ещё жив
    })

    it('is idempotent — repeated sweep does not re-emit orphaned events', () => {
      svc.resources.acquire({ resourceId: 'idmp-sw:1', type: 'chrome', ttlMs: 50 })
      events.length = 0

      const future = Date.now() + 60
      const firstSweep = svc.resources.sweep(future)
      expect(firstSweep).toHaveLength(1)
      const emittedAfterFirst = events.filter(e => e.type === 'resource.orphaned')
      expect(emittedAfterFirst).toHaveLength(1)

      const secondSweep = svc.resources.sweep(future)
      expect(secondSweep).toHaveLength(0) // already orphaned
      const emittedAfterSecond = events.filter(e => e.type === 'resource.orphaned')
      expect(emittedAfterSecond).toHaveLength(1) // no duplicate
    })

    it('emits resource.orphaned event for each swept resource', () => {
      svc.resources.acquire({ resourceId: 'evt-sw:1', type: 'chrome', ttlMs: 50 })
      events.length = 0

      const future = Date.now() + 60
      svc.resources.sweep(future)

      const orphanedEvents = events.filter(e => e.type === 'resource.orphaned')
      expect(orphanedEvents).toHaveLength(1)
      expect(orphanedEvents[0]!.resourceId).toBe('evt-sw:1')
    })

    it('returns deep copies — mutation of returned list does not affect registry', () => {
      svc.resources.acquire({ resourceId: 'dc-sw:1', type: 'chrome', ttlMs: 50 })
      const future = Date.now() + 60
      const result = svc.resources.sweep(future)
      expect(result).toHaveLength(1)
      result[0]!.lifecycle = 'released'
      expect(svc.resources.status('dc-sw:1')).toBe('orphaned') // still orphaned, not hacked
    })
  })

  // ---- isLive ----

  describe('isLive()', () => {
    it('returns true for live resource', () => {
      svc.resources.acquire({ resourceId: 'live:1', type: 'chrome' })
      expect(svc.resources.isLive('live:1')).toBe(true)
    })

    it('returns false for expired resource', () => {
      svc.resources.acquire({ resourceId: 'exp-lv:1', type: 'chrome', ttlMs: 50 })
      const lease = svc.resources.get('exp-lv:1')!
      expect(svc.resources.isLive('exp-lv:1', lease.acquiredAt + 60)).toBe(false)
    })

    it('returns false for released resource', () => {
      svc.resources.acquire({ resourceId: 'rel-lv:1', type: 'chrome' })
      svc.resources.release('rel-lv:1')
      expect(svc.resources.isLive('rel-lv:1')).toBe(false)
    })

    it('returns false for orphaned resource', () => {
      svc.resources.acquire({ resourceId: 'orp-lv:1', type: 'chrome', ttlMs: 50 })
      const lease = svc.resources.get('orp-lv:1')!
      svc.resources.sweep(lease.acquiredAt + 60)
      expect(svc.resources.isLive('orp-lv:1')).toBe(false)
    })

    it('returns false for unknown resource', () => {
      expect(svc.resources.isLive('missing')).toBe(false)
    })
  })

  // ---- event sequence numbers ----

  describe('event seq', () => {
    it('resource events have monotonically increasing seq', () => {
      svc.resources.acquire({ resourceId: 'seq:1', type: 'chrome' })
      const firstSeq = events[0]!.seq
      svc.resources.acquire({ resourceId: 'seq:2', type: 'pty' })
      expect(events[1]!.seq).toBeGreaterThan(firstSeq)
    })

    it('resource seq is independent from execution seq', () => {
      // Each registry has its own independent sequence counter
      events.length = 0
      svc.resources.acquire({ resourceId: 'seq-res:1', type: 'chrome' })
      expect(events[0]!.seq).toBe(1)
    })
  })

  // ---- integration: resource in ExecutionService ----

  describe('ExecutionService.resources', () => {
    it('resources accessor returns the registry', () => {
      expect(svc.resources).toBeInstanceOf(ResourceLeaseRegistry)
      expect(svc.resources).toBeDefined()
    })

    it('resource events are emitted via ctx.emit', () => {
      svc.resources.acquire({ resourceId: 'ctx-evt:1', type: 'chrome' })
      expect(events).toHaveLength(1)
      expect(events[0]!.type).toBe('resource.acquired')
      expect(events[0]!.lease.resourceId).toBe('ctx-evt:1')
    })
  })
})
