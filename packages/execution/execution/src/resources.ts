/**
 * Resource Lease Registry — in-process tracking of external resource leases
 * (chrome, pty, ida, workspace, subprocess) with lease/heartbeat/orphan-sweep
 * lifecycle and fail-closed helpers.
 * @module @deepseek-ai/dsh-execution/resources
 */

import type { Context } from '@deepseek-ai/cordis'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Category of external resource being leased. Known values: 'chrome', 'pty',
 * 'ida', 'workspace', 'subprocess'; open-ended for host-specific kinds.
 */
export type ResourceType = string

/** Current lifecycle phase of a lease. */
export type ResourceLifecycle = 'leased' | 'released' | 'orphaned'

/** Fail-closed status for quick resource health checks. */
export type ResourceStatus = 'live' | 'expired' | 'released' | 'orphaned' | 'unknown'

/**
 * Recovery strategy when a resource is orphaned.
 */
export type RecoveryStrategy = 'reconnect' | 'recreate' | 'reconnect_or_recreate'

/**
 * A single resource lease record.
 *
 * `acquiredAt` is set once at lease creation; `expiresAt` advances on every
 * heartbeat so that repeated heartbeats keep the lease alive as long as
 * heartbeats arrive within every TTL window.
 */
export interface ResourceLease {
  /** Stable resource identifier (unique within this registry). */
  resourceId: string
  /** Resource category. */
  type: ResourceType
  /** Optional provider handle (e.g. CDP endpoint, PTY name). */
  provider?: string | undefined
  /** Execution id that owns this lease. */
  ownerExecutionId?: string | undefined
  /** Current lifecycle phase. */
  lifecycle: ResourceLifecycle
  /** Lease lifetime in ms (set at acquire, does not change on heartbeat). */
  ttlMs: number
  /** Epoch ms when this lease was first acquired. */
  acquiredAt: number
  /** Epoch ms of the last successful heartbeat. */
  heartbeatAt: number
  /** Epoch ms when this lease expires (acquiredAt + ttlMs, updated on heartbeat). */
  expiresAt: number
  /** How to recover when the resource is orphaned. */
  recoveryStrategy?: RecoveryStrategy | undefined
  /** Epoch ms of the latest state mutation (acquire / heartbeat / release). */
  updatedAt: number
}

/** Options passed to `acquire()`. */
export interface AcquireResourceOptions {
  /** Unique resource identifier. */
  resourceId: string
  /** Resource category. */
  type: ResourceType
  /** Optional provider handle. */
  provider?: string | undefined
  /** Owner execution id. */
  ownerExecutionId?: string | undefined
  /** Lease TTL in ms (defaults to 30 000). */
  ttlMs?: number
  /** Recovery strategy for orphaned resources. */
  recoveryStrategy?: RecoveryStrategy
}

/** Discriminant for resource lifecycle events. */
export type ResourceEventType =
  | 'resource.acquired'
  | 'resource.heartbeat'
  | 'resource.released'
  | 'resource.orphaned'

/**
 * Event emitted for every resource lifecycle change.
 * Contains a monotonic `seq` scoped to the resource registry.
 */
export interface ResourceEvent {
  /** Monotonic sequence number (resource-registry scope). */
  seq: number
  /** Event type discriminator. */
  type: ResourceEventType
  /** Resource id this event belongs to. */
  resourceId: string
  /** Lease snapshot at this event point. */
  lease: ResourceLease
  /** Epoch ms at event creation. */
  time: number
}

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

/** Error thrown for invalid resource operations. */
export class ResourceError extends Error {
  override name = 'ResourceError'

  constructor(public readonly code: string, message: string) {
    super(message)
  }
}

// ---------------------------------------------------------------------------
// ResourceLeaseRegistry — in-process lease tracker
// ---------------------------------------------------------------------------

/**
 * In-process registry that tracks external resource leases with TTL-based
 * expiration, heartbeat extension, and orphan sweep.
 *
 * Events are broadcast via `ctx.emit('executions/resource', { event })`.
 */
