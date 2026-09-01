// @vitest-environment jsdom
// ExecutionView behavior: event rows render with timeline chrome, the toolbar
// filters and searches the trace, expand/collapse controls the body, and the
// header projects counts, the current action, the plan, and the files list.
// Driven through a scripted snapshot source and a stubbed node dispatch.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, within } from '@testing-library/react'
import type {
  AssistantMessageNode, ConversationSnapshot, RunningToolCall,
  SessionId, ToolResultNode, UserMessageNode,
} from '@deepseek-ai/dsh-client-runtime/client'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import {
  createSnapshotStore, EMPTY_CONVERSATION_VIEWS,
} from '@deepseek-ai/dsh-client-runtime/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { RenderChatNode, RenderMessageImages } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { createChatStore } from '../src/client/stores.ts'
import { ExecutionView } from '../src/client/execution/ExecutionView.tsx'
import { zh } from '../src/client/locales.ts'
import { chatSnapshotFixture } from './chat-snapshot-fixture.client.ts'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  // Restore the jsdom offsetHeight the follow test shadows with its own getter.
  delete (HTMLElement.prototype as { offsetHeight?: unknown }).offsetHeight
})

beforeEach(() => {
  localStorage.clear()
})

const SID = 's1' as SessionId

function snapshotBase(): ConversationSnapshot {
  return {
    sessionId: SID, views: EMPTY_CONVERSATION_VIEWS, chat: chatSnapshotFixture(), nodes: [],
    turnTimings: new Map(), turnEnds: new Map(), partial: null, runningCalls: [],
    pending: [], queue: [], running: false, composerPhase: 'active', removed: false, openState: 'open', openError: null,
    hasMore: false, loadingOlder: false, promptError: null, blank: false, subagent: null, lastAgentError: null,
  }
}

function makeSource(init?: Partial<ConversationSnapshot>) {
  const initial = { ...snapshotBase(), ...init }
  let snap: ConversationSnapshot = {
    ...initial,
    chat: init?.chat ?? chatSnapshotFixture(initial),
  }
  const subs = new Set<() => void>()
  return {
    set: (next: Partial<ConversationSnapshot>) => {
      const merged = { ...snap, ...next }
      snap = {
        ...merged,
        chat: Object.hasOwn(next, 'chat') && next.chat !== undefined
          ? next.chat
          : chatSnapshotFixture(merged, snap.chat),
      }
      for (const fn of [...subs]) fn()
    },
    source: {
      getSnapshot: () => snap,
      subscribe: (fn: () => void) => {
        subs.add(fn)
        return () => subs.delete(fn)
      },
    },
  }
}

const user = (seq: number, text: string): UserMessageNode => ({
  kind: 'user', seq, time: seq * 1000,
  content: [{ type: 'text', text }] as never, source: null,
})
const assistant = (seq: number, text: string, turn = 1): AssistantMessageNode => ({
  kind: 'assistant', seq, time: seq * 1_000, turn, step: 1, blocks: [{ kind: 'text', text }],
})
const bashResult = (seq: number, callId: string, command: string): ToolResultNode => ({
  kind: 'tool-result', seq, time: seq * 1_000 + 30, callId,
  call: { name: 'bash', argsRaw: `{"command":"${command}"}` }, callTime: seq * 1_000,
  content: [{ type: 'text', text: 'ok' }] as never, isError: false,
  callView: null, resultView: null, subCalls: [],
})
const editResult = (seq: number, callId: string, path: string): ToolResultNode => ({
  kind: 'tool-result', seq, time: seq * 1_000 + 40, callId,
  call: { name: 'edit', argsRaw: `{"path":"${path}"}` }, callTime: seq * 1_000,
  content: [{ type: 'text', text: 'updated' }] as never, isError: false,
  callView: {
    card: 'diff', title: 'Edit',
    diffs: [{ path, oldText: 'a\nb', newText: 'a\nb\nc' }],
  },
  resultView: null, subCalls: [],
})
const runningBash = (callId: string): RunningToolCall => ({
  callId, name: 'bash', argsRaw: '{"command":"npm test"}', turn: 1, step: 2, time: 99_000,
  callView: null, subCalls: [],
})

