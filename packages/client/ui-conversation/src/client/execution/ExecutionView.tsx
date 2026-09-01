// ExecutionView: the professional execution-trace view tab. Reads the same
// conversation snapshot as ChatView and projects it into a normalized event
// timeline: a sticky task header (title, run state, counters, current action,
// plan, files), a toolbar (search, category filters, expand/collapse all,
// follow), and a virtualized event list. Each event row owns its header
// chrome and dispatches its Chat node through the shared
// 'conversation.chat.node' seat, so the specialized renderers stay in one
// place. The view owns its scrollport (`data-conversation-composer-overlay`),
// which keeps the sticky composer seat intact below it.

import {
  useCallback, useEffect, useMemo, useRef, useState, type ReactNode,
} from 'react'
import clsx from 'clsx'
import type { ChatSnapshot, ToolCallBlock } from '@deepseek-ai/dsh-client-runtime/client'
import {
  IconChevronDownOutline14,
  IconSearchOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChatNode, ToolChatData } from '../contract/chat-nodes.ts'
import type {
  ChatNodeOwnerProps, ExecutionViewSlotProps,
} from '../contract/slots.ts'
import { ExecutionEventRow } from './ExecutionEventRow.tsx'
import { ExecutionHeader } from './ExecutionHeader.tsx'
import { executionEventFromNode, isDefaultExpanded, type ExecutionEvent } from './execution-event.ts'
import { EXECUTION_FILTERS, matchesFilter, matchesQuery, type ExecutionFilter } from './execution-filter.ts'
import { executionTraceSummary } from './execution-summary.ts'
import {
  executionOffsets, executionWindow, isAtScrollFloor,
} from './execution-virtual.ts'
import css from './ExecutionView.module.css'

const FOLLOW_THRESHOLD = 24

/** Whether one tool tree contains the addressed call (any depth). */
function treeContainsCall(block: ToolCallBlock, callId: string): boolean {
  return block.callId === callId || block.subCalls.some(child => treeContainsCall(child, callId))
}

/** Find the Chat node key whose tool tree owns `callId`, for inspect scrolling. */
function findCallKey(chat: ChatSnapshot, callId: string): string | null {
  for (const key of chat.order) {
    const node = chat.nodes.get(key)
    if (node?.kind !== 'tool-call') continue
    const root = (node.data as ToolChatData).root
    if (treeContainsCall(root, callId)) return key
  }
  return null
}

