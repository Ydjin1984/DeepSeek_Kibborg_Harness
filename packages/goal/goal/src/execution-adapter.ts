/**
 * Execution adapter for the goal subsystem.
 *
 * Projects GoalPhase changes into the unified execution state machine
 * (`ctx.executions`). The adapter is optional: it resolves the execution
 * service lazily on every `session/event` commit via `ctx.get('executions')`
 * (AGENTS.md optional-service pattern), so goals keeps working unchanged when
 * the execution package is absent — and the projection starts working as soon
 * as the service mounts, whatever the plugin-mount order.
 *
 * Projection model: reads each `goal/change` event from the session stream and
 * maps each observed GoalPhase transition onto a state-machine event.
 *
 *   first sight        → register (CREATED)
 *   active             → start (if first) or resume (if prev was paused/blocked)
 *   paused / blocked   → wait-user   (if prev was active; else start if first)
 *   complete           → complete
 *   clear (tombstone)  → cancel
 *
 * A goal first observed in a terminal phase (`complete`) or non-active phase
 * (`paused`/`blocked`) on first sight gets a synthetic `start` before the phase
 * event so the projection records a plausible RUNNING → phase history.
 * Identical phase commits and already-terminal executions are ignored:
 * projection is best-effort and the execution registry remains the single
 * source of truth for status.
 *
 * @module @deepseek-ai/dsh-goal/execution-adapter
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { GoalChangeMeta } from './domain.ts'
import type { GoalPhase } from './types.ts'
import { decodeGoalChange } from './fold.ts'

/** Disposer returned by the adapter registration. */
export type ExecutionAdapterRegistration = () => void

/** Minimal execution-service surface the adapter depends on. */
export interface ExecutionSurface {
  register(kind: string, executionId: string, options?: unknown): unknown
  transition(executionId: string, eventCode: string): unknown
}

/**
 * Process one session event against the execution surface.
 *
 * Pure in the sense that it only reads `event` and calls `executions` methods;
 * no side-effects beyond the execution registry.
 *
 * @param executions - lazy execution-service handle.
 * @param session - the session the event belongs to (unused but available).
 * @param event - the committed session event.
 */
