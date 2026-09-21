import { describe, expect, it } from 'vitest'
import { promptEntries, visiblePromptWindow } from '../src/client/contract/prompt-nav.ts'
import { chatSnapshotFixture } from './chat-snapshot-fixture.client.ts'
import type { ConversationNode } from '@deepseek-ai/dsh-client-runtime/client'

function user(seq: number): ConversationNode {
  return { kind: 'user', seq, time: seq * 1_000, source: null,
    content: [{ type: 'text', text: `Request ${seq}\nmore details` }] }
}

describe('prompt navigation', () => {
  it('lists authored prompts without context nodes', () => {
    const chat = chatSnapshotFixture({ nodes: [user(1), user(3)] })
    expect(promptEntries(chat).map(entry => entry.preview)).toEqual(['Request 1', 'Request 3'])
  })

  it('keeps nine stable ticks around a selected request in a 200-prompt history', () => {
    const entries = Array.from({ length: 200 }, (_, index) => ({ key: `user:${index}`, seq: index, preview: `Request ${index}` }))
    const middle = visiblePromptWindow(entries, 'user:100')
    expect(middle.items).toHaveLength(9)
    expect(middle.items[4]?.key).toBe('user:100')
    expect(middle.before).toBe(95)
    expect(middle.after).toBe(105)
    const tail = visiblePromptWindow(entries, 'user:199')
    expect(tail.items.at(-1)?.key).toBe('user:199')
    expect(tail.after).toBeNull()
  })
})