export function ExecutionView({
  useSession, useSessions, useProjection, useStore, sessionId, t,
  openFile, inspectCall, forkAt, fileMentions, inspect, onInspectDone,
  renderChatNode, renderMessageImages,
}: ExecutionViewSlotProps) {
  const chat = useSession(s => s.chat)
  const running = useSession(s => s.running)
  const partial = useSession(s => s.partial)
  const selectedCallId = useStore(s => s.selection?.callId)
  const todos = useProjection('todos') ?? []
  const cwd = useSessions(s => s.byId[sessionId]?.cwd)

  // Normalized events: re-derived whenever the Chat snapshot swaps (order or
  // any node content), so the header summary and filters stay current.
  const { list: events, byKey } = useMemo(() => {
    const list: ExecutionEvent[] = []
    const byKey = new Map<string, ExecutionEvent>()
    for (const key of chat.order) {
      const node = chat.nodes.get(key)
      if (node === undefined) continue
      const event = executionEventFromNode(node as ChatNode)
      list.push(event)
      byKey.set(key, event)
    }
    return { list, byKey }
  }, [chat])

  const summary = useMemo(
    () => executionTraceSummary(events, chat.timeline, partial, running),
    [events, chat.timeline, partial, running],
  )
  const lastStatus = useMemo(() => {
    const last = events.at(-1)
    return last?.status ?? 'info'
  }, [events])

  // Toolbar state.
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<ExecutionFilter>('all')
  // Expansion: a global mode plus per-row flips relative to the effective
  // base; any individual toggle cancels the global mode.
  const [mode, setMode] = useState<'default' | 'expand' | 'collapse'>('default')
  const [flipped, setFlipped] = useState<ReadonlySet<string>>(() => new Set())
  const [revealed, setRevealed] = useState<ReadonlySet<string>>(() => new Set())

  const visibleKeys = useMemo(() => chat.order.filter((key) => {
    const event = byKey.get(key)
    return event !== undefined && matchesFilter(event, filter) && matchesQuery(event, query)
  }), [chat.order, byKey, filter, query])

  const effectiveExpanded = useCallback((key: string): boolean => {
    if (revealed.has(key)) return true
    const node = chat.nodes.get(key)
    const base = mode === 'expand' ? true : mode === 'collapse' ? false : isDefaultExpanded(node?.kind ?? '')
    return flipped.has(key) ? !base : base
  }, [mode, flipped, revealed, chat])

  const toggleRow = useCallback((key: string) => {
    setMode('default')
    setFlipped((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  const expandAll = useCallback(() => {
    setMode('expand')
    setFlipped(new Set())
  }, [])

  const collapseAll = useCallback(() => {
    setMode('collapse')
    setFlipped(new Set())
  }, [])

  // Virtual list geometry.
  const listRef = useRef<HTMLDivElement | null>(null)
  const heightsRef = useRef(new Map<string, number>())
  const [heightsVersion, setHeightsVersion] = useState(0)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewport, setViewport] = useState(0)
  const [atBottom, setAtBottom] = useState(true)
  // Follow the trace tail while the reader is pinned to the floor.
  const followRef = useRef(true)

  const measure = useCallback((key: string, height: number) => {
    if (heightsRef.current.get(key) === height) return
    heightsRef.current.set(key, height)
    setHeightsVersion(version => version + 1)
  }, [])

  const layout = useMemo(
    () => executionOffsets(visibleKeys, key => heightsRef.current.get(key)),
    [visibleKeys, heightsVersion],
  )
  const windowRows = useMemo(
    () => executionWindow(scrollTop, viewport, layout, visibleKeys.length),
    [scrollTop, viewport, layout, visibleKeys.length],
  )

  const scrollToBottom = useCallback(() => {
    const el = listRef.current
    /* v8 ignore next -- ref-null guard: the button only renders beside the mounted list. */
    if (el === null) return
    el.scrollTop = el.scrollHeight
    setScrollTop(el.scrollTop)
    setAtBottom(true)
  }, [])

  const scrollToKey = useCallback((key: string) => {
    const el = listRef.current
    if (el === null) return
    const index = visibleKeys.indexOf(key)
    if (index === -1) return
    const target = layout.offsets[index] ?? 0
    el.scrollTop = Math.max(0, target - Math.floor(el.clientHeight / 3))
    setScrollTop(el.scrollTop)
  }, [visibleKeys, layout])

  // Own scrollport height; re-measure on resize.
  useEffect(() => {
    const el = listRef.current
    /* v8 ignore next -- ref-null guard: the effect runs after the list node commits. */
    if (el === null || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => { setViewport(el.clientHeight) })
    observer.observe(el)
    setViewport(el.clientHeight)
    return () => { observer.disconnect() }
  }, [])

  const onScroll = useCallback(() => {
    const el = listRef.current
    /* v8 ignore next -- ref-null guard: the handler only fires while mounted. */
    if (el === null) return
    setScrollTop(el.scrollTop)
    const floor = isAtScrollFloor(el.scrollTop, el.scrollHeight, el.clientHeight, FOLLOW_THRESHOLD)
    followRef.current = floor
    setAtBottom(floor)
  }, [])

  // Follow the trace tail while the reader is pinned: re-scroll whenever the
  // flow grows — a new row (visibleKeys.length), a measured height landing or
  // in-place growth that moves the floor (layout.total), or a scrollport
  // resize (viewport). An unpinned reader keeps the position; scrolling back
  // to the floor re-pins.
  useEffect(() => {
    if (!followRef.current) return
    const el = listRef.current
    if (el === null) return
    el.scrollTop = el.scrollHeight
    setScrollTop(el.scrollTop)
  }, [visibleKeys.length, layout.total, viewport])

  const jumpToLatest = useCallback(() => {
    followRef.current = true
    scrollToBottom()
  }, [scrollToBottom])

  // One-shot inspect handoff: reveal and expand the addressed tool call.
  useEffect(() => {
    if (inspect === undefined || inspect === null) return
    const key = findCallKey(chat, inspect.callId)
    if (key !== null) {
      setRevealed((prev) => {
        const next = new Set(prev)
        next.add(key)
        return next
      })
      scrollToKey(key)
    }
    onInspectDone?.()
  }, [inspect, chat, scrollToKey, onInspectDone])

  const revealFile = useCallback((path: string) => {
    const entry = summary.files.find(file => file.path === path)
    if (entry !== undefined) {
      setRevealed((prev) => {
        const next = new Set(prev)
        next.add(entry.firstKey)
        return next
      })
      scrollToKey(entry.firstKey)
    }
  }, [summary.files, scrollToKey])

  const revealAction = useCallback((key: string) => {
    setRevealed((prev) => {
      const next = new Set(prev)
      next.add(key)
      return next
    })
    scrollToKey(key)
  }, [scrollToKey])

  const owner = useMemo<ChatNodeOwnerProps>(() => ({
    selectedCallId,
    cwd,
    // The view inject's openFile returns a promise; the node seat currency
    // is void, so the rejection surface stays the chat view's dialog path.
    openFile: (path) => { void openFile(path) },
    inspectCall,
    forkAt,
    renderMessageImages,
    fileMentions,
  }), [selectedCallId, cwd, openFile, inspectCall, forkAt, renderMessageImages, fileMentions])

  return (
    <div className={css.root} data-conversation-composer-overlay="" data-testid="execution-view">
      <ExecutionHeader
        sessionId={sessionId}
        useSessions={useSessions}
        t={t}
        summary={summary}
        running={running}
        lastStatus={lastStatus}
        todos={todos}
        onOpenFile={revealFile}
        onRevealEvent={revealAction}
      />
      <div className={css.toolbar}>
        <div className={css.search}>
          <span className={css.searchIcon} aria-hidden><IconSearchOutline16 /></span>
          <input
            className={css.searchInput}
            type="search"
            value={query}
            placeholder={t('execution.search.placeholder')}
            aria-label={t('execution.search.placeholder')}
            onChange={(event) => { setQuery(event.target.value) }}
          />
        </div>
        <div className={css.filters} role="group" aria-label={t('execution.filters.label')}>
          {EXECUTION_FILTERS.map(id => (
            <button
              key={id}
              type="button"
              className={clsx(css.filterChip, filter === id && css.filterChipActive)}
              data-filter={id}
              aria-pressed={filter === id}
              onClick={() => { setFilter(id) }}
            >
              {t(`execution.filter.${id}`)}
            </button>
          ))}
        </div>
        <div className={css.actions}>
          <button type="button" className={css.toolButton} onClick={expandAll} aria-label={t('execution.expandAll')}>
            {t('execution.expandAll')}
          </button>
          <button type="button" className={css.toolButton} onClick={collapseAll} aria-label={t('execution.collapseAll')}>
            {t('execution.collapseAll')}
          </button>
        </div>
      </div>
      <div
        ref={listRef}
        className={css.list}
        data-testid="execution-list"
        onScroll={onScroll}
      >
        <div className={css.flow} style={{ height: layout.total }}>
          {visibleKeys.slice(windowRows.start, windowRows.end).map((key, at) => {
            const index = windowRows.start + at
            return (
              <div
                key={key}
                className={css.rowSlot}
                style={{ top: layout.offsets[index] ?? 0 }}
                data-execution-row-key={key}
              >
                <Measure onMeasure={(height) => { measure(key, height) }}>
                  <ExecutionEventRow
                    nodeKey={key}
                    expanded={effectiveExpanded(key)}
                    onToggle={() => { toggleRow(key) }}
                    owner={owner}
                    useSession={useSession}
                    renderChatNode={renderChatNode}
                    t={t}
                    query={query}
                  />
                </Measure>
              </div>
            )
          })}
        </div>
        {!atBottom && (
          <button
            type="button"
            className={css.jumpLatest}
            aria-label={t('execution.jumpLatest')}
            onClick={jumpToLatest}
          >
            <IconChevronDownOutline14 />
          </button>
        )}
        {visibleKeys.length === 0 && (
          <div className={css.empty}>
            {t('execution.empty', { query: query.trim() })}
          </div>
        )}
      </div>
    </div>
  )
}

/** Measure one mounted row's height through a ResizeObserver (expand changes included). */
function Measure({ onMeasure, children }: {
  onMeasure: (height: number) => void
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const el = ref.current
    if (el === null) return
    const report = (): void => { onMeasure(el.offsetHeight) }
    report()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(report)
    observer.observe(el)
    return () => { observer.disconnect() }
  }, [onMeasure])
  return (
    <div ref={ref}>
      {children}
    </div>
  )
}
