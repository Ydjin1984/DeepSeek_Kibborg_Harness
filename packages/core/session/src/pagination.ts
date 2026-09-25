/**
 * Transcript pagination: the message-boundary window one history read serves.
 *
 * Both readers of a stored log share this module — the host, paging an
 * attached session's in-memory events, and a persistence backend, choosing
 * which stored events a cold page even needs to decode. One implementation
 * keeps the two answers identical; a second one would drift.
 *
 * @module @deepseek-ai/dsh-session/pagination
 */

import type { SessionEvent } from './types.ts'
import { isAppendSurfaceEvent } from './surface.ts'

/** Page size when history is called without maxMessages. */
export const DEFAULT_MAX_MESSAGES = 50

/**
 * Hard cap on events in one history page. Message counting alone can keep
 * tens of thousands of chunks in a "50-message" window. The live client
 * retains completed message groups separately from this RPC page limit.
 */
export const MAX_PAGE_EVENTS = 400

/** Conversation message event types (the pagination counting unit). */
export const MESSAGE_TYPES: ReadonlySet<string> = new Set(['user/message', 'assistant/message'])

/** One page of a log: its events plus whether older events remain. */
export interface HistoryPage {
  events: SessionEvent[]
  hasMore: boolean
}

/**
 * Whether one event both is a conversation message and entered the surface as
 * an append. Replacement copies never entered the conversation a reader sees —
 * they restate a shadowed range for the model alone — so they consume no quota.
 * @param event - the log event to classify.
 * @returns whether the event counts toward `maxMessages`.
 */
export function isCountedPageMessage(event: SessionEvent): boolean {
  return MESSAGE_TYPES.has(event.type) && isAppendSurfaceEvent(event)
}

/**
 * The seq a message group starts at: its own seq, or the earliest event it
 * cites as a source. Chunks group through `sourceEventSeqs`, so a page never
 * cuts mid-message.
 * @param event - one counted message.
 * @returns the group's starting seq.
 */
export function messageGroupStart(event: SessionEvent): number {
  let groupStart = event.seq
  const sources = (event as { sourceEventSeqs?: number[] }).sourceEventSeqs
  if (sources !== undefined) {
    for (const source of sources) {
      if (source < groupStart) groupStart = source
    }
  }
  return groupStart
}

/**
 * Event-cap cut that does not start a page inside a message group.
 * @param events - the log being paged.
 * @param capIndex - oldest index that still fits in the event cap.
 * @param end - exclusive end of the page window.
 * @returns starting seq of the page.
 */
function eventCapCut(events: readonly SessionEvent[], capIndex: number, end: number): number {
  const capSeq = events[capIndex]?.seq ?? 0
  let messageIndex = -1
  for (let j = capIndex; j < end; j++) {
    const candidate = events[j] as SessionEvent
    if (!isCountedPageMessage(candidate)) continue
    messageIndex = j
    break
  }
  if (messageIndex === -1) return capSeq
  const message = events[messageIndex] as SessionEvent
  if (messageGroupStart(message) >= capSeq) return capSeq
  for (let k = messageIndex + 1; k < end; k++) {
    const candidate = events[k] as SessionEvent
    if (candidate.type === 'turn/start') return candidate.seq
    if (isCountedPageMessage(candidate)) return messageGroupStart(candidate)
  }
  return message.seq
}

/**
 * Message-boundary pagination: count maxMessages append-origin messages
 * backwards from the window tail. Replacement copies never entered the
 * conversation a reader sees — they restate a shadowed range for the model
 * alone — so they consume no quota; the page stays one contiguous raw range,
 * which keeps a compaction's log-only `compaction/summary` record on the same
 * page as its replacement. The cut is the starting seq of the oldest message
 * group or, when the window already holds {@link MAX_PAGE_EVENTS} events, a
 * message-aligned seq: an incomplete oldest group is dropped when a later
 * complete turn still fits, otherwise the page starts at that group's
 * finalized message so the assembler does not see orphan chunks. The tail page
 * naturally includes the in-progress partial.
 * @param events - the events to page, oldest first.
 * @param beforeSeq - exclusive upper bound; undefined pages from the tail.
 * @param maxMessages - counted messages per page.
 * @returns the page's events and whether older events remain.
 */
export function paginate(
  events: readonly SessionEvent[],
  beforeSeq: number | undefined,
  maxMessages: number,
): HistoryPage {
  let end = events.length
  if (beforeSeq !== undefined) {
    while (end > 0 && (events[end - 1]?.seq ?? 0) >= beforeSeq) end -= 1
  }
  let count = 0
  let cut = 0
  for (let i = end - 1; i >= 0; i--) {
    const event = events[i] as SessionEvent
    if (end - i >= MAX_PAGE_EVENTS) {
      cut = eventCapCut(events, i, end)
      break
    }
    if (!isCountedPageMessage(event)) continue
    count++
    if (count >= maxMessages) {
      cut = messageGroupStart(event)
      break
    }
  }
  let start = 0
  while (start < end && (events[start]?.seq ?? 0) < cut) start += 1
  return { events: events.slice(start, end), hasMore: cut > 0 }
}
