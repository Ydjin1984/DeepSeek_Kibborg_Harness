// ExecutionView: the professional execution-trace view tab. Reads the same
// conversation snapshot as ChatView and projects it into a normalized event
// timeline: a sticky task header (title, run state, counters, current action,
// plan, files), a toolbar (search, category filters, expand/collapse all,
// follow), and a directly-rendered event list. Each event row owns its header
// chrome and dispatches its Chat node through the shared
// 'conversation.chat.node' seat, so the specialized renderers stay in one
// place. Long traces mount a measured window of rows. The view owns its
// scrollport (`data-conversation-composer-overlay`),
// which keeps the sticky composer seat intact below it.

import {
  useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState,
} from 'react'
import { uiDebugSpanSync } from '@deepseek-ai/dsh-debug-log'
import clsx from 'clsx'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { ChatSnapshot, ToolCallBlock } from '@deepseek-ai/dsh-client-runtime/client'
import {
  IconChevronDownOutline14,
  IconSearchOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChatNode, ToolChatData } from '../contract/chat-nodes.ts'
import { activePromptAtSeq, promptEntries } from '../contract/prompt-nav.ts'
import { PromptRail } from '../skeleton/PromptRail.tsx'
import type {
  ChatNodeOwnerProps, ExecutionViewSlotProps,
} from '../contract/slots.ts'
import { ExecutionEventRow } from './ExecutionEventRow.tsx'
import { ExecutionHeader } from './ExecutionHeader.tsx'
import { executionEventFromNode, type ExecutionEvent } from './execution-event.ts'
import { groupExecutionEvents } from './execution-groups.ts'
import { EXECUTION_FILTERS, matchesFilter, matchesQuery, type ExecutionFilter } from './execution-filter.ts'
import { executionTraceSummary } from './execution-summary.ts'
import { isAtScrollFloor } from './execution-virtual.ts'
import { nextFollowMode, type FollowMode } from '../contract/bottom-follow.ts'
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
  useSession, useSessions, useProjection, useStore, actions, sessionId, t,
  openFile, loadOlder, inspectCall, forkAt, fileMentions, inspect, onInspectDone,
  renderChatNode, renderMessageImages, viewBookmark, saveViewBookmark,
}: ExecutionViewSlotProps) {
  const chat = useSession(s => s.chat)
  const running = useSession(s => s.running)
  const partial = useSession(s => s.partial)
  const hasMore = useSession(s => s.hasMore)
  const loadingOlder = useSession(s => s.loadingOlder)
  const selectedCallId = useStore(s => s.selection?.callId)
  const todos = useProjection('todos') ?? []
  const cwd = useSessions(s => s.byId[sessionId]?.cwd)
  const eventCache = useRef(new Map<string, { node: ChatNode; event: ExecutionEvent }>())

  // Normalized events: re-derived whenever the Chat snapshot swaps (order or
  // any node content), so the header summary and filters stay current.
  const { list: events, byKey } = useMemo(() => {
    return uiDebugSpanSync(
      'ui',
      'execution.events',
      { nodes: chat.order.length },
      () => {
        const list: ExecutionEvent[] = []
        const byKey = new Map<string, ExecutionEvent>()
        const nextCache = new Map<string, { node: ChatNode; event: ExecutionEvent }>()
        for (const key of chat.order) {
          const node = chat.nodes.get(key)
          if (node === undefined) continue
          const typedNode = node as ChatNode
          const cached = eventCache.current.get(key)
          const event = cached?.node === typedNode ? cached.event : executionEventFromNode(typedNode)
          list.push(event)
          byKey.set(key, event)
          nextCache.set(key, { node: typedNode, event })
        }
        eventCache.current = nextCache
        return { list, byKey }
      },
      result => ({ events: result.list.length }),
    )
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
  // Expansion: a persisted global mode (survives view switches and reloads)
  // plus per-row flips relative to the effective base; any individual toggle
  // cancels the global mode. Persisted snapshots from before this field
  // rehydrate without it, so the selector reads that as `'default'`.
  const executionExpand = useStore(s => s.executionExpand)
  const [flipped, setFlipped] = useState<ReadonlySet<string>>(() => new Set())
  const [revealed, setRevealed] = useState<ReadonlySet<string>>(() => new Set())

  const visibleKeys = useMemo(() => chat.order.filter((key) => {
    const event = byKey.get(key)
    return event !== undefined && matchesFilter(event, filter) && matchesQuery(event, query)
  }), [chat.order, byKey, filter, query])
  const groups = useMemo(() => groupExecutionEvents(events, chat.timeline), [events, chat.timeline])
  const visibleRows = useMemo(() => {
    const groupByEvent = new Map(groups.flatMap(group => group.eventKeys.map(key => [key, group] as const)))
    const seen = new Set<string>()
    const rows: Array<{ key: string; kind: 'event' } | { key: string; kind: 'group'; number: number }> = []
    for (const key of visibleKeys) {
      const group = groupByEvent.get(key)
      if (group !== undefined && !seen.has(group.key)) {
        rows.push({ key: group.key, kind: 'group', number: group.number })
        seen.add(group.key)
      }
      rows.push({ key, kind: 'event' })
    }
    return rows
  }, [visibleKeys, groups])

  const effectiveExpanded = useCallback((key: string): boolean => {
    if (revealed.has(key)) return true
    const base = executionExpand === 'expand'
    return flipped.has(key) ? !base : base
  }, [executionExpand, flipped, revealed])

  const toggleRow = useCallback((key: string) => {
    const nextExpanded = !effectiveExpanded(key)
    actions.setExecutionExpand('default')
    setRevealed((prev) => {
      if (!prev.has(key)) return prev
      const next = new Set(prev)
      next.delete(key)
      return next
    })
    setFlipped((prev) => {
      const next = new Set(prev)
      if (nextExpanded) next.add(key)
      else next.delete(key)
      return next
    })
  }, [actions, effectiveExpanded])

  const expandAll = useCallback(() => {
    actions.setExecutionExpand('expand')
    setFlipped(new Set())
    setRevealed(new Set())
  }, [actions])

  const collapseAll = useCallback(() => {
    actions.setExecutionExpand('collapse')
    setFlipped(new Set())
    setRevealed(new Set())
  }, [actions])

  // Scroll geometry uses the scrollport's scrollHeight for bottom follow.
  // The virtualizer measures long lists and `viewport` triggers resize follow.
  const listRef = useRef<HTMLDivElement | null>(null)
  const virtualized = visibleRows.length > 120
  const getScrollElement = useCallback(() => listRef.current, [])
  const virtualizer = useVirtualizer({
    count: virtualized ? visibleRows.length : 0,
    enabled: virtualized,
    getScrollElement,
    estimateSize: index => visibleRows[index]?.kind === 'group' ? 36 : 52,
    getItemKey: index => visibleRows[index]?.key ?? index,
    overscan: 8,
    initialRect: { width: 800, height: 640 },
  })
  const visibleRowIndex = useMemo(() => new Map(visibleRows.map((row, index) => [row.key, index])), [visibleRows])
  const prompts = useMemo(() => promptEntries(chat), [chat])
  const [activePrompt, setActivePrompt] = useState<string | null>(null)
  const promptFrame = useRef<number | null>(null)
  const pendingPrompt = useRef<string | null>(null)
  const [viewport, setViewport] = useState(0)
  const [atBottom, setAtBottom] = useState(true)
  const modeRef = useRef<FollowMode>('following')
  const gestureRef = useRef<'up' | 'other' | null>(null)
  const followRef = useRef(true)
  const changeMode = useCallback((action: Parameters<typeof nextFollowMode>[1]) => {
    modeRef.current = nextFollowMode(modeRef.current, action)
    followRef.current = modeRef.current === 'following'
  }, [])

  useLayoutEffect(() => {
    const el = listRef.current
    const bookmark = viewBookmark?.('execution')
    if (el === null || bookmark?.mode !== 'reading') return
    modeRef.current = 'reading'
    followRef.current = false
    setAtBottom(false)
    const index = bookmark.anchorKey === null ? undefined : visibleRowIndex.get(bookmark.anchorKey)
    if (index !== undefined && virtualized) {
      virtualizer.scrollToIndex(index, { align: 'start' })
      el.scrollTop -= bookmark.anchorOffset
    } else el.scrollTop = bookmark.scrollTop
  }, [])

  const saveBookmarkRef = useRef<() => void>(() => {})
  saveBookmarkRef.current = () => {
    const el = listRef.current
    if (el === null || saveViewBookmark === undefined) return
    const first = virtualized ? virtualizer.getVirtualItems()[0] : undefined
    const key = first === undefined
      ? el.querySelector<HTMLElement>('[data-execution-row-key]')?.dataset.executionRowKey ?? null
      : visibleRows[first.index]?.key ?? null
    saveViewBookmark('execution', {
      mode: modeRef.current === 'following' ? 'following' : 'reading',
      anchorKey: key,
      anchorOffset: first === undefined ? 0 : first.start - el.scrollTop,
      scrollTop: el.scrollTop,
    })
  }
  useLayoutEffect(() => () => { saveBookmarkRef.current() }, [])

  const scrollToBottom = useCallback(() => {
    const el = listRef.current
    /* v8 ignore next -- ref-null guard: the button only renders beside the mounted list. */
    if (el === null) return
    el.scrollTop = el.scrollHeight
    setAtBottom(true)
  }, [])

  const scrollToKey = useCallback((key: string) => {
    const el = listRef.current
    if (el === null) return
    if (virtualized) {
      const index = visibleRowIndex.get(key)
      if (index !== undefined) virtualizer.scrollToIndex(index, { align: 'center' })
      return
    }
    for (const row of el.querySelectorAll<HTMLElement>('[data-execution-row-key]')) {
      if (row.dataset.executionRowKey !== key) continue
      /* v8 ignore next -- jsdom lacks scrollIntoView; browsers always have it. */
      if (typeof row.scrollIntoView === 'function') row.scrollIntoView({ block: 'center' })
      return
    }
  }, [virtualized, visibleRowIndex, virtualizer])

  // Own scrollport height; re-measure on resize.
  useEffect(() => {
    const el = listRef.current
    /* v8 ignore next -- ref-null guard: the effect runs after the list node commits. */
    if (el === null || typeof ResizeObserver === 'undefined') return
    const flow = el.querySelector(`.${css.flow}`) ?? el
    const observer = new ResizeObserver(() => {
      setViewport(el.clientHeight)
      if (followRef.current) el.scrollTop = el.scrollHeight
    })
    observer.observe(el)
    observer.observe(flow)
    setViewport(el.clientHeight)
    return () => { observer.disconnect() }
  }, [])

  const onScroll = useCallback(() => {
    const el = listRef.current
    /* v8 ignore next -- ref-null guard: the handler only fires while mounted. */
    if (el === null) return
    const floor = isAtScrollFloor(el.scrollTop, el.scrollHeight, el.clientHeight, FOLLOW_THRESHOLD)
    if (modeRef.current === 'jumping' && floor) changeMode('jump-complete')
    else if (gestureRef.current !== null) {
      changeMode(gestureRef.current === 'up' ? 'reader-left' : floor ? 'reader-at-floor' : 'reader-left')
    }
    gestureRef.current = null
    setAtBottom(modeRef.current === 'following')
    if (promptFrame.current !== null) cancelAnimationFrame(promptFrame.current)
    promptFrame.current = requestAnimationFrame(() => {
      promptFrame.current = null
      const key = virtualized
        ? visibleRows[virtualizer.getVirtualItems()[0]?.index ?? 0]?.key
        : [...el.querySelectorAll<HTMLElement>('[data-execution-row-key]')]
          .find(row => row.getBoundingClientRect().bottom >= el.getBoundingClientRect().top)?.dataset.executionRowKey
      const event = key === undefined ? undefined : byKey.get(key)
      setActivePrompt(modeRef.current === 'following'
        ? prompts.at(-1)?.key ?? null
        : event === undefined ? null : activePromptAtSeq(prompts, event.seq))
    })
  }, [changeMode, virtualized, visibleRows, virtualizer, byKey, prompts])

  useEffect(() => () => {
    if (promptFrame.current !== null) cancelAnimationFrame(promptFrame.current)
  }, [])

  useEffect(() => {
    if (pendingPrompt.current === null) return
    const key = pendingPrompt.current
    pendingPrompt.current = null
    scrollToKey(key)
  }, [visibleRows, scrollToKey])

  const selectPrompt = useCallback((key: string) => {
    changeMode('reader-left')
    setAtBottom(false)
    setActivePrompt(key)
    pendingPrompt.current = visibleRowIndex.has(key) ? null : key
    setFilter('all')
    setQuery('')
    scrollToKey(key)
  }, [changeMode, scrollToKey, visibleRowIndex])

  const onReaderGesture = useCallback((up: boolean) => {
    gestureRef.current = up ? 'up' : 'other'
    if (modeRef.current === 'jumping') {
      changeMode('jump-interrupted')
      setAtBottom(false)
    }
    else if (up) {
      changeMode('reader-left')
      setAtBottom(false)
    }
  }, [changeMode])

  // Follow the trace tail while the reader is pinned: re-scroll whenever the
  // flow grows — a new row (visibleKeys.length) or a scrollport resize that
  // moves the floor (viewport). An unpinned reader keeps the position;
  // scrolling back to the floor re-pins.
  useEffect(() => {
    if (!followRef.current) return
    const el = listRef.current
    if (el === null) return
    el.scrollTop = el.scrollHeight
  }, [visibleKeys.length, viewport])

  const jumpToLatest = useCallback(() => {
    const el = listRef.current
    if (el === null) return
    gestureRef.current = null
    changeMode('jump')
    const reducedMotion = typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reducedMotion || typeof el.scrollTo !== 'function') {
      scrollToBottom()
      changeMode('jump-complete')
      return
    }
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [scrollToBottom, changeMode])

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
          {hasMore && (
            <button type="button" className={css.toolButton} disabled={loadingOlder} onClick={loadOlder}>
              {loadingOlder ? t('loading') : t('chat.loadOlder')}
            </button>
          )}
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
        onWheel={(event) => { onReaderGesture(event.deltaY < 0) }}
        onTouchStart={() => { onReaderGesture(false) }}
        onPointerDown={() => { onReaderGesture(false) }}
        onKeyDown={(event) => {
          if (['ArrowUp', 'PageUp', 'Home', 'ArrowDown', 'PageDown', 'End', ' '].includes(event.key)) {
            onReaderGesture(['ArrowUp', 'PageUp', 'Home'].includes(event.key))
          }
        }}
        tabIndex={0}
      >
        <PromptRail
          entries={prompts}
          activeKey={activePrompt ?? prompts.at(-1)?.key ?? null}
          onSelect={selectPrompt}
          navLabel={t('promptRail.label')}
          label={(index, preview) => t('promptRail.prompt', { index: index + 1, preview })}
          older={hasMore ? { label: t('promptRail.older'), loading: loadingOlder, onLoad: loadOlder } : undefined}
        />
        <div className={css.flow} style={virtualized ? { height: virtualizer.getTotalSize(), position: 'relative' } : undefined}>
          {(virtualized ? virtualizer.getVirtualItems().flatMap((item) => {
            const row = visibleRows[item.index]
            return row === undefined ? [] : [{ row, index: item.index, start: item.start }]
          })
            : visibleRows.map((row, index) => ({ row, index, start: 0 }))).map(({ row, index, start }) => row.kind === 'group' ? (
            <div
              key={row.key}
              ref={virtualized ? virtualizer.measureElement : undefined}
              data-index={virtualized ? index : undefined}
              className={css.groupHeading}
              style={virtualized ? { position: 'absolute', top: 0, left: 0, right: 0, transform: `translateY(${start}px)` } : undefined}
            >{t('execution.group.turn', { number: row.number })}</div>
          ) : (
            <div
              key={row.key}
              ref={virtualized ? virtualizer.measureElement : undefined}
              data-index={virtualized ? index : undefined}
              className={css.rowSlot}
              data-execution-row-key={row.key}
              style={virtualized ? { position: 'absolute', top: 0, left: 0, right: 0, transform: `translateY(${start}px)` } : undefined}
            >
              <ExecutionEventRow
                nodeKey={row.key}
                expanded={effectiveExpanded(row.key)}
                onToggle={() => { toggleRow(row.key) }}
                owner={owner}
                useSession={useSession}
                useSessions={useSessions}
                sessionId={sessionId}
                renderChatNode={renderChatNode}
                t={t}
                query={query}
              />
            </div>
          ))}
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