export class ResourceLeaseRegistry {
  private readonly leases = new Map<string, ResourceLease>()
  private seq = 0
  private readonly ctx: Context

  /** Default TTL in ms when the caller omits `ttlMs`. */
  private static readonly DEFAULT_TTL_MS = 30_000

  constructor(ctx: Context) {
    this.ctx = ctx
  }

  /**
   * Acquire (or renew) a resource lease.
   *
   * - If the resource is `leased`, treats this as a renew: updates `expiresAt`
   *   to `now + ttlMs`, refreshes `heartbeatAt` and `updatedAt`, emits
   *   `resource.acquired`, and returns the lease.
   * - If the resource is `released`, `orphaned`, or unknown, opens a new
   *   lease (same behaviour as first acquire).
   *
   * @param opts — acquisition options.
   * @returns the resulting `ResourceLease` (deep copy).
   */
  acquire(opts: AcquireResourceOptions): ResourceLease {
    const {
      resourceId,
      type,
      provider,
      ownerExecutionId,
      ttlMs = ResourceLeaseRegistry.DEFAULT_TTL_MS,
      recoveryStrategy,
    } = opts

    const now = Date.now()
    const existing = this.leases.get(resourceId)

    let lease: ResourceLease
    if (existing && existing.lifecycle === 'leased') {
      // Renew: extend expiresAt, update heartbeat
      lease = { ...existing }
      lease.expiresAt = now + ttlMs
      lease.heartbeatAt = now
      lease.updatedAt = now
    } else {
      lease = {
        resourceId,
        type,
        provider,
        ownerExecutionId,
        lifecycle: 'leased',
        ttlMs,
        acquiredAt: now,
        heartbeatAt: now,
        expiresAt: now + ttlMs,
        recoveryStrategy,
        updatedAt: now,
      }
      this.leases.set(resourceId, lease)
    }

    // Emit event (use internal seq, not the state-machine one)
    const event = this.appendResourceEvent({
      resourceId,
      type: 'resource.acquired',
      lease: { ...lease },
      time: now,
    })

    this.ctx.emit('executions/resource', { event })

    return { ...lease }
  }

  /**
   * Send a heartbeat for an active lease — extends `expiresAt` by `ttlMs`
   * from now and updates `heartbeatAt`.
   *
   * @param resourceId — id of the resource to heartbeat.
   * @returns the updated `ResourceLease` (deep copy).
   * @throws `ResourceError` with code `'RESOURCE_NOT_FOUND'` if unknown.
   * @throws `ResourceError` with code `'RESOURCE_NOT_LEASED'` if not in `leased` state.
   */
  heartbeat(resourceId: string): ResourceLease {
    const lease = this.leases.get(resourceId)

    if (!lease) {
      throw new ResourceError(
        'RESOURCE_NOT_FOUND',
        `resource "${resourceId}" is not tracked`,
      )
    }

    if (lease.lifecycle !== 'leased') {
      throw new ResourceError(
        'RESOURCE_NOT_LEASED',
        `resource "${resourceId}" is in "${lease.lifecycle}" state (not leased)`,
      )
    }

    const now = Date.now()
    lease.expiresAt = now + lease.ttlMs
    lease.heartbeatAt = now
    lease.updatedAt = now

    const event = this.appendResourceEvent({
      resourceId,
      type: 'resource.heartbeat',
      lease: { ...lease },
      time: now,
    })

    this.ctx.emit('executions/resource', { event })

    return { ...lease }
  }

