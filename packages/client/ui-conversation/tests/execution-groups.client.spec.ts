import { describe, expect, it } from 'vitest'
import type { ConversationTimelineSnapshot, TurnLocation } from '@deepseek-ai/dsh-client-runtime/client'
import type { ExecutionEvent } from '../src/client/execution/execution-event.ts'
import { groupExecutionEvents } from '../src/client/execution/execution-groups.ts'

const data = { get: () => undefined }

function turn(number: number, firstSeq: number): TurnLocation {
  return {
    turn: number,
    start: { type: 'turn/start', seq: firstSeq, time: firstSeq * 1_000, data: { turn: number } },
    end: undefined,
    status: 'open',
    steps: [],
    data,
  }
}

function timeline(...turns: TurnLocation[]): ConversationTimelineSnapshot {
  return { turnOrder: turns.map(value => value.turn), turns: new Map(turns.map(value => [value.turn, value])) }
}

function event(key: string, seq: number, turnNumber?: number, step?: number, user = false): ExecutionEvent {
  return {
    key, seq, time: seq * 1_000, kind: user ? 'user' : 'assistant-step',
    category: user ? 'message' : 'agent', type: user ? 'user_message' : 'analysis',
    status: 'info', title: user ? turnNumber === undefined ? 'Request' : `Request ${turnNumber}` : 'Analysis', description: '',
    ...turnNumber === undefined ? {} : { turn: turnNumber },
    ...step === undefined ? {} : { step },
  }
}

describe('groupExecutionEvents', () => {
  it('places a prompt immediately before the registered turn start in that turn', () => {
    expect(groupExecutionEvents([
      event('user:1', 9, undefined, undefined, true), event('analysis:1', 11, 1, 1),
    ], timeline(turn(1, 10)))).toEqual([
      { key: 'turn:1', number: 1, eventKeys: ['user:1', 'analysis:1'] },
    ])
  })

  it('keeps two user turns and multiple steps in source order using registered turns', () => {
    const events = [
      event('user:1', 11, 1, undefined, true),
      event('analysis:1', 13, 1, 1),
      event('tool:1', 15, 1, 2),
      event('user:2', 21, 2, undefined, true),
      event('partial-tool:2', 24, 2, 1),
    ]

    expect(groupExecutionEvents(events, timeline(turn(1, 10), turn(2, 20)))).toEqual([
      { key: 'turn:1', number: 1, eventKeys: ['user:1', 'analysis:1', 'tool:1'] },
      { key: 'turn:2', number: 2, eventKeys: ['user:2', 'partial-tool:2'] },
    ])
  })

  it('preserves loaded turn and event keys when older history is prepended', () => {
    const recent = [event('user:8', 81, 8, undefined, true), event('tool:8', 83, 8, 2)]
    const before = groupExecutionEvents(recent, timeline(turn(8, 80)))
    const after = groupExecutionEvents([
      event('user:7', 71, 7, undefined, true), ...recent,
    ], timeline(turn(7, 70), turn(8, 80)))

    expect(after.map(group => group.key)).toEqual(['turn:7', 'turn:8'])
    expect(after[1]).toEqual(before[0])
  })

  it('does not invent a group for events without a registered boundary', () => {
    const unknown: TurnLocation = { ...turn(3, 30), start: undefined, status: 'unknown' }
    const events = [event('unresolved', 30), event('inferred:3', 31, 3), event('tool:4', 41, 4, 1)]

    expect(groupExecutionEvents(events, timeline(unknown, turn(4, 40)))).toEqual([
      { key: 'turn:4', number: 4, eventKeys: ['tool:4'] },
    ])
  })
})