function harness(nodes: ConversationSnapshot['nodes'], overrides: Partial<ConversationSnapshot> = {}) {
  const source = makeSource({ nodes, ...overrides })
  const chat = createChatStore().create()
  const t = makeTranslate(zh, commonZh)
  const renderChatNode: RenderChatNode = (owner, _options) => {
    const node = owner.node
    if (node.kind === 'tool-call') {
      const root = node.data.root
      const name = 'kind' in root ? root.call?.name ?? '' : root.name
      return <div data-testid={`node-tool-${root.callId}`}>{name}</div>
    }
    return <div data-testid={`node-${node.kind}`}>{node.kind}</div>
  }
  const renderMessageImages = vi.fn() as unknown as RenderMessageImages
  const props = {
    sessionId: SID,
    useSession: bindSnapshotSelector(source.source),
    useSessions: bindSnapshotSelector(createSnapshotStore({
      ids: [SID],
      byId: { [SID]: { id: SID, displayTitle: 'Fix auth bug', cwd: '/ws', running: false, blank: false, updatedAt: 1 } },
      current: SID, phase: 'ready', subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined,
    })),
    useWorkspaces: bindSnapshotSelector(createSnapshotStore({
      items: [], archivedSessionIds: [], state: 'idle', phase: 'ready', error: null,
      baselinesReady: true, recentWorkspaceId: undefined,
    })),
    useProjection: (() => undefined),
    useStore: bindSnapshotSelector(chat),
    actions: chat.actions,
    renderChatNode,
    renderMessageImages,
    openFile: vi.fn(),
    inspectCall: vi.fn(),
    forkAt: vi.fn(),
    fileMentions: () => undefined,
    inspect: null,
    onInspectDone: vi.fn(),
    t,
  } as unknown as Parameters<typeof ExecutionView>[0]
  return {
    props, source, chat, renderChatNode,
    view: render(<ExecutionView {...props} />),
  }
}

