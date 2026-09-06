/**
 * Execution adapter for the background-job subsystem.
 *
 * Projects JobStatus changes into the unified execution state machine
 * (`ctx.executions`). The adapter is optional: it resolves the execution
 * service via `ctx.get('executions')` (AGENTS.md optional-service pattern),
 * so jobs keeps working unchanged when the execution package is absent.
 *
 * Projection model: re-reads `ctx.jobs.list()` on every `onJobsChanged`
 * commit and maps each observed JobStatus transition onto a state-machine
 * event. Intermediate `stopping` is skipped — its terminal outcome arrives as
 * `killed`/`completed`/`failed` and is projected then:
 *
 *   first sight        → register (CREATED)
 *   running            → start            (→ RUNNING)
 *   completed          → complete         (→ COMPLETED)
 *   failed             → fail             (→ FAILED)
 *   killed             → abort            (→ ABORTED)
 *
 * A job first observed in a terminal state is started first so the projection
 * records a plausible RUNNING → terminal history. Identical status commits
 * and already-terminal executions are ignored: projection is best-effort and
 * the execution registry remains the single source of truth for status.
 *
 * @module @deepseek-ai/dsh-jobs/execution-adapter
 */

import type { Context } from '@deepseek-ai/cordis'
import type { JobStatus } from '@deepseek-ai/dsh-jobs'
import type { ExecutionEventTypeCode } from '@deepseek-ai/dsh-execution'

/** Disposer returned by the adapter registration. */
export type ExecutionAdapterRegistration = () => void

/** Minimal execution-service surface the adapter depends on. */
interface ExecutionSurface {
  register(kind: string, executionId: string, options?: unknown): unknown
  transition(executionId: string, eventCode: ExecutionEventTypeCode): unknown
}

/** Map a JobStatus onto its state-machine event (or skip it). */
function jobStatusEvent(status: JobStatus): ExecutionEventTypeCode | undefined {
  switch (status) {
    case 'running':   return 'start'
    case 'completed': return 'complete'
    case 'failed':    return 'fail'
    case 'killed':    return 'abort'
    // `stopping` is cancellation in progress; the terminal outcome arrives
    // as `killed`/`completed`/`failed` and is projected at that commit.
    case 'stopping':  return undefined
  }
}

/**
 * Register the execution adapter on a Cordis context.
 *
 * @param ctx — Cordis context with a JobRegistry and (optionally) the
 *   execution service.
 * @returns disposer that unregisters the projection subscription.
 */
export function registerExecutionAdapter(ctx: Context): ExecutionAdapterRegistration {
  const executions = ctx.get('executions') as ExecutionSurface | undefined
  if (!executions?.register || !executions.transition) {
    // Execution service not available — the adapter stays a no-op.
    return () => {}
  }

  const registered = new Set<string>()
  const projected = new Map<string, JobStatus>()

  const unregisterChanged = ctx.jobs.onJobsChanged(() => {
    const snapshots = ctx.jobs.list()
    for (const snapshot of snapshots) {
      const { id, status } = snapshot
      if (projected.get(id) === status) continue
      projected.set(id, status)

      const execId = `job:${id}`
      if (!registered.has(execId)) {
        try {
          executions.register('job', execId)
          registered.add(execId)
        } catch {
          // Already registered by a concurrent adapter instance — proceed.
        }
      }

      const event = jobStatusEvent(status)
      if (event === undefined) continue

      // A terminal first sight was never RUNNING in this projection: start it
      // so the terminal event is legal (start from RUNNING is rejected and
      // swallowed below, keeping the projection idempotent).
      if (status !== 'running') {
        try {
          executions.transition(execId, 'start')
        } catch {
          // Already RUNNING/terminal — the terminal event below still applies.
        }
      }
      try {
        executions.transition(execId, event)
      } catch {
        // Execution not tracked or already terminal — projection is best-effort.
      }
    }
  })

  return () => {
    unregisterChanged()
  }
}
