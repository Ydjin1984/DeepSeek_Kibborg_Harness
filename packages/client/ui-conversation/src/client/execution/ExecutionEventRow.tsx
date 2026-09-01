// ExecutionEventRow: one timeline event. The header strip is the event
// chrome — icon, wall clock, type badge, title/summary (collapsed only),
// diff counts, duration, status dot, and the expand chevron — and the
// expanded body dispatches the owning Chat node through the shared
// 'conversation.chat.node' keyed seat, so every specialized renderer
// (tool rows, markdown, commands) keeps its own presentation. Search
// matches in the headline fields render as <mark>.

import { memo, useMemo, type ReactNode } from 'react'
import {
  IconBranchOutline16,
  IconCheckOutline16,
  IconChevronDownOutline14,
  IconChevronRightOutline14,
  IconCloseOutline16,
  IconCodeOutline16,
  IconDataOutline16,
  IconEditOutline16,
  IconFolderOpenOutline16,
  IconGoalOutline16,
  IconListPenOutline16,
  IconPlayOutline16,
  IconQuestionOutline14,
  IconSettingsOutline16,
  IconThinkOutline16,
  IconUserOutline16,
  IconWarningOutline16,
  JsonBlock,
  StateDot,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChatNode } from '../contract/chat-nodes.ts'
import type {
  ChatNodeOwnerProps, ChatViewSlotProps, RenderChatNode,
} from '../contract/slots.ts'
import { executionEventFromNode, type ExecutionEvent } from './execution-event.ts'
import { executionClock, executionDuration, executionStatusDot, executionTypeLabel } from './execution-labels.ts'
import css from './ExecutionEventRow.module.css'

export interface ExecutionEventRowProps {
  /** Stable Chat node context key this row subscribes to. */
  readonly nodeKey: string
  /** Whether the row body is currently expanded. */
  readonly expanded: boolean
  /** Toggle the row's expansion in the owning view. */
  readonly onToggle: () => void
  /** Shared Chat node seat props (openers, selection, mentions). */
  readonly owner: ChatNodeOwnerProps
  /** Framework session hook bound to the conversation snapshot. */
  readonly useSession: ChatViewSlotProps['useSession']
  /** The shared node-seat dispatcher (session body → keyed renderers). */
  readonly renderChatNode: RenderChatNode
  /** The owning view's locale seat. */
  readonly t: ChatViewSlotProps['t']
  /** Free-text query highlighted in the headline fields; '' disables. */
  readonly query: string
}

type RoutedChatNodeOwner = {
  [Kind in ChatNode['kind']]: ChatNodeOwnerProps & { readonly node: ChatNode<Kind> }
}[ChatNode['kind']]

/** One event type's leading glyph (the trace vocabulary, not an emoji). */
function eventIcon(event: ExecutionEvent): ReactNode {
  switch (event.category) {
    case 'agent':
      return event.type === 'planning' ? <IconListPenOutline16 /> : <IconThinkOutline16 />
    case 'files':
      return event.type === 'file_read' ? <IconFolderOpenOutline16 /> : <IconEditOutline16 />
    case 'terminal':
      return <IconPlayOutline16 />
    case 'git':
      return <IconBranchOutline16 />
    case 'code':
      return <IconCodeOutline16 />
    case 'tools':
      return <IconSettingsOutline16 />
    case 'state':
      switch (event.type) {
        case 'task_completed': return <IconCheckOutline16 />
        case 'task_failed': return <IconCloseOutline16 />
        case 'confirmation_required': return <IconQuestionOutline14 />
        case 'warning': return <IconWarningOutline16 />
        default: return <IconGoalOutline16 />
      }
    case 'message':
      return event.type === 'context' ? <IconDataOutline16 /> : <IconUserOutline16 />
  }
}

/** Wrap case-insensitive query matches in <mark>; '' or no match returns text. */
export function highlightText(text: string, query: string): ReactNode {
  const needle = query.trim().toLowerCase()
  if (needle === '' || text === '') return text
  const parts: ReactNode[] = []
  const lower = text.toLowerCase()
  let index = 0
  let found = lower.indexOf(needle)
  let key = 0
  while (found !== -1 && key < 32) {
    if (found > index) parts.push(<span key={key++}>{text.slice(index, found)}</span>)
    parts.push(<mark key={key++}>{text.slice(found, found + needle.length)}</mark>)
    index = found + needle.length
    found = lower.indexOf(needle, index)
  }
  if (index < text.length) parts.push(<span key={key}>{text.slice(index)}</span>)
  return parts
}

export const ExecutionEventRow = memo(function ExecutionEventRow({
  nodeKey, expanded, onToggle, owner, useSession, renderChatNode, t, query,
}: ExecutionEventRowProps) {
  const node = useSession(snapshot => snapshot.chat.nodes.get(nodeKey))
  const event = useMemo(() => node === undefined ? null : executionEventFromNode(node as ChatNode), [node])
  const routedNode = node as ChatNode | undefined
  const routedOwner = useMemo<RoutedChatNodeOwner | null>(() => (
    routedNode === undefined ? null : { ...owner, node: routedNode } as RoutedChatNodeOwner
  ), [owner, routedNode])
  if (event === null || routedNode === undefined || routedOwner === null) return null

  const counts = event.additions !== undefined && event.deletions !== undefined
    ? event.additions + event.deletions > 0
    : false
  return (
    <div className={css.row} data-status={event.status} data-category={event.category} data-testid="execution-event">
      <button
        type="button"
        className={css.header}
        aria-expanded={expanded}
        onClick={onToggle}
      >
        <span className={css.icon} aria-hidden>{eventIcon(event)}</span>
        <time className={css.time} dateTime={new Date(event.time).toISOString()}>{executionClock(event.time)}</time>
        <span className={css.typeBadge} data-category={event.category}>{executionTypeLabel(event.type)}</span>
        {event.title !== '' && (
          <span className={css.title}>{highlightText(event.title, query)}</span>
        )}
        {event.description !== '' && (
          <span className={css.summary}>{highlightText(event.description, query)}</span>
        )}
        {counts && (
          <span className={css.counts} aria-label={`+${event.additions} −${event.deletions}`}>
            <span className={css.add}>+{event.additions}</span>
            <span className={css.del}>−{event.deletions}</span>
          </span>
        )}
        {event.durationMs !== undefined && (
          <span className={css.duration}>{executionDuration(event.durationMs)}</span>
        )}
        <span className={css.state} title={t(`execution.status.${event.status}`)}>
          <StateDot state={executionStatusDot(event.status)} />
        </span>
        <span className={css.chevron} aria-hidden>
          {expanded ? <IconChevronDownOutline14 /> : <IconChevronRightOutline14 />}
        </span>
      </button>
      {expanded && (
        <div className={css.body}>
          {renderChatNode(routedOwner, {
            entryKey: routedNode.kind,
            hookContext: nodeKey,
            fallback: (
              <JsonBlock
                label={t('message.unknownSurface', { type: routedNode.kind })}
                payload={routedNode.data}
                truncatedLabel={total => t('json.truncated', { total })}
              />
            ),
          })}
        </div>
      )}
    </div>
  )
})
