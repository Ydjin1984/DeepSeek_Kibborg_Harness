/**
 * Pure types for the unified execution lifecycle state machine.
 * Normalised statuses and kind labels shared by the SM, registry, and adapters.
 * @module @deepseek-ai/dsh-execution/types
 */

/** Normalised execution lifecycle status. */
export type ExecutionStatus =
  | 'CREATED'
  | 'QUEUED'
  | 'RUNNING'
  | 'WAITING_TOOL'
  | 'WAITING_SUBAGENT'
  | 'WAITING_USER'
  | 'INTERRUPTED'
  | 'RECOVERING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED'
  | 'TIMEOUT'
  | 'ABORTED'

/** Kind of execution being projected into the unified state machine. */
export type ExecutionKind = 'job' | 'goal' | 'workflow' | 'subagent' | 'operation'

/** Idempotent handle for one execution instance. */
export interface ExecutionRef {
  /** Stable execution identifier, unique within the process. */
  executionId: string
  /** Parent execution id when this execution is a child of another. */
  parentExecutionId?: string
  /** Attempt counter for retry semantics. */
  attempt: number
}

/** Full projected execution state — source status is preserved for traceability. */
export interface ExecutionState {
  /** Stable execution identifier. */
  executionId: string
  /** Normalised kind label. */
  kind: ExecutionKind
  /** Normalised lifecycle status (one of the SM states). */
  status: ExecutionStatus
  /** Original status string from the source subsystem (e.g. 'paused'). */
  sourceStatus?: string | undefined
  /** Reason code / description for the current status (e.g. 'goal_paused'). */
  reason?: string | undefined
  /** Parent execution id when nested. */
  parentExecutionId?: string | undefined
  /** Attempt number (starts at 1). */
  attempt: number
  /** Operation id when tied to an operation context. */
  operationId?: string | undefined
  /** Resource lease reference (T3: chrome_17, pty_1, etc.). */
  resourceRef?: string | undefined
  /** Epoch ms when the execution started (RUNNING or later). */
  startedAt?: number | undefined
  /** Epoch ms of the latest status transition. */
  updatedAt: number
  /** Epoch ms of the terminal transition (present for terminal statuses). */
  endedAt?: number | undefined
}

/** Type of an execution lifecycle event. */
export type ExecutionEventType =
  | 'execution.created'
  | 'execution.transition'
  | 'execution.ended'

/** One appended event in the append-only execution event log. */
export interface ExecutionEvent {
  /** Monotonic sequence number across all events in this registry. */
  seq: number
  /** Execution id this event belongs to. */
  executionId: string
  /** Event type discriminator. */
  type: ExecutionEventType
  /** Previous status (absent for CREATED events). */
  from?: ExecutionStatus
  /** New status after transition. */
  to: ExecutionStatus
  /** Complete state snapshot at this event point. */
  state: ExecutionState
  /** Epoch ms at event creation. */
  time: number
}