  /**
   * Release a lease — sets lifecycle to `'released'`.
   *
   * Idempotent: calling on an already-released lease is a no-op.
   *
   * @param resourceId — id of the resource to release.
   * @returns the updated `ResourceLease` (deep copy).
   * @throws `ResourceError` with code `'RESOURCE_UNKNOWN'` if the id is not tracked.
   */
  release(resourceId: string): ResourceLease {
    const lease = this.leases.get(resourceId)

    if (!lease) {
      throw new ResourceError(
        'RESOURCE_UNKNOWN',
        `resource "${resourceId}" is not tracked`,
      )
    }

    // Idempotent: already released → no-op
    if (lease.lifecycle === 'released') {
      return { ...lease }
    }

    const now = Date.now()
    lease.lifecycle = 'released'
    lease.updatedAt = now

    const event = this.appendResourceEvent({
      resourceId,
      type: 'resource.released',
      lease: { ...lease },
      time: now,
    })

    this.ctx.emit('executions/resource', { event })

    return { ...lease }
  }

  /**
   * Get a single resource lease by id.
   *
   * @param resourceId — id of the resource.
   * @returns a deep copy of the lease, or `undefined` if not tracked.
   */
  get(resourceId: string): ResourceLease | undefined {
    const lease = this.leases.get(resourceId)
    return lease ? { ...lease } : undefined
  }

  /**
   * List all tracked resource leases.
   *
   * @returns deep copies of all leases.
   */
  list(): ResourceLease[] {
    return [...this.leases.values()].map(l => ({ ...l }))
  }

  /**
   * Determine the fail-closed health status of a resource.
   *
   * Pure read — does not mutate state.  A leased resource with
   * `expiresAt <= now` reports `'expired'` but does not set lifecycle to
   * `'orphaned'` (that happens in `sweep()`).
   *
   * @param resourceId — id of the resource.
   * @param now — optional epoch ms timestamp (defaults to `Date.now()`).
   * @returns the status string.
   */
  status(resourceId: string, now = Date.now()): ResourceStatus {
    const lease = this.leases.get(resourceId)

    if (!lease) return 'unknown'
    if (lease.lifecycle === 'released') return 'released'
    if (lease.lifecycle === 'orphaned') return 'orphaned'
    // lease.lifecycle === 'leased'
    if (lease.expiresAt <= now) return 'expired'
    return 'live'
  }

  /**
   * Sweep expired leases: find `leased` resources with `expiresAt <= now`,
   * transition them to `'orphaned'`, emit `resource.orphaned` once per
   * resource, and return deep copies.
   *
   * Idempotent: already-orphaned leases are skipped (no duplicate events).
   *
   * @param now — optional epoch ms timestamp (defaults to `Date.now()`).
   * @returns deep copies of the orphaned leases.
   */
  sweep(now = Date.now()): ResourceLease[] {
    const orphaned: ResourceLease[] = []

    for (const lease of this.leases.values()) {
      if (lease.lifecycle !== 'leased') continue
      if (lease.expiresAt > now) continue

      // Transition to orphaned
      lease.lifecycle = 'orphaned'
      lease.updatedAt = now

      const event = this.appendResourceEvent({
        resourceId: lease.resourceId,
        type: 'resource.orphaned',
        lease: { ...lease },
        time: now,
      })

      this.ctx.emit('executions/resource', { event })
      orphaned.push({ ...lease })
    }

    return orphaned
  }

  /**
   * Fail-closed helper: is the resource currently live?
   *
   * Returns `true` only if the resource is tracked, in `leased` state, and
   * `expiresAt > now`.  `false` for expired, released, orphaned, or unknown.
   *
   * @param resourceId — id of the resource.
   * @param now — optional epoch ms timestamp (defaults to `Date.now()`).
   * @returns `true` if live, `false` otherwise.
   */
  isLive(resourceId: string, now = Date.now()): boolean {
    const lease = this.leases.get(resourceId)
    if (!lease) return false
    if (lease.lifecycle !== 'leased') return false
    return lease.expiresAt > now
  }

  // ---- internal helpers ----

  /**
   * Increment the resource-event sequence counter and build the event
   * envelope.
   */
  private appendResourceEvent(payload: Omit<ResourceEvent, 'seq'>): ResourceEvent {
    this.seq += 1
    const event: ResourceEvent = { ...payload, seq: this.seq }
    return event
  }
}
