import { describe, expect, it } from 'vitest'
import type {
  SessionId, SessionSummary, SubagentCatalogSnapshot,
} from '@deepseek-ai/dsh-client-runtime/client'
import {
  indexSubagentDescendants, runningSubagentActivityRows,
} from '@deepseek-ai/dsh-client-runtime/client'

const sid = (id: string) => id as SessionId

function summary(
  id: string,
  parentId?: SessionId,
  origin?: 'subagent',
  running = false,
): SessionSummary {
  return {
    id: sid(id), displayTitle: id, running, blank: false, updatedAt: 0,
    ...(parentId === undefined ? {} : { parentId }),
    ...(origin === undefined ? {} : { origin }),
  }
}

function index(...summaries: SessionSummary[]) {
  return indexSubagentDescendants(Object.fromEntries(
    summaries.map(item => [item.id, item]),
  ))
}

function byId(...summaries: SessionSummary[]): Record<SessionId, SessionSummary> {
  return Object.fromEntries(summaries.map(item => [item.id, item]))
}

function catalog(...ids: string[]): SubagentCatalogSnapshot {
  return {
    state: 'ready', error: null, parentAvailable: true,
    entries: ids.map(id => ({ kind: 'child', id: sid(id), activity: 'running', hasChildren: false, mode: 'one-shot', label: `label-${id}` })),
  }
}

/** Running child whose projection mirrors carry arbitrary subagent values. */
function runningChild(
  id: string,
  parentId: SessionId,
  projections: Record<string, unknown>,
): SessionSummary {
  return {
    ...summary(id, parentId, 'subagent', true),
    projectionValues: projections,
  }
}

describe('runningSubagentActivityRows', () => {
  it('projects only the running direct children with their label and detail', () => {
    const owner = summary('owner')
    const busy = runningChild('child', owner.id, {
      subagent: { mode: 'one-shot', seq: 1 },
      subagentActivity: { status: 'running', detail: 'grep' },
    })
    const idle = summary('done', owner.id, 'subagent')
    const otherOwnerChild = summary('other-child', sid('other'), 'subagent', true)

    const rows = runningSubagentActivityRows(owner.id, byId(owner, busy, idle, otherOwnerChild), {
      [owner.id]: catalog('child'),
    })
    expect(rows).toEqual([{ sessionId: busy.id, label: 'label-child', detail: 'grep' }])
  })

  it('falls back to the descriptor label, then the session id', () => {
    const owner = summary('owner')
    const descriptorLabelled = runningChild('one', owner.id, {
      subagent: { mode: 'one-shot', label: 'descriptor', seq: 1 },
    })
    const unlabelled = summary('two', owner.id, 'subagent', true)

    const rows = runningSubagentActivityRows(
      owner.id,
      byId(owner, descriptorLabelled, unlabelled),
      undefined,
    )
    expect(rows.map(row => row.label)).toEqual(['descriptor', 'two'])
    expect(rows.map(row => row.detail)).toEqual(['', ''])
  })
})

describe('indexSubagentDescendants', () => {
  it('counts every nested descendant and its exact running state', () => {
    const owner = summary('owner')
    const child = summary('child', owner.id, 'subagent')
    const grandchild = summary('grandchild', child.id, 'subagent', true)

    const result = index(owner, child, grandchild)
    expect(result.get(owner.id)).toEqual({ count: 2, runningCount: 1 })
    expect(result.get(child.id)).toEqual({ count: 1, runningCount: 1 })
  })

  it('stops at ordinary forks and fails soft on cycles and missing parents', () => {
    const owner = summary('owner')
    const child = summary('child', owner.id, 'subagent', true)
    const fork = summary('fork', child.id)
    const forkChild = summary('fork-child', fork.id, 'subagent', true)
    const orphan = summary('orphan', sid('missing'), 'subagent', true)
    const cycleA = summary('cycle-a', sid('cycle-b'), 'subagent')
    const cycleB = summary('cycle-b', sid('cycle-a'), 'subagent')

    const result = index(owner, child, fork, forkChild, orphan, cycleA, cycleB)
    expect(result.get(owner.id)).toEqual({ count: 1, runningCount: 1 })
    expect(result.get(fork.id)).toEqual({ count: 1, runningCount: 1 })
    expect(result.get(sid('missing'))).toEqual({ count: 1, runningCount: 1 })
    expect(result.get(cycleA.id)).toEqual({ count: 2, runningCount: 0 })
    expect(result.get(cycleB.id)).toEqual({ count: 2, runningCount: 0 })
  })
})