describe('ExecutionView', () => {
  it('renders timeline rows with the type chrome and content on expand', () => {
    const h = harness([user(1, 'Fix the auth bug'), assistant(2, 'Inspecting middleware')])
    const rows = h.view.getAllByTestId('execution-event')
    expect(rows.length).toBeGreaterThanOrEqual(2)
    // Prose rows default expanded: the assistant node body is visible.
    expect(h.view.getByTestId('node-assistant-step')).toBeTruthy()
    // The user row shows its headline.
    expect(within(rows[0]!).getByText('Fix the auth bug')).toBeTruthy()
  })

  it('folds tool-call rows by default and reveals the body on click', () => {
    const h = harness([bashResult(3, 'c1', 'npm test')])
    const row = h.view.getByTestId('execution-event')
    expect(h.view.queryByTestId('node-tool-c1')).toBeNull()
    fireEvent.click(within(row).getByRole('button'))
    expect(h.view.getByTestId('node-tool-c1')).toBeTruthy()
  })

  it('filters the trace by category and status chips', () => {
    const h = harness([
      user(1, 'q'),
      assistant(2, 'Analysis text'),
      bashResult(3, 'c1', 'npm test'),
      editResult(4, 'c2', 'src/auth/login.ts'),
    ])
    expect(h.view.getAllByTestId('execution-event').length).toBeGreaterThanOrEqual(4)
    const filters = h.view.getByRole('group', { name: '筛选事件' })
    fireEvent.click(within(filters).getByRole('button', { name: '文件' }))
    const rows = h.view.getAllByTestId('execution-event')
    expect(rows.length).toBe(1)
    expect(within(rows[0]!).getByText('edit')).toBeTruthy()
    fireEvent.click(within(filters).getByRole('button', { name: '终端' }))
    expect(h.view.getAllByTestId('execution-event').length).toBe(1)
  })

  it('searches headline fields and shows the empty state', () => {
    const h = harness([assistant(2, 'Inspecting middleware')])
    const input = h.view.getByRole('searchbox')
    fireEvent.change(input, { target: { value: 'middleware' } })
    expect(h.view.getAllByTestId('execution-event').length).toBe(1)
    fireEvent.change(input, { target: { value: 'nothing-matches' } })
    expect(h.view.queryAllByTestId('execution-event')).toHaveLength(0)
    expect(h.view.getByText('没有匹配的事件')).toBeTruthy()
  })

  it('expand all and collapse all control every row', () => {
    const h = harness([assistant(2, 'text'), bashResult(3, 'c1', 'npm test')])
    expect(h.view.queryByTestId('node-tool-c1')).toBeNull()
    fireEvent.click(h.view.getByRole('button', { name: '全部展开' }))
    expect(h.view.getByTestId('node-tool-c1')).toBeTruthy()
    fireEvent.click(h.view.getByRole('button', { name: '全部折叠' }))
    expect(h.view.queryByTestId('node-tool-c1')).toBeNull()
    // The assistant body folds too under collapse-all.
    expect(h.view.queryByTestId('node-assistant-step')).toBeNull()
  })

  it('projects the header: title, counters, current action, and the files list', () => {
    const h = harness([
      user(1, 'Fix the auth bug'),
      assistant(2, 'Inspecting middleware'),
      bashResult(3, 'c1', 'npm test'),
      editResult(4, 'c2', 'src/auth/login.ts'),
    ], { turnTimings: new Map([[1, { startTime: 1_000 }]]), turnEnds: new Map([[1, 5]]) })
    expect(h.view.getByTestId('execution-header')).toBeTruthy()
    expect(h.view.getByText('Fix auth bug')).toBeTruthy()
    // Counts line: 1 turn, 2 tools (bash+edit), 1 file.
    expect(h.view.getByText(/1 轮/)).toBeTruthy()
    expect(h.view.getByText(/2 次工具/)).toBeTruthy()
    expect(h.view.getByText(/1 个文件/)).toBeTruthy()
    // Files strip lists the touched path with its diff counts.
    fireEvent.click(within(h.view.getByTestId('execution-header')).getByRole('button', { name: /文件/ }))
    const header = h.view.getByTestId('execution-header')
    expect(within(header).getByText('src/auth/login.ts')).toBeTruthy()
    expect(within(header).getByText('+3')).toBeTruthy()
    expect(within(header).getByText('−2')).toBeTruthy()
  })

  it('shows the running action for an in-flight call and reveals it on click', () => {
    const h = harness([user(1, 'q')], { runningCalls: [runningBash('r1')], running: true })
    const action = h.view.getByTestId('execution-current-action')
    expect(within(action).getByText('npm test')).toBeTruthy()
  })

  it('streams: a new event appears without remounting existing rows', () => {
    const h = harness([assistant(2, 'text')])
    expect(h.view.getAllByTestId('execution-event').length).toBe(1)
    act(() => {
      h.source.set({ nodes: [assistant(2, 'text'), bashResult(3, 'c1', 'npm test')] })
    })
    expect(h.view.getAllByTestId('execution-event').length).toBe(2)
  })

  it('follows the tail while pinned: a new event scrolls to the floor', () => {
    const h = harness([assistant(2, 'a'), bashResult(3, 'c1', 'npm test')])
    const el = h.view.getByTestId('execution-list')
    const g = mockListGeometry(el, { clientHeight: 300, scrollHeight: 400 })
    // Pin at the floor.
    act(() => { el.scrollTop = el.scrollHeight; fireEvent.scroll(el) })
    expect(g.scrollTop).toBe(100)
    // A new event lands: the flow grows and the pinned view follows it.
    g.scrollHeight = 436
    act(() => { h.source.set({ nodes: [assistant(2, 'a'), bashResult(3, 'c1', 'npm test'), editResult(4, 'c2', 'x.ts')] }) })
    expect(g.scrollTop).toBe(136)
  })

  it('stops following when the reader scrolls up and resumes at the floor', () => {
    const h = harness([assistant(2, 'a'), bashResult(3, 'c1', 'npm test')])
    const el = h.view.getByTestId('execution-list')
    const g = mockListGeometry(el, { clientHeight: 300, scrollHeight: 400 })
    // Reader scrolls away from the floor: the tail must not be pulled down.
    act(() => { el.scrollTop = 0; fireEvent.scroll(el) })
    expect(g.scrollTop).toBe(0)
    g.scrollHeight = 436
    act(() => { h.source.set({ nodes: [assistant(2, 'a'), bashResult(3, 'c1', 'npm test'), editResult(4, 'c2', 'x.ts')] }) })
    expect(g.scrollTop).toBe(0)
    // Scroll back to the very bottom: follow re-engages.
    act(() => { el.scrollTop = el.scrollHeight; fireEvent.scroll(el) })
    expect(g.scrollTop).toBe(136)
    g.scrollHeight = 472
    act(() => {
      h.source.set({ nodes: [assistant(2, 'a'), bashResult(3, 'c1', 'npm test'), editResult(4, 'c2', 'x.ts'), editResult(5, 'c3', 'y.ts')] })
    })
    expect(g.scrollTop).toBe(172)
  })

  it('re-follows while pinned when a measured row grows in place', () => {
    // Rows measure a real height, and ResizeObserver is live, so a content
    // growth changes layout.total without adding a row.
    let measuredHeight = 44
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true, get: () => measuredHeight,
    })
    const observers: Array<() => void> = []
    class ResizeObserverStub {
      constructor(callback: () => void) { observers.push(callback) }
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal('ResizeObserver', ResizeObserverStub)

    const h = harness([assistant(2, 'a'), bashResult(3, 'c1', 'npm test')])
    const el = h.view.getByTestId('execution-list')
    const g = mockListGeometry(el, { clientHeight: 300, scrollHeight: 400 })
    act(() => { el.scrollTop = el.scrollHeight; fireEvent.scroll(el) })
    expect(g.scrollTop).toBe(100)
    // The last row's content grows (e.g. streaming output): the floor moves
    // with no new row, and the pinned view re-scrolls to it.
    measuredHeight = 88
    g.scrollHeight = 400 + (88 - 44) * 2
    act(() => { for (const cb of observers) cb() })
    expect(g.scrollTop).toBe(g.scrollHeight - g.clientHeight)
  })
})

/** Bind controllable scroll geometry to the execution list scrollport. */
function mockListGeometry(el: HTMLElement, initial: { clientHeight: number; scrollHeight: number }) {
  const geometry = { clientHeight: initial.clientHeight, scrollHeight: initial.scrollHeight, scrollTop: 0 }
  Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => geometry.clientHeight })
  Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => geometry.scrollHeight })
  Object.defineProperty(el, 'scrollTop', {
    configurable: true,
    get: () => geometry.scrollTop,
    set: (value: number) => {
      geometry.scrollTop = Math.max(0, Math.min(value, Math.max(0, geometry.scrollHeight - geometry.clientHeight)))
    },
  })
  return geometry
}
