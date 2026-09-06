/**
 * In-process execution registry: append-only event log, status projection,
 * and listener subscriptions via Cordis typed events.
 * @module @deepseek-ai/dsh-execution/registry
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ExecutionEvent, ExecutionKind, ExecutionState, ExecutionStatus } from './types.ts'
import { isTerminal, transition, type ExecutionEventTypeCode } from './state-machine.ts'

/**
 * Options for registering a new execution in the registry.
 */
export interface RegisterOptions {
  /** Stable execution identifier (unique within this registry). */
  executionId: string
  /** Kind of execution being tracked. */
  kind: ExecutionKind
  /** Parent execution id when this is a child execution. */
  parentExecutionId?: string | undefined
  /** Attempt number (defaults to 1). */
  attempt?: number | undefined
  /** Operation id when tied to an operation context. */
  operationId?: string | undefined
}

/**
 * Typed event payload emitted by the ExecutionService via ctx.emit.
 * @dshSeverity high
 */
export interface ExecutionEventPayload {
  /** The appended event. */
  event: ExecutionEvent
}

/** Listener callback for new execution events. */
export type ExecutionEventListener = (event: ExecutionEvent) => void | PromiseLike<void>

// ---------------------------------------------------------------------------
// ExecutionRegistry — in-process append-only event log + state machine
// ---------------------------------------------------------------------------

/**
 * In-process registry that owns execution state and emits typed events.
 */
export class ExecutionRegistry {
  private readonly states = new Map<string, ExecutionState>()
  private readonly listeners = new Set<ExecutionEventListener>()
  private seq = 0
  private readonly ctx: Context

  constructor(ctx: Context) {
    this.ctx = ctx
  }

  /**
   * Register a new execution. Creates a CREATED state and emits the event.
   * @param opts — registration options.
   * @returns the created ExecutionState.
   */
  register(opts: RegisterOptions): ExecutionState {
    const { executionId, kind, parentExecutionId, attempt = 1, operationId } = opts

    if (this.states.has(executionId)) {
      throw new Error(`execution "${executionId}" is already registered`)
    }

    const now = Date.now()
    const state: ExecutionState = {
      executionId,
      kind,
      status: 'CREATED',
      parentExecutionId: parentExecutionId ?? undefined,
      attempt,
      operationId: operationId ?? undefined,
      updatedAt: now,
    }

    this.states.set(executionId, state)

    const event = this.appendEvent({
      executionId,
      type: 'execution.created',
      to: 'CREATED',
      state,
      time: now,
    })

    this.broadcast(event)

    return state
  }

  /**
   * Apply a transition event to an execution. Updates state machine,
   * appends the event, broadcasts to listeners.
   * @param executionId — id of the execution to transition.
   * @param eventCode — the transition event code.
   * @returns the new ExecutionState (deep copy).
   * @throws {@link ExecutionTransitionError} on invalid transition.
   */
  transition(executionId: string, eventCode: ExecutionEventTypeCode): ExecutionState {
    const state = this.states.get(executionId)
    if (!state) {
      throw new Error(`execution "${executionId}" is not registered`)
    }

    if (isTerminal(state.status)) {
      throw new Error(`execution "${executionId}" is terminal (${state.status}) and cannot transition`)
    }

    const newStatus = transition(state.status, { type: eventCode })

    const now = Date.now()
    const prevState = { ...state }
    state.status = newStatus
    state.updatedAt = now

    if (newStatus === 'RUNNING' && state.startedAt === undefined) {
      state.startedAt = now
    }

    if (isTerminal(newStatus)) {
      state.endedAt = now
    }

    const event = this.appendEvent({
      executionId,
      type: 'execution.transition',
      from: prevState.status,
      to: newStatus,
      state: { ...state },
      time: now,
    })

    this.broadcast(event)

    return { ...state }
  }

  /**
   * Force-set a terminal status (bypasses SM validation).
   * @param executionId — id of the execution.
   * @param status — terminal status to set.
   * @returns the updated state.
   */
  end(executionId: string, status: ExecutionStatus): ExecutionState {
    const state = this.states.get(executionId)
    if (!state) {
      throw new Error(`execution "${executionId}" is not registered`)
    }
    if (!isTerminal(status)) {
      throw new Error(`status "${status}" is not terminal`)
    }

    const now = Date.now()
    const previous = state.status
    state.status = status
    state.endedAt = now
    state.updatedAt = now

    const event = this.appendEvent({
      executionId,
      type: 'execution.ended',
      from: previous,
      to: status,
      state: { ...state },
      time: now,
    })

    this.broadcast(event)

    return { ...state }
  }

  /**
   * Get the current state of an execution.
   * @param executionId — id of the execution.
   * @returns a deep copy of the state, or `undefined` if not found.
   */
  get(executionId: string): ExecutionState | undefined {
    const state = this.states.get(executionId)
    return state ? { ...state } : undefined
  }

  /**
   * List all registered executions.
   * @returns deep copies of all states.
   */
  list(): ExecutionState[] {
    return [...this.states.values()].map(s => ({ ...s }))
  }

  /**
   * List executions filtered by kind.
   * @param kind — kind to filter by.
   * @returns deep copies of matching states.
   */
  listByKind(kind: ExecutionKind): ExecutionState[] {
    return [...this.states.values()]
      .filter(s => s.kind === kind)
      .map(s => ({ ...s }))
  }

  /**
   * Subscribe to execution events.
   * @param listener — callback for each new event.
   * @returns disposer that unregisters the listener.
   */
  on(listener: ExecutionEventListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /**
   * Unregister a listener.
   * @param listener — the listener to remove.
   */
  off(listener: ExecutionEventListener): void {
    this.listeners.delete(listener)
  }

  // ---- internal ----

  private appendEvent(payload: Omit<ExecutionEvent, 'seq'>): ExecutionEvent {
    this.seq += 1
    const event: ExecutionEvent = { ...payload, seq: this.seq }
    return event
  }

  private broadcast(event: ExecutionEvent): void {
    for (const listener of this.listeners) {
      try {
        const result = listener(event)
        if (result && typeof (result as Promise<unknown>).then === 'function') {
          ;(result as Promise<unknown>).catch(() => {
            /* v8 ignore next — listener rejection is non-fatal */
          })
        }
      } catch {
        /* v8 ignore next — listener throw is non-fatal */
      }
    }

    // Also emit via Cordis typed events
    this.ctx.emit('execution/event', { event })
  }
}
