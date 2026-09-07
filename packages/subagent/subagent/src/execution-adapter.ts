/**
 * Execution adapter for the subagent capability seam.
 *
 * Projects subagent lifecycle events (`subagent/start`, `subagent/end`) into
 * the unified execution state machine (`ctx.executions`). The adapter is
 * optional: it resolves the execution service lazily on every subagent event
 * via `ctx.get('executions')` (AGENTS.md optional-service pattern), so the
 * subagent package keeps working unchanged when the execution package is
 * absent — and the projection starts working as soon as the service mounts,
 * whatever the plugin-mount order.
 *
 * Projection model: listens for `subagent/*` Cordis events and maps each run's
 * lifecycle onto a state-machine event.
 *
 *   `subagent/start`       → register (CREATED) + start       (→ RUNNING)
 *   `subagent/end`         → terminal event depending on stopReason
 *                          completed → complete  (→ COMPLETED)
 *                          aborted   → abort     (→ ABORTED)
 *                          error     → fail      (→ FAILED)
 *                          max-tokens→ fail      (→ FAILED)
 *                          refusal   → fail      (→ FAILED)
 *
 * A run first observed in a terminal state gets a synthetic `start` before
 * the terminal event so the projection records a plausible RUNNING → terminal
 * history. Identical first-sight commits are ignored: projection is
 * best-effort and the execution registry remains the single source of truth.
 *
 * @module @deepseek-ai/dsh-subagent/execution-adapter
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ExecutionEventTypeCode } from '@deepseek-ai/dsh-execution'
import type { SubagentRunEndInfo, SubagentRunInfo, SubagentStopReason } from './types.ts'

/** Disposer returned by the adapter registration. */
export type ExecutionAdapterRegistration = () => void

/** Minimal execution-service surface the adapter depends on. */
export interface ExecutionSurface {
  register(kind: string, executionId: string, options?: unknown): unknown
  transition(executionId: string, eventCode: ExecutionEventTypeCode): unknown
}

/**
 * Map a `SubagentStopReason` onto its state-machine terminal event.
 *
 * - `completed` → `complete`  (clean finish → COMPLETED)
 * - `aborted`   → `abort`     (signal/disposal cancellation → ABORTED)
 * - `error`     → `fail`      (model or transport failure → FAILED)
 * - `max-tokens`→ `fail`      (token ceiling exceeded → FAILED;
 *   chosen over `timeout` because max-tokens is a resource limit, not a timer expiry)
 * - `refusal`   → `fail`      (child declined the task → FAILED)
 *
 * @param stopReason - the subagent stop reason.
 * @returns the corresponding execution event code, or `undefined` for unmapped reasons.
 */
function stopReasonEvent(stopReason: SubagentStopReason): ExecutionEventTypeCode | undefined {
  switch (stopReason) {
    case 'completed': return 'complete'
    case 'aborted':   return 'abort'
    case 'error':     return 'fail'
    case 'max-tokens': return 'fail'
    case 'refusal':   return 'fail'
    /* v8 ignore start — SubagentStopReason is a merge-extensible union of exactly five literals */
    default: {
      const _exhaustive: never = stopReason
      throw new Error(`unhandled stopReason: ${JSON.stringify(_exhaustive)}`)
    }
    /* v8 ignore end */
  }
}

/**
 * Process one subagent event against the execution surface.
 *
 * Pure in the sense that it only reads `eventName`/`info`/`result` and calls
 * `executions` methods; no side-effects beyond the execution registry.
 *
 * @param executions - lazy execution-service handle.
 * @param eventName - the Cordis event name (e.g. `'subagent/start'`).
 * @param info - the run's identity snapshot.
 * @param result - the terminal result (only for `subagent/end`).
 */
export function projectSubagentEvent(
  executions: ExecutionSurface,
  eventName: string,
  info: SubagentRunInfo,
  result?: { stopReason: SubagentStopReason },
): void {
  if (eventName === 'subagent/start') {
    projectSubagentStart(executions, info)
    return
  }

  if (eventName === 'subagent/end' && result) {
    projectSubagentEnd(executions, info, result.stopReason)
  }
}

/**
 * Handle a `subagent/start` event: register + start the execution.
 *
 * @param executions - lazy execution-service handle.
 * @param info - the run's identity snapshot.
 */
function projectSubagentStart(
  executions: ExecutionSurface,
  info: SubagentRunInfo,
): void {
  const executionId = `subagent:${String(info.runId)}`

  if (registered.has(executions, executionId)) return
  registered.add(executions, executionId)

  try {
    executions.register('subagent', executionId)
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
 * Handle a `subagent/end` event: project the terminal state-machine event.
 *
 * If the execution was not yet registered (adapter started listening after
 * `subagent/start` already fired), registers first. If the execution is not
 * yet RUNNING (first sight at terminal), emits a synthetic `start` before the
 * terminal event so the SM accepts the transition.
 *
 * @param executions - lazy execution-service handle.
 * @param info - the run's identity snapshot.
 * @param stopReason - the subagent stop reason.
 */
function projectSubagentEnd(
  executions: ExecutionSurface,
  info: SubagentRunInfo,
  stopReason: SubagentStopReason,
): void {
  const executionId = `subagent:${String(info.runId)}`
  const event = stopReasonEvent(stopReason)
  if (event === undefined) return

  // Ensure the execution was registered (covers the case where the adapter
  // starts listening after `subagent/start` already fired).
  if (!registered.has(executions, executionId)) {
    registered.add(executions, executionId)
    try {
      executions.register('subagent', executionId)
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
 * Keeps `projectSubagentEvent` directly testable with any surface.
 */
const registered = {
  has(executions: ExecutionSurface, executionId: string): boolean {
    return (executions as unknown as { _dsh_sa_registered?: Set<string> })._dsh_sa_registered?.has(executionId) ?? false
  },
  add(executions: ExecutionSurface, executionId: string): void {
    let set = (executions as unknown as { _dsh_sa_registered?: Set<string> })._dsh_sa_registered
    if (set === undefined) {
      set = new Set<string>()
      Object.defineProperty(executions, '_dsh_sa_registered', {
        value: set,
        writable: false,
        configurable: true,
      })
    }
    set.add(executionId)
  },
}

/**
 * Register the subagent execution adapter on a Cordis context.
 *
 * Listens for `subagent/start` and `subagent/end` events and projects
 * lifecycle transitions into the unified execution state machine.
 *
 * @param ctx — Cordis context with (optionally) the execution service.
 * @returns disposer that unregisters the projection subscriptions.
 */
export function registerSubagentExecutionAdapter(ctx: Context): ExecutionAdapterRegistration {
  const unregisterStart = ctx.on('subagent/start', (info: SubagentRunInfo) => {
    // Resolve the execution service lazily on every event: plugin mounting is
    // topology-driven, so `ctx.executions` may become available after this
    // adapter registered. When the service is absent the projection is a no-op.
    const executions = ctx.get('executions') as ExecutionSurface | undefined
    if (executions === undefined) return
    projectSubagentEvent(executions, 'subagent/start', info)
  }, { global: true })

  const unregisterEnd = ctx.on('subagent/end', (info: SubagentRunEndInfo) => {
    const executions = ctx.get('executions') as ExecutionSurface | undefined
    if (executions === undefined) return
    projectSubagentEvent(executions, 'subagent/end', info, { stopReason: info.stopReason })
  }, { global: true })

  return () => {
    unregisterStart()
    unregisterEnd()
  }
}
