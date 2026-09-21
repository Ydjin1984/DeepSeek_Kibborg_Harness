import type { ChatSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import type { ExecutionEvent } from './execution-event.ts'

/** One registered turn with stable event keys in transcript order. */
export interface ExecutionGroup {
  readonly key: string
  readonly number: number
  readonly eventKeys: readonly string[]
}

/**
 * Group events only where the engine registered a turn start.
 * @param events - Chronological execution events.
 * @param timeline - Engine-owned turn locations.
 * @returns Registered turns with the keys of events assigned to each turn.
 */
export function groupExecutionEvents(
  events: readonly ExecutionEvent[], timeline: ChatSnapshot['timeline'],
): readonly ExecutionGroup[] {
  const turns = timeline.turnOrder.flatMap((number) => {
    const turn = timeline.turns.get(number)
    return turn?.start === undefined ? [] : [{ number, seq: turn.start.seq, endSeq: turn.end?.seq }]
  }).sort((left, right) => left.seq - right.seq)
  const byNumber = new Map(turns.map(turn => [turn.number, turn]))
  const grouped = new Map<number, string[]>()
  let current = -1
  for (const event of events) {
    for (;;) {
      const next = turns[current + 1]
      if (next === undefined || next.seq > event.seq) break
      current++
    }
    const previousEnd = turns[current]?.endSeq
    const matched = event.turn === undefined
      ? event.kind === 'user' && turns[current + 1] !== undefined
        && (current < 0 || (previousEnd !== undefined && previousEnd < event.seq))
        ? turns[current + 1]
        : turns[current]
      : byNumber.get(event.turn)
    if (matched === undefined) continue
    let group = grouped.get(matched.number)
    if (group === undefined) {
      group = []
      grouped.set(matched.number, group)
    }
    group.push(event.key)
  }
  return turns.flatMap((turn) => {
    const group = grouped.get(turn.number)
    return group === undefined ? [] : [{ key: `turn:${turn.number}`, number: turn.number, eventKeys: group }]
  })
}
