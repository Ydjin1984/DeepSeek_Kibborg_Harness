/**
 * Pure execution state-machine transition function and validation.
 * Deterministic: given (currentStatus, event) → nextStatus (or throws).
 * @module @deepseek-ai/dsh-execution/state-machine
 */

import type { ExecutionStatus } from './types.ts'

/** Typed event that drives an SM transition. */
export interface ExecutionTransitionEvent {
  /** The event kind that triggers the transition. */
  type: ExecutionEventTypeCode
  /** Optional reason attached to the transition (undefined when omitted). */
  reason?: string | undefined
}

/** Discriminant for all SM-triggering events. */
export type ExecutionEventTypeCode =
  | 'start'
  | 'queue'
  | 'wait-tool'
  | 'wait-subagent'
  | 'wait-user'
  | 'complete'
  | 'fail'
  | 'cancel'
  | 'timeout'
  | 'abort'
  | 'interrupt'
  | 'recover'
  | 'resume'

/** Allowed source statuses per event type (keyed by event code). */
type AllowedSources = ReadonlySet<ExecutionStatus | undefined>

/** Build the immutable transition table at module load. */
function buildTransitionTable(): ReadonlyMap<ExecutionEventTypeCode, AllowedSources> {
  const table = new Map<ExecutionEventTypeCode, AllowedSources>()

  table.set('start', new Set<ExecutionStatus | undefined>([undefined, 'CREATED', 'QUEUED']))
  table.set('queue', new Set<ExecutionStatus | undefined>(['CREATED']))
  table.set('wait-tool', new Set<ExecutionStatus | undefined>(['RUNNING']))
  table.set('wait-subagent', new Set<ExecutionStatus | undefined>(['RUNNING']))
  table.set('wait-user', new Set<ExecutionStatus | undefined>(['RUNNING']))
  table.set('complete', new Set<ExecutionStatus | undefined>(['RUNNING', 'WAITING_TOOL', 'WAITING_SUBAGENT', 'WAITING_USER']))
  table.set('fail', new Set<ExecutionStatus | undefined>(['RUNNING', 'WAITING_TOOL', 'WAITING_SUBAGENT', 'WAITING_USER', 'RECOVERING', 'CREATED', 'QUEUED', 'INTERRUPTED']))
  table.set('cancel', new Set<ExecutionStatus | undefined>(['CREATED', 'QUEUED', 'RUNNING', 'WAITING_TOOL', 'WAITING_SUBAGENT', 'WAITING_USER']))
  table.set('timeout', new Set<ExecutionStatus | undefined>(['RUNNING', 'WAITING_TOOL', 'WAITING_SUBAGENT', 'WAITING_USER']))
  table.set('abort', new Set<ExecutionStatus | undefined>(['INTERRUPTED', 'RECOVERING', 'RUNNING', 'WAITING_TOOL', 'WAITING_SUBAGENT', 'WAITING_USER', 'QUEUED']))
  table.set('interrupt', new Set<ExecutionStatus | undefined>(['RUNNING', 'WAITING_TOOL', 'WAITING_SUBAGENT', 'WAITING_USER']))
  table.set('recover', new Set<ExecutionStatus | undefined>(['INTERRUPTED']))
  table.set('resume', new Set<ExecutionStatus | undefined>(['INTERRUPTED', 'RECOVERING', 'WAITING_TOOL', 'WAITING_SUBAGENT', 'WAITING_USER']))

  return table
}

const TRANSITION_TABLE = buildTransitionTable()

/** Set of statuses that have no outgoing transitions. */
const TERMINAL_STATUSES = new Set<ExecutionStatus>([
  'COMPLETED', 'FAILED', 'CANCELLED', 'TIMEOUT', 'ABORTED',
])

/**
 * Error thrown when a transition is invalid.
 * @dshSeverity high
 */
export class ExecutionTransitionError extends Error {
  override name = 'ExecutionTransitionError'
  readonly code = 'INVALID_TRANSITION' as const
  readonly fromStatus?: ExecutionStatus | undefined
  readonly eventCode: ExecutionEventTypeCode
  readonly allowed: readonly ExecutionStatus[]

  constructor(eventCode: ExecutionEventTypeCode, fromStatus: ExecutionStatus | undefined, allowed: readonly ExecutionStatus[]) {
    super(
      `invalid transition: ${fromStatus ?? 'none'} → ? via ${eventCode} (allowed: ${allowed.join(', ')})`,
    )
    this.eventCode = eventCode
    this.fromStatus = fromStatus
    this.allowed = allowed
  }
}

/**
 * Resolve the next status by consulting the transition table.
 * @param current — current status or `undefined` (pre-CREATED).
 * @param event — the transition event to apply.
 * @returns the next status.
 * @throws {@link ExecutionTransitionError} when the transition is not allowed.
 */
export function transition(current: ExecutionStatus | undefined, event: ExecutionTransitionEvent): ExecutionStatus {
  const allowed = TRANSITION_TABLE.get(event.type)
  if (!allowed) {
    throw new ExecutionTransitionError(event.type, current, [])
  }
  if (!allowed.has(current)) {
    const validAllowed = [...allowed].filter((s): s is ExecutionStatus => s !== undefined)
    throw new ExecutionTransitionError(event.type, current, validAllowed)
  }

  return resolveTarget(event.type)
}

/** Map each event code to its deterministic target status. */
function resolveTarget(eventCode: ExecutionEventTypeCode): ExecutionStatus {
  switch (eventCode) {
    case 'start':        return 'RUNNING'
    case 'queue':        return 'QUEUED'
    case 'wait-tool':    return 'WAITING_TOOL'
    case 'wait-subagent': return 'WAITING_SUBAGENT'
    case 'wait-user':    return 'WAITING_USER'
    case 'complete':     return 'COMPLETED'
    case 'fail':         return 'FAILED'
    case 'cancel':       return 'CANCELLED'
    case 'timeout':      return 'TIMEOUT'
    case 'abort':        return 'ABORTED'
    case 'interrupt':    return 'INTERRUPTED'
    case 'recover':      return 'RECOVERING'
    case 'resume':       return 'RUNNING'
    /* v8 ignore start — exhaustive check above */
    default: {
      const _exhaustive: never = eventCode
      throw new Error(`unhandled event type: ${JSON.stringify(_exhaustive)}`)
    }
    /* v8 ignore end */
  }
}

/**
 * Check whether a status is terminal (has no outgoing transitions).
 * @param status — status to check.
 * @returns `true` if no further transitions are allowed.
 */
export function isTerminal(status: ExecutionStatus): boolean {
  return TERMINAL_STATUSES.has(status)
}

/** All defined terminal statuses for iteration. */
export const TERMINAL_STATUSES_SET = TERMINAL_STATUSES