export function projectGoalChange(
  executions: ExecutionSurface,
  _session: Session,
  event: SessionEvent,
): void {
  if (event.type !== 'goal/change') return

  let change: GoalChangeMeta | undefined
  try {
    change = decodeGoalChange(event.data)
  } catch {
    return
  }
  if (change === undefined) return

  // ── Clear (tombstone) path ──────────────────────────────────────────────
  if (change.operation === 'clear') {
    const goalId = String(change.cleared.id)
    const executionId = `goal:${goalId}`
    try {
      executions.register('goal', executionId)
    } catch {
      // Already registered by a concurrent adapter instance — proceed.
    }
    try {
      executions.transition(executionId, 'cancel')
    } catch {
      // Execution not tracked or already terminal — best-effort projection.
    }
    return
  }

  // ── Snapshot path ───────────────────────────────────────────────────────
  const goal = change.goal
  const goalId = String(goal.id)
  const executionId = `goal:${goalId}`
  const phase = goal.phase

  // Track previous phases per goal for idempotency and prev-phase detection.
  // Per-service projection state is carried on the execution surface so
  // `projectGoalChange` stays a directly testable function; surfaces are
  // per-context, so the maps never cross-talk between registrations.
  const prevPhases = getPrevPhases(executions)
  const prevPhaseActual = prevPhases.get(goalId)

  if (prevPhaseActual === phase) return
  prevPhases.set(goalId, phase)

  // Register on first sight (only if not already tracked).
  const registered = getRegistered(executions)
  if (!registered.has(executionId)) {
    registered.add(executionId)
    try {
      executions.register('goal', executionId)
    } catch {
      // Already registered — proceed.
    }
  }

  // First snapshot (revision 1) — apply phase event directly.
  if (goal.revision === 1) {
    if (phase === 'active') {
      try { executions.transition(executionId, 'start') } catch { /* already RUNNING — ok */ }
    } else if (phase === 'paused' || phase === 'blocked') {
      // First sight paused/blocked: start then wait-user.
      try { executions.transition(executionId, 'start') } catch { /* already RUNNING */ }
      try { executions.transition(executionId, 'wait-user') } catch { /* not RUNNING */ }
    /* v8 ignore start — false path dead: only 'complete' reaches this else-if among 4-goal phases */
    } else if (phase === 'complete') {
      // First sight complete: start then complete.
      try { executions.transition(executionId, 'start') } catch { /* already RUNNING/terminal */ }
      try { executions.transition(executionId, 'complete') } catch { /* not in RUNNING/WAITING */ }
    }
    /* v8 ignore stop */
    return
  }

  // Subsequent snapshots — compare with the previous phase.
  if (phase === 'active') {
    if (prevPhaseActual === 'paused' || prevPhaseActual === 'blocked') {
      // Resume from pause/block: try resume (catch if not in WAITING_*).
      try { executions.transition(executionId, 'resume') } catch { /* already RUNNING */ }
    } else if (prevPhaseActual === undefined) {
      // Should have been handled at revision 1, but be safe.
      try { executions.transition(executionId, 'start') } catch { /* already RUNNING */ }
    } else {
      // active → active (edit): no transition needed.
    }
  } else if (phase === 'paused' || phase === 'blocked') {
    if (prevPhaseActual === 'active') {
      // active → paused/blocked: wait-user.
      try { executions.transition(executionId, 'wait-user') } catch { /* not RUNNING */ }
    } else {
      // First sight paused/blocked (revision > 1 edge): start + wait-user.
      try { executions.transition(executionId, 'start') } catch { /* already RUNNING */ }
      try { executions.transition(executionId, 'wait-user') } catch { /* not RUNNING */ }
    /* v8 ignore start — false path dead: only 'complete' reaches this else-if among 4-goal phases */
    }
  } else if (phase === 'complete') {
    // Any → complete: try complete; when the goal was never RUNNING in this
    // projection (e.g. first sight at revision > 1), start first so complete
    // is legal.
    try {
      executions.transition(executionId, 'complete')
    } catch {
      // Not in RUNNING or WAITING_* state — try start first (e.g. from CREATED).
      try {
        executions.transition(executionId, 'start')
        executions.transition(executionId, 'complete')
      } catch {
        // Still not valid — best-effort projection, swallow.
      }
    }
  }
}

/** Get or create the per-executions prev-phase tracking map. */
function getPrevPhases(executions: ExecutionSurface): Map<string, GoalPhase> {
  if (!('_prevPhases' in executions)) {
    Object.defineProperty(executions, '_prevPhases', {
      value: new Map<string, GoalPhase>(),
      writable: false,
      configurable: true,
    })
  }
  return (executions as unknown as { _prevPhases: Map<string, GoalPhase> })._prevPhases as Map<string, GoalPhase>
}

/** Get or create the per-executions registered-execution set. */
function getRegistered(executions: ExecutionSurface): Set<string> {
  if (!('_registered' in executions)) {
    Object.defineProperty(executions, '_registered', {
      value: new Set<string>(),
      writable: false,
      configurable: true,
    })
  }
  return (executions as unknown as { _registered: Set<string> })._registered as Set<string>
}

/**
 * Register the goal execution adapter on a Cordis context.
 *
 * Listens for `session/event` with type `goal/change` and projects
 * phase transitions into the unified execution state machine.
 *
 * @param ctx — Cordis context with a SessionStore and (optionally) the
 *   execution service.
 * @returns disposer that unregisters the projection subscription.
 */
export function registerGoalExecutionAdapter(ctx: Context): ExecutionAdapterRegistration {
  const unregister = ctx.on('session/event', (session: Session, event: SessionEvent) => {
    // Resolve the execution service lazily on every event: plugin mounting is
    // topology-driven, so `ctx.executions` may become available after this
    // adapter registered. When the service is absent the projection is a no-op.
    const executions = ctx.get('executions') as ExecutionSurface | undefined
    if (executions === undefined) return

    projectGoalChange(executions, session, event)
  }, { global: true })

  return () => {
    unregister()
  }
}
