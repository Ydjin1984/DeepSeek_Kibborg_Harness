// The fixed mixed workload used as a baseline before feed layout or
// virtualization changes. It deliberately uses public runtime nodes so future
// UI tests exercise the same event vocabulary as a replayed conversation.

import { describe, expect, it } from 'vitest'
import {
  conversationActivityFixture,
  conversationActivityProfile,
} from './conversation-activity-fixture.client.ts'

describe('conversationActivityFixture', () => {
  it('builds the reproducible mixed fifty-event baseline from real runtime nodes', () => {
    const fixture = conversationActivityFixture(50)

    expect(fixture.nodes).toHaveLength(50)
    expect(fixture.snapshot.order).toHaveLength(50)
    expect(fixture.snapshot.nodes.values()).toHaveLength(50)
    expect(fixture.nodes.map(node => node.seq)).toEqual(Array.from({ length: 50 }, (_, index) => index + 1))
    expect(fixture.nodes.map(node => node.kind)).toContain('user')
    expect(fixture.nodes.map(node => node.kind)).toContain('assistant')
    expect(fixture.nodes.filter(node => node.kind === 'tool-result').map(node => node.call?.name)).toEqual(expect.arrayContaining([
      'read', 'edit', 'bash', 'search', 'subagent', 'ask_user', 'todo_write',
    ]))
    expect(fixture.nodes.filter(node => node.kind === 'tool-result' && node.isError)).toHaveLength(1)
    expect(fixture.profile).toEqual(conversationActivityProfile(50))
  })

  it.each([1_000, 5_000])('builds the long %i-event workload without synthetic node fields', (count) => {
    const fixture = conversationActivityFixture(count)

    expect(fixture.nodes).toHaveLength(count)
    expect(fixture.snapshot.order).toHaveLength(count)
    expect(fixture.profile.total).toBe(count)
    expect(fixture.profile.error).toBeGreaterThan(0)
    expect(fixture.profile.running).toBe(0)
  })
})
