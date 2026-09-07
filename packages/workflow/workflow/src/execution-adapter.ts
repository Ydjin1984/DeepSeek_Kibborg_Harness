/**
 * Execution adapter for the workflow capability seam.
 *
 * Projects Workflow lifecycle events (`workflow/start`, `workflow/end`) into
 * the unified execution state machine (`ctx.executions`). The adapter is
 * optional: it resolves the execution service lazily on every workflow event
 * via `ctx.get('executions')` (AGENTS.md optional-service pattern), so the
 * workflow package keeps working unchanged when the execution package is
 * absent — and the projection starts working as soon as the service mounts,
 * whatever the plugin-mount order.
 *
 * Projection model: listens for `workflow/*` Cordis events and maps each run's
 * lifecycle onto a state-machine event.
 *
 *   `workflow/start`     → register (CREATED) + start       (→ RUNNING)
 *   `workflow/end`       → terminal event depending on stopReason
 *                          completed → complete  (→ COMPLETED)
 *                          cancelled → cancel    (→ CANCELLED)
 *                          error     → fail      (→ FAILED)
 *
 * A run first observed in a terminal state gets a synthetic `start` before
 * the terminal event so the projection records a plausible RUNNING → terminal
 * history. Identical first-sight commits are ignored: projection is
 * best-effort and the execution registry remains the single source of truth.
 *
 * @module @deepseek-ai/dsh-workflow/execution-adapter
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ExecutionEventTypeCode } from '@deepseek-ai/dsh-execution'
import type { WorkflowStopReason } from './types.ts'

/** Disposer returned by the adapter registration. */
export type ExecutionAdapterRegistration = () => void

/** Minimal execution-service surface the adapter depends on. */
export interface ExecutionSurface {
  register(kind: string, executionId: string, options?: unknown): unknown
  transition(executionId: string, eventCode: ExecutionEventTypeCode): unknown
}

/**
 * Map a `WorkflowStopReason` onto its state-machine terminal event.
 * @param stopReason - the workflow stop reason.
 * @returns the corresponding execution event code, or `undefined` for unmapped reasons.
 */
function stopReasonEvent(stopReason: WorkflowStopReason): ExecutionEventTypeCode | undefined {
  switch (stopReason) {
    case 'completed': return 'complete'
    case 'cancelled': return 'cancel'
    case 'error':     return 'fail'
    /* v8 ignore start — WorkflowStopReason is a closed union of exactly three literals */
    default: {
      const _exhaustive: never = stopReason
      throw new Error(`unhandled stopReason: ${JSON.stringify(_exhaustive)}`)
    }
    /* v8 ignore end */
  }
}

/**
 * Process one workflow event against the execution surface.
 *
 * Pure in the sense that it only reads `eventName`/`info`/`result` and calls
 * `executions` methods; no side-effects beyond the execution registry.
 *
 * @param executions - lazy execution-service handle.
 * @param eventName - the Cordis event name (e.g. `'workflow/start'`).
 * @param info - the run's identity snapshot (id + meta).
 * @param result - the terminal result (only for `workflow/end`).
 */
export function projectWorkflowEvent(
  executions: ExecutionSurface,
  eventName: string,
  info: { id: string },
  result?: { stopReason: WorkflowStopReason },
): void {
  if (eventName === 'workflow/start') {
    projectWorkflowStart(executions, info)
    return
  }

  if (eventName === 'workflow/end' && result) {
    projectWorkflowEnd(executions, info, result.stopReason)
  }
}

/**
 * Handle a `workflow/start` event: register + start the execution.
 *
 * @param executions - lazy execution-service handle.
 * @param info - the run's identity snapshot.
 */
function projectWorkflowStart(
  executions: ExecutionSurface,
  info: { id: string },
): void {
  const executionId = `workflow:${info.id}`

  if (registered.has(executions, executionId)) return
  registered.add(executions, executionId)

  try {
    executions.register('workflow', executionId)
  } catch {
    // Already registered — proceed.
  }

  try {
    executions.transition(executionId, 'start')
  } catch {
    // Already RUNNING — projection is idempotent.
  }
}

/**
 * Handle a `workflow/end` event: project the terminal state-machine event.
 *
 * @param executions - lazy execution-service handle.
 * @param info - the run's identity snapshot.
 * @param stopReason - the workflow stop reason.
 */
function projectWorkflowEnd(
  executions: ExecutionSurface,
  info: { id: string },
  stopReason: WorkflowStopReason,
): void {
  const executionId = `workflow:${info.id}`
  const event = stopReasonEvent(stopReason)
  if (event === undefined) return

  // Ensure the execution was registered (covers the case where the adapter
  // starts listening after `workflow/start` already fired).
  if (!registered.has(executions, executionId)) {
    registered.add(executions, executionId)
    try {
      executions.register('workflow', executionId)
    } catch {
      // Already registered — proceed.
    }
  }

  // If the execution is not yet RUNNING (first sight at terminal), start first.
  try {
    executions.transition(executionId, event)
  } catch {
    // Not in RUNNING/WAITING_* — try start then the terminal event.
    try {
      executions.transition(executionId, 'start')
      executions.transition(executionId, event)
    } catch {
      // Best-effort projection, swallow.
    }
  }
}

/**
 * Per-executions registration tracker (attached as a private property).
 * Keeps `projectWorkflowEvent` directly testable with any surface.
 */
const registered = {
  has(executions: ExecutionSurface, executionId: string): boolean {
    return (executions as unknown as { _dsh_wf_registered?: Set<string> })._dsh_wf_registered?.has(executionId) ?? false
  },
  add(executions: ExecutionSurface, executionId: string): void {
    let set = (executions as unknown as { _dsh_wf_registered?: Set<string> })._dsh_wf_registered
    if (set === undefined) {
      set = new Set<string>()
      Object.defineProperty(executions, '_dsh_wf_registered', {
        value: set,
        writable: false,
        configurable: true,
      })
    }
    set.add(executionId)
  },
}

/**
 * Register the workflow execution adapter on a Cordis context.
 *
 * Listens for `workflow/start` and `workflow/end` events and projects
 * lifecycle transitions into the unified execution state machine.
 *
 * @param ctx — Cordis context with (optionally) the execution service.
 * @returns disposer that unregisters the projection subscriptions.
 */
export function registerWorkflowExecutionAdapter(ctx: Context): ExecutionAdapterRegistration {
  const unregisterStart = ctx.on('workflow/start', (info: { id: unknown }) => {
    // Resolve the execution service lazily on every event: plugin mounting is
    // topology-driven, so `ctx.executions` may become available after this
    // adapter registered. When the service is absent the projection is a no-op.
    const executions = ctx.get('executions') as ExecutionSurface | undefined
    if (executions === undefined) return
    projectWorkflowEvent(executions, 'workflow/start', info as { id: string })
  }, { global: true })

  const unregisterEnd = ctx.on('workflow/end', (info: { id: unknown }, result: { stopReason: string }) => {
    const executions = ctx.get('executions') as ExecutionSurface | undefined
    if (executions === undefined) return
    projectWorkflowEvent(executions, 'workflow/end', info as { id: string }, result as { stopReason: WorkflowStopReason })
  }, { global: true })

  return () => {
    unregisterStart()
    unregisterEnd()
  }
}
