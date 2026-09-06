/**
 * Execution lifecycle service (`ctx.executions`). Provides registration,
 * transition, and event emission for the unified state machine.
 * @module @deepseek-ai/dsh-execution
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { ExecutionRegistry, type ExecutionEventPayload } from './registry.ts'
import { ResourceLeaseRegistry, type ResourceEvent } from './resources.ts'
import type { ExecutionEventTypeCode } from './state-machine.ts'
import type { ExecutionKind, ExecutionState, ExecutionStatus } from './types.ts'
import type { ExecutionEvent } from './types.ts'

// ---------------------------------------------------------------------------
// Cordis event type extension
// ---------------------------------------------------------------------------

declare module '@deepseek-ai/cordis' {
  interface Context {
    executions: ExecutionService
  }
  interface Events {
    /**
     * Emitted whenever an execution event is appended to the registry.
     * @param payload - the appended event wrapped in a payload.
     */
    'execution/event': (payload: ExecutionEventPayload) => void
    /**
     * Emitted whenever a resource lease event occurs (acquire, heartbeat,
     * release, orphan).
     * @param payload - the resource event wrapped in a payload.
     */
    'executions/resource': (payload: { event: ResourceEvent }) => void
  }
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * Unified execution lifecycle service. Orchestrates the execution state machine
 * (registration, transitions, events) and the resource lease registry (external
 * resource lifecycle: chrome, pty, ida, workspace, subprocess).
 */
export class ExecutionService extends Service {
  static inject = ['invariants']

  private readonly registry: ExecutionRegistry
  private readonly _resources: ResourceLeaseRegistry

  constructor(ctx: Context) {
    super(ctx, 'executions')
    this.registry = new ExecutionRegistry(ctx)
    this._resources = new ResourceLeaseRegistry(ctx)
  }

  /**
   * Register a new execution. Creates a CREATED state.
   * @param kind — kind of execution.
   * @param executionId — unique execution identifier.
   * @param options — additional registration options.
   * @returns the created state.
   */
  register(kind: ExecutionKind, executionId: string, options?: {
    parentExecutionId?: string
    attempt?: number
    operationId?: string
  }): ExecutionState {
    return this.registry.register({
      kind,
      executionId,
      parentExecutionId: options?.parentExecutionId,
      attempt: options?.attempt ?? 1,
      operationId: options?.operationId,
    })
  }

  /**
   * Transition an execution through the state machine.
   * @param executionId — id of the execution to transition.
   * @param eventCode — the transition event code (e.g. 'start', 'complete').
   * @returns the new state.
   * @throws {@link ExecutionTransitionError} on invalid transition.
   */
  transition(executionId: string, eventCode: ExecutionEventTypeCode): ExecutionState {
    return this.registry.transition(executionId, eventCode)
  }

  /**
   * Force-set a terminal status (bypasses SM validation).
   * @param executionId — id of the execution.
   * @param status — terminal status.
   * @returns the updated state.
   */
  end(executionId: string, status: ExecutionStatus): ExecutionState {
    return this.registry.end(executionId, status)
  }

  /**
   * Get the current state of an execution.
   * @param executionId — id of the execution.
   * @returns a deep copy of the state, or `undefined`.
   */
  get(executionId: string): ExecutionState | undefined {
    return this.registry.get(executionId)
  }

  /**
   * List all registered executions.
   * @returns deep copies of all states.
   */
  list(): ExecutionState[] {
    return this.registry.list()
  }

  /**
   * List executions filtered by kind.
   * @param kind — kind to filter by.
   * @returns deep copies of matching states.
   */
  listByKind(kind: ExecutionKind): ExecutionState[] {
    return this.registry.listByKind(kind)
  }

  /**
   * Subscribe to execution events.
   * @param listener — callback for each new event.
   * @returns disposer that unregisters the listener.
   */
  on(listener: (event: ExecutionEvent) => void): () => void {
    return this.registry.on(listener)
  }

  /**
   * Access the underlying execution registry for advanced operations.
   */
  get registryRef(): ExecutionRegistry {
    return this.registry
  }

  /**
   * Resource lease registry for external resources (chrome, pty, ida,
   * workspace, subprocess). Provides acquire/heartbeat/release/orphan-sweep
   * with fail-closed status checks.
   */
  get resources(): ResourceLeaseRegistry {
    return this._resources
  }
}

export default ExecutionService

// Re-export the transition-event vocabulary for adapters that project
// subsystem statuses into the unified state machine.
export type { ExecutionEventTypeCode } from './state-machine.ts'
