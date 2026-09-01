/**
 * Trace summary derivation: the counts, current action, and file activity
 * the execution header projects from the normalized events and the
 * conversation timeline. Pure functions of the snapshot data — the header
 * stays presentational.
 * @module
 */

import type {
  ConversationTimelineSnapshot, PartialAssistant,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { ExecutionEvent } from './execution-event.ts'

/** One touched file row in the header's activity list. */
export interface ExecutionFileActivity {
  /** The touched path (model-facing). */
  readonly path: string
  /** Change class: created, deleted, or otherwise modified. */
  readonly status: 'added' | 'modified' | 'deleted'
  /** Summed added lines across the touching events. */
  readonly additions: number
  /** Summed removed lines across the touching events. */
  readonly deletions: number
  /** First event key touching the path (the scroll target on click). */
  readonly firstKey: string
}

/** The headline readout of the header: what the agent is doing right now. */
export interface ExecutionCurrentAction {
  /** Icon treatment kind for the header line. */
  readonly kind: 'command' | 'edit' | 'tool' | 'analysis' | 'work' | 'idle'
  /** Display text (command line, path, or activity phrase). */
  readonly text: string
  /** Event key to reveal when the user clicks the action (scroll target). */
  readonly eventKey?: string
}

/** Compact counters the header shows in one line. */
export interface ExecutionTraceCounts {
  /** In-window turn count. */
  readonly turns: number
  /** In-window step count. */
  readonly steps: number
  /** Tool-backed event count (tools/files/terminal/git categories). */
  readonly toolCalls: number
  /** Distinct touched file count. */
  readonly filesChanged: number
  /** Error-status event count. */
  readonly errors: number
  /** Total rendered event count. */
  readonly total: number
}

/** Everything the header needs, derived once per snapshot. */
export interface ExecutionTraceSummary {
  readonly counts: ExecutionTraceCounts
  readonly currentAction: ExecutionCurrentAction
  readonly files: readonly ExecutionFileActivity[]
}

function stepCount(timeline: ConversationTimelineSnapshot): number {
  let steps = 0
  for (const turn of timeline.turns.values()) steps += turn.steps.length
  return steps
}

/** Latest running event when one exists, else null. */
function latestRunning(events: readonly ExecutionEvent[]): ExecutionEvent | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]
    if (event !== undefined && event.status === 'running') return event
  }
  return null
}

/** Headline text for the current action from the latest running event. */
function actionFromEvent(event: ExecutionEvent): ExecutionCurrentAction {
  switch (event.category) {
    case 'terminal':
      return {
        kind: 'command',
        text: event.description === '' ? event.title : event.description,
        eventKey: event.key,
      }
    case 'files':
      return {
        kind: 'edit',
        text: event.filePath ?? event.title,
        eventKey: event.key,
      }
    case 'git':
    case 'tools':
      return { kind: 'tool', text: event.toolName ?? event.title, eventKey: event.key }
    case 'agent':
      return { kind: 'analysis', text: event.title, eventKey: event.key }
    default:
      return { kind: 'work', text: event.title, eventKey: event.key }
  }
}

/**
 * Derive the header summary from the trace events and timeline.
 * @param events - normalized events in trace order (all, unfiltered).
 * @param timeline - conversation turn/step timeline.
 * @param partial - streaming assistant prefix, when one is live.
 * @param running - whether the session reports a running turn.
 * @returns the full header summary.
 */
export function executionTraceSummary(
  events: readonly ExecutionEvent[],
  timeline: ConversationTimelineSnapshot,
  partial: PartialAssistant | null,
  running: boolean,
): ExecutionTraceSummary {
  let toolCalls = 0
  let errors = 0
  const files = new Map<string, ExecutionFileActivity>()
  for (const event of events) {
    if (event.category === 'tools' || event.category === 'files'
      || event.category === 'terminal' || event.category === 'git') {
      toolCalls += 1
    }
    if (event.status === 'error') errors += 1
    if (event.filePath !== undefined && event.filePath !== '') {
      const existing = files.get(event.filePath)
      if (existing === undefined) {
        files.set(event.filePath, {
          path: event.filePath,
          status: event.type === 'file_create' ? 'added'
            : event.type === 'file_delete' ? 'deleted' : 'modified',
          additions: event.additions ?? 0,
          deletions: event.deletions ?? 0,
          firstKey: event.key,
        })
      } else if (existing.additions + existing.deletions === 0 && event.additions !== undefined) {
        files.set(event.filePath, {
          ...existing,
          additions: event.additions,
          deletions: event.deletions ?? 0,
        })
      }
    }
  }
  const sortedFiles = [...files.values()].sort((left, right) => left.path.localeCompare(right.path))

  const runningEvent = latestRunning(events)
  let currentAction: ExecutionCurrentAction
  if (runningEvent !== null) {
    currentAction = actionFromEvent(runningEvent)
  } else if (partial !== null && partial.blocks.some(block => block.kind !== 'tool-call')) {
    currentAction = { kind: 'analysis', text: 'Analyzing' }
  } else if (running) {
    currentAction = { kind: 'work', text: 'Working' }
  } else {
    currentAction = { kind: 'idle', text: '' }
  }

  return {
    counts: {
      turns: timeline.turnOrder.length,
      steps: stepCount(timeline),
      toolCalls,
      filesChanged: sortedFiles.length,
      errors,
      total: events.length,
    },
    currentAction,
    files: sortedFiles,
  }
}
