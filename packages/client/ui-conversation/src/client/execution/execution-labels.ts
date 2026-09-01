/**
 * Presentation vocabulary for the execution timeline: fixed technical labels
 * for event types, wall-clock formatting, and status mapping. These are trace
 * vocabulary (the machine-readable kind names a timeline badge shows), not
 * product copy — locale strings for prose live in the conversation
 * dictionaries. Pure functions, unit-tested.
 * @module
 */

import type { StateDotState } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ExecutionEventStatus, ExecutionEventType } from './execution-event.ts'

/** Technical badge label per trace type (rendered uppercase by CSS). */
export const EXECUTION_TYPE_LABELS: Record<ExecutionEventType, string> = {
  thinking: 'Thinking',
  analysis: 'Analysis',
  planning: 'Plan',
  decision: 'Decision',
  observation: 'Observation',
  file_read: 'File read',
  file_write: 'File write',
  file_edit: 'File edit',
  file_create: 'File create',
  file_delete: 'File delete',
  file_rename: 'File rename',
  code: 'Code',
  diff: 'Diff',
  tool_call: 'Tool call',
  tool_result: 'Tool result',
  tool_error: 'Tool error',
  command: 'Command',
  stdout: 'Output',
  stderr: 'Error output',
  exit_code: 'Exit code',
  git_diff: 'Git diff',
  git_status: 'Git status',
  git_commit: 'Git commit',
  git_branch: 'Git branch',
  task_started: 'Task started',
  task_progress: 'Progress',
  task_completed: 'Completed',
  task_failed: 'Failed',
  warning: 'Warning',
  confirmation_required: 'Confirmation',
  user_message: 'User',
  context: 'Context',
}

/**
 * Badge label for one event type.
 * @param type - trace type.
 * @returns the fixed technical label.
 */
export function executionTypeLabel(type: ExecutionEventType): string {
  return EXECUTION_TYPE_LABELS[type]
}

/** Map an event status to the primitive StateDot state. */
export function executionStatusDot(status: ExecutionEventStatus): StateDotState {
  switch (status) {
    case 'running': return 'ongoing'
    case 'success': return 'done'
    case 'warning': return 'warning'
    case 'error': return 'error'
    case 'info': return 'done'
  }
}

/**
 * Wall-clock HH:MM:SS for a timeline stamp.
 * @param ms - Unix epoch milliseconds.
 * @returns zero-padded local clock string.
 */
export function executionClock(ms: number): string {
  const date = new Date(ms)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

/**
 * Compact human duration (ms under 10s, then seconds).
 * @param ms - elapsed milliseconds.
 * @returns duration text for a row trailing readout.
 */
export function executionDuration(ms: number): string {
  if (ms < 10_000) return `${Math.max(0, Math.round(ms))}ms`
  return `${(ms / 1000).toFixed(1)}s`
}
