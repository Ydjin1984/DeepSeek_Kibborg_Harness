import type { ChatSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import type { ChatNode } from './chat-nodes.ts'

/** One authored request in the loaded transcript. */
export interface PromptEntry {
  readonly key: string
  readonly seq: number
  readonly preview: string
}

/**
 * Read user and steering requests in their stable Chat order.
 * @param chat - Current Chat snapshot.
 * @returns Loaded requests, excluding context and system nodes.
 */
export function promptEntries(chat: Pick<ChatSnapshot, 'order' | 'nodes'>): readonly PromptEntry[] {
  const entries: PromptEntry[] = []
  for (const key of chat.order) {
    const node = chat.nodes.get(key)
    if (node?.kind !== 'user' && node?.kind !== 'steering') continue
    const content = (node as ChatNode<'user' | 'steering'>).data.content
    const preview = content.flatMap(block => block.type === 'text' ? [block.text] : [])
      .join('').trim().split(/\r?\n/u)[0]?.slice(0, 80) ?? ''
    entries.push({ key, seq: node.anchorSeq, preview })
  }
  return entries
}

/** Last prompt at or before a visible event sequence. */
export function activePromptAtSeq(entries: readonly PromptEntry[], seq: number): string | null {
  let low = 0
  let high = entries.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if ((entries[middle]?.seq ?? Infinity) <= seq) low = middle + 1
    else high = middle
  }
  return entries[Math.max(0, low - 1)]?.key ?? null
}

/** Bounded request ticks and indices of omitted adjacent ranges. */
export interface PromptWindow {
  readonly items: readonly (PromptEntry & { readonly index: number })[]
  readonly before: number | null
  readonly after: number | null
}

/**
 * Keep at most nine ticks around the active request.
 * @param entries - Loaded requests in order.
 * @param activeKey - Nearest visible request key.
 * @param maxVisible - Maximum simultaneous ticks.
 * @returns Ticks and adjacent range targets.
 */
export function visiblePromptWindow(entries: readonly PromptEntry[], activeKey: string | null, maxVisible = 9): PromptWindow {
  const size = Math.max(1, Math.floor(maxVisible))
  const active = entries.findIndex(entry => entry.key === activeKey)
  const center = active < 0 ? entries.length - 1 : active
  const start = Math.max(0, Math.min(entries.length - size, center - Math.floor(size / 2)))
  const end = Math.min(entries.length, start + size)
  return {
    items: entries.slice(start, end).map((entry, offset) => ({ ...entry, index: start + offset })),
    before: start > 0 ? start - 1 : null,
    after: end < entries.length ? end : null,
  }
}
