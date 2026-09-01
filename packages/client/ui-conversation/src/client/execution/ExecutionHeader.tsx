// ExecutionHeader: the task status strip above the timeline — session title
// and run state, compact counters, the current action, the standing plan
// (todos projection), and the touched-files activity list. The whole region
// below the title row collapses to one line. Pure presentation: all data
// arrives through props from the owning view.

import { useState, type ReactNode } from 'react'
import clsx from 'clsx'
import type { TodoItem } from '@deepseek-ai/dsh-tool-todo/client'
import {
  IconCheckOutline16,
  IconChevronDownOutline14,
  IconChevronRightOutline14,
  IconEditOutline16,
  IconGoalOutline16,
  IconListPenOutline16,
  IconPlayOutline16,
  IconSettingsOutline16,
  IconThinkOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChatViewSlotProps } from '../contract/slots.ts'
import type { ExecutionEventStatus } from './execution-event.ts'
import type { ExecutionCurrentAction, ExecutionTraceSummary } from './execution-summary.ts'
import css from './ExecutionHeader.module.css'

export type ExecutionCurrentActionKind = ExecutionCurrentAction['kind']

export interface ExecutionHeaderProps {
  /** The owning session (for the display title). */
  readonly sessionId: ChatViewSlotProps['sessionId']
  /** Global sessions list seat (session title lookup). */
  readonly useSessions: ChatViewSlotProps['useSessions']
  /** The owning view's locale seat. */
  readonly t: ChatViewSlotProps['t']
  /** Derived trace summary (counts, current action, files). */
  readonly summary: ExecutionTraceSummary
  /** Live run state of the session. */
  readonly running: boolean
  /** Last trace event status for the idle badge; info with an empty trace. */
  readonly lastStatus: ExecutionEventStatus
  /** Standing plan items; empty hides the plan strip. */
  readonly todos: readonly TodoItem[]
  /** Reveal the first event touching a path (scroll-to-file). */
  readonly onOpenFile: (path: string) => void
  /** Reveal the current action's event (scroll-to-action). */
  readonly onRevealEvent: (key: string) => void
}

/** Leading glyph for one current-action kind. */
function actionIcon(kind: ExecutionCurrentActionKind): ReactNode {
  switch (kind) {
    case 'command': return <IconPlayOutline16 />
    case 'edit': return <IconEditOutline16 />
    case 'tool': return <IconSettingsOutline16 />
    case 'analysis': return <IconThinkOutline16 />
    case 'work': return <IconGoalOutline16 />
    case 'idle': return <IconCheckOutline16 />
  }
}

/** The header's one-line status chip: run state or last outcome. */
function statusText(status: ExecutionEventStatus, running: boolean, t: ChatViewSlotProps['t']): string {
  if (running) return t('execution.status.working')
  switch (status) {
    case 'error': return t('execution.status.failed')
    case 'success': return t('execution.status.completed')
    case 'warning': return t('execution.status.warning')
    default: return t('execution.status.idle')
  }
}

/** One plan row glyph: ✓ completed, ● active, ○ pending. */
function planGlyph(status: TodoItem['status']): ReactNode {
  switch (status) {
    case 'completed': return <span className={css.planDone}>✓</span>
    case 'in_progress': return <span className={css.planActive}>●</span>
    default: return <span className={css.planPending}>○</span>
  }
}

function planProgress(todos: readonly TodoItem[]): string {
  const done = todos.filter(item => item.status === 'completed').length
  const active = todos.filter(item => item.status === 'in_progress').length
  return `${done}/${todos.length}${active > 0 ? ` · ${active}` : ''}`
}

/** File activity row status letter: A added, M modified, D deleted. */
function fileStatusLetter(status: 'added' | 'modified' | 'deleted'): string {
  switch (status) {
    case 'added': return 'A'
    case 'deleted': return 'D'
    default: return 'M'
  }
}

