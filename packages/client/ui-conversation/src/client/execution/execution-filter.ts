/**
 * Execution trace filtering: category chips and free-text search over the
 * normalized events. Pure predicates — a filtered view is a pure projection
 * of the event list, so search/filter changes never touch the chat snapshot.
 * @module
 */

import type { ExecutionEvent, ExecutionEventStatus } from './execution-event.ts'

/** One toolbar filter chip; `all` shows every event. */
export type ExecutionFilter =
  | 'all'
  | 'agent'
  | 'tools'
  | 'files'
  | 'terminal'
  | 'git'
  | 'errors'
  | 'success'

/** All filter ids in toolbar order. */
export const EXECUTION_FILTERS: readonly ExecutionFilter[] = [
  'all', 'agent', 'tools', 'files', 'terminal', 'git', 'errors', 'success',
]

/** Whether an event passes one category chip. */
export function matchesFilter(event: ExecutionEvent, filter: ExecutionFilter): boolean {
  switch (filter) {
    case 'all':
      return true
    case 'agent':
      return event.category === 'agent'
    case 'tools':
      return event.category === 'tools'
    case 'files':
      return event.category === 'files'
    case 'terminal':
      return event.category === 'terminal'
    case 'git':
      return event.category === 'git'
    case 'errors':
      return event.status === 'error' || event.type === 'tool_error' || event.type === 'task_failed'
    case 'success':
      return event.status === 'success'
  }
}

/**
 * Case-insensitive free-text match over the event's headline fields.
 * @param event - normalized event.
 * @param query - trimmed user query; empty matches everything.
 * @returns whether any headline field contains the query.
 */
export function matchesQuery(event: ExecutionEvent, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (needle === '') return true
  return event.title.toLowerCase().includes(needle)
    || event.description.toLowerCase().includes(needle)
    || (event.toolName ?? '').toLowerCase().includes(needle)
    || (event.filePath ?? '').toLowerCase().includes(needle)
    || event.type.toLowerCase().includes(needle)
}

/** Count events per status, for the toolbar/header readout. */
export function executionStatusCounts(events: readonly ExecutionEvent[]): Record<ExecutionEventStatus, number> {
  const counts: Record<ExecutionEventStatus, number> = {
    running: 0, success: 0, warning: 0, error: 0, info: 0,
  }
  for (const event of events) counts[event.status] += 1
  return counts
}