export function ExecutionHeader({
  sessionId, useSessions, t, summary, running, lastStatus, todos, onOpenFile, onRevealEvent,
}: ExecutionHeaderProps) {
  const title = useSessions(state => state.byId[sessionId]?.displayTitle)
  const [extended, setExtended] = useState(true)
  const [planOpen, setPlanOpen] = useState(false)
  const [filesOpen, setFilesOpen] = useState(false)
  const { counts, currentAction, files } = summary

  return (
    <section className={css.root} data-testid="execution-header" aria-label={t('execution.header.label')}>
      <div className={css.titleRow}>
        <span className={css.title} title={title}>{title ?? t('execution.header.untitled')}</span>
        <span className={clsx(css.statusChip, `dsh-execution-status-${running ? 'running' : lastStatus}`)} data-status={running ? 'running' : lastStatus}>
          {statusText(lastStatus, running, t)}
        </span>
        <span className={css.counts} aria-label={t('execution.header.countsAria')}>
          {t('execution.counts', {
            turns: counts.turns,
            steps: counts.steps,
            tools: counts.toolCalls,
            files: counts.filesChanged,
            errors: counts.errors,
          })}
        </span>
        <button
          type="button"
          className={css.toggle}
          aria-expanded={extended}
          aria-label={extended ? t('execution.header.collapse') : t('execution.header.expand')}
          onClick={() => { setExtended(v => !v) }}
        >
          {extended ? <IconChevronDownOutline14 /> : <IconChevronRightOutline14 />}
        </button>
      </div>

      {extended && (
        <div className={css.extended}>
          <div className={css.actionRow} data-testid="execution-current-action">
            <span className={css.actionIcon} aria-hidden>{actionIcon(currentAction.kind)}</span>
            {currentAction.kind === 'idle'
              ? <span className={css.actionText}>{t('execution.action.idle')}</span>
              : (
                <button
                  type="button"
                  className={css.actionText}
                  onClick={() => { if (currentAction.eventKey !== undefined) onRevealEvent(currentAction.eventKey) }}
                >
                  {currentAction.text}
                </button>
              )}
          </div>

          {todos.length > 0 && (
            <section className={css.strip} aria-label={t('execution.plan.title')}>
              <button
                type="button"
                className={css.stripHeader}
                aria-expanded={planOpen}
                onClick={() => { setPlanOpen(v => !v) }}
              >
                <span className={css.stripLead} aria-hidden><IconListPenOutline16 /></span>
                <span className={css.stripTitle}>{t('execution.plan.title')}</span>
                <span className={css.stripMeta}>{planProgress(todos)}</span>
                <span className={css.stripChevron} aria-hidden>
                  {planOpen ? <IconChevronDownOutline14 /> : <IconChevronRightOutline14 />}
                </span>
              </button>
              {planOpen && (
                <ul className={css.planList}>
                  {todos.map(item => (
                    <li key={item.content} className={css.planItem} data-status={item.status}>
                      <span className={css.planGlyph} aria-hidden>{planGlyph(item.status)}</span>
                      <span className={css.planContent}>{item.content}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {files.length > 0 && (
            <section className={css.strip} aria-label={t('execution.files.title')}>
              <button
                type="button"
                className={css.stripHeader}
                aria-expanded={filesOpen}
                onClick={() => { setFilesOpen(v => !v) }}
              >
                <span className={css.stripLead} aria-hidden><IconGoalOutline16 /></span>
                <span className={css.stripTitle}>{t('execution.files.title')}</span>
                <span className={css.stripMeta}>{files.length}</span>
                <span className={css.stripChevron} aria-hidden>
                  {filesOpen ? <IconChevronDownOutline14 /> : <IconChevronRightOutline14 />}
                </span>
              </button>
              {filesOpen && (
                <ul className={css.filesList}>
                  {files.map(file => (
                    <li key={file.path}>
                      <button
                        type="button"
                        className={css.fileRow}
                        onClick={() => { onOpenFile(file.path) }}
                      >
                        <span className={css.fileStatus} data-status={file.status}>{fileStatusLetter(file.status)}</span>
                        <span className={css.filePath}>{file.path}</span>
                        {(file.additions > 0 || file.deletions > 0) && (
                          <span className={css.fileCounts}>
                            <span className={css.add}>+{file.additions}</span>
                            <span className={css.del}>−{file.deletions}</span>
                          </span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </div>
      )}
    </section>
  )
}
