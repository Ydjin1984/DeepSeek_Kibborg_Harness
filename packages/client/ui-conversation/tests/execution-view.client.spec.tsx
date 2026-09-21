// @vitest-environment jsdom
// ExecutionView behavior: event rows render with timeline chrome, the toolbar
// filters and searches the trace, expand/collapse controls the body, and the
// header projects counts, the current action, the plan, and the files list.
// Driven through a scripted snapshot source and a stubbed node dispatch.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, within } from '@testing-library/react'
import type {
  AssistantMessageNode, ConversationSnapshot, RunningToolCall,
  SessionId, SessionListState, SessionSummary, ToolResultNode, UserMessageNode,
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
import { conversationActivityFixture } from './conversation-activity-fixture.client.ts'

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
const sid = (id: string) => id as SessionId

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
const runningExecutor = (callId: string): RunningToolCall => ({
  callId, name: 'executor', argsRaw: '{}', turn: 1, step: 2, time: 99_000,
  callView: null, subCalls: [],
})
const executorResult = (seq: number, callId: string): ToolResultNode => ({
  kind: 'tool-result', seq, time: seq * 1_000 + 30, callId,
  call: { name: 'executor', argsRaw: '{}' }, callTime: seq * 1_000,
  content: [{ type: 'text', text: 'ok' }] as never, isError: false,
  callView: null, resultView: null, subCalls: [],
})

function listState(children: SessionSummary[] = [], catalogLabels: string[] = []): SessionListState {
  return {
    ids: [SID, ...children.map(item => item.id)],
    byId: {
      [SID]: { id: SID, displayTitle: 'Fix auth bug', cwd: '/ws', running: false, blank: false, updatedAt: 1 },
      ...Object.fromEntries(children.map(item => [item.id, item])),
    },
    current: SID, phase: 'ready',
    subagentsByParent: {
      [SID]: {
        state: 'ready', error: null, parentAvailable: true,
        entries: catalogLabels.map((label, index) => ({
          kind: 'child', id: children[index]!.id, activity: 'running',
          hasChildren: false, mode: 'one-shot', label,
        })),
      },
    },
    jobsBySession: {}, currentAddress: undefined,
  }
}

/** One running direct child summary for the owning session. */
function runningChild(id: string, label: string, detail: string): SessionSummary {
  return {
    id: sid(id), displayTitle: id, running: true, blank: false, updatedAt: 1,
    parentId: SID, origin: 'subagent',
    projectionValues: {
      subagent: { mode: 'one-shot', label, seq: 1 },
      subagentActivity: { status: 'running', detail },
    } as unknown as NonNullable<SessionSummary['projectionValues']>,
  }
}

/** One settled direct child summary (activity folded back to idle). */
function settledChild(id: string, label: string): SessionSummary {
  return {
    id: sid(id), displayTitle: id, running: false, blank: false, updatedAt: 1,
    parentId: SID, origin: 'subagent',
    projectionValues: {
      subagent: { mode: 'one-shot', label, seq: 1 },
      subagentActivity: { status: 'idle', detail: '' },
    } as unknown as NonNullable<SessionSummary['projectionValues']>,
  }
}

function harness(nodes: ConversationSnapshot['nodes'], overrides: Partial<ConversationSnapshot> = {}, list?: SessionListState) {
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
    useSessions: bindSnapshotSelector(createSnapshotStore(list ?? listState())),
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
    loadOlder: vi.fn(),
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
  it('exposes paging from the execution tab when the loaded tail has no user request', () => {
    const h = harness([bashResult(3, 'c1', 'npm test')], { hasMore: true })
    fireEvent.click(h.view.getByRole('button', { name: '加载更早' }))
    expect(h.props.loadOlder).toHaveBeenCalledOnce()
    expect(h.view.getByRole('navigation', { name: '按请求导航' })).toBeTruthy()
  })

  it('waits for an explicit paging action when the loaded execution tail has only one row', () => {
    const h = harness([bashResult(3, 'c1', 'npm test')], { hasMore: true })
    expect(h.props.loadOlder).not.toHaveBeenCalled()
  })

  it.each([1_000, 5_000])('mounts a bounded event window for %i activity events', (count) => {
    const h = harness(conversationActivityFixture(count).nodes)
    expect(h.view.container.querySelectorAll('[data-execution-row-key]').length).toBeLessThanOrEqual(120)
    expect(h.view.container.querySelectorAll('[data-prompt-tick]').length).toBeLessThanOrEqual(9)
    expect(h.view.getByTestId('execution-list').scrollHeight).toBeGreaterThanOrEqual(0)
  })

  it('keeps prose rows compact until the reader expands one', () => {
    const h = harness([user(1, 'Fix the auth bug'), assistant(2, 'Inspecting middleware')])
    const rows = h.view.getAllByTestId('execution-event')
    expect(rows.length).toBeGreaterThanOrEqual(2)
    expect(h.view.queryByTestId('node-assistant-step')).toBeNull()
    // The user row shows its headline.
    expect(within(rows[0]!).getByText('Fix the auth bug')).toBeTruthy()
    fireEvent.click(within(rows[1]!).getByRole('button'))
    expect(h.view.getByTestId('node-assistant-step')).toBeTruthy()
  })

  it('folds tool-call rows by default and reveals the body on click', () => {
    const h = harness([bashResult(3, 'c1', 'npm test')])
    const row = h.view.getByTestId('execution-event')
    expect(h.view.queryByTestId('node-tool-c1')).toBeNull()
    fireEvent.click(within(row).getByRole('button'))
    expect(h.view.getByTestId('node-tool-c1')).toBeTruthy()
  })

  it('opens the recorded file action inline when its path is clicked', () => {
    const h = harness([editResult(4, 'edit-file', 'src/activity.ts')])
    const row = h.view.getByTestId('execution-event')
    expect(row.querySelector('[data-file-path]')?.textContent).toBe('src/activity.ts')
    const file = within(row).getByRole('button', { name: 'src/activity.ts' })
    expect(file.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(file)
    expect(row.querySelector('[data-testid="node-tool-edit-file"]')).not.toBeNull()
    expect(file.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(file)
    expect(row.querySelector('[data-testid="node-tool-edit-file"]')).toBeNull()
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
    // The assistant body remains folded under collapse-all.
    expect(h.view.queryByTestId('node-assistant-step')).toBeNull()
  })

  it('an individual toggle cancels expand-all and closes its row', () => {
    const h = harness([assistant(2, 'text'), bashResult(3, 'c1', 'npm test')])
    fireEvent.click(h.view.getByRole('button', { name: '全部展开' }))
    expect(h.view.getByTestId('node-tool-c1')).toBeTruthy()
    const toolRow = h.view.getAllByTestId('execution-event')[1]!
    fireEvent.click(within(toolRow).getByRole('button'))
    expect(h.view.queryByTestId('node-tool-c1')).toBeNull()
    expect(h.view.queryByTestId('node-assistant-step')).toBeNull()
  })

  it('persists the expand-all / collapse-all mode in the shared store', () => {
    const h = harness([bashResult(3, 'c1', 'npm test')])
    fireEvent.click(h.view.getByRole('button', { name: '全部展开' }))
    expect(h.chat.getSnapshot().executionExpand).toBe('expand')
    fireEvent.click(h.view.getByRole('button', { name: '全部折叠' }))
    expect(h.chat.getSnapshot().executionExpand).toBe('collapse')
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
    expect(within(h.view.getByTestId('execution-header')).getByText(/1 轮/)).toBeTruthy()
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
    act(() => { fireEvent.wheel(el, { deltaY: -1 }); el.scrollTop = 95; fireEvent.scroll(el) })
    expect(g.scrollTop).toBe(95)
    g.scrollHeight = 436
    act(() => { h.source.set({ nodes: [assistant(2, 'a'), bashResult(3, 'c1', 'npm test'), editResult(4, 'c2', 'x.ts')] }) })
    expect(g.scrollTop).toBe(95)
    // Scroll back to the very bottom: follow re-engages.
    act(() => { fireEvent.wheel(el, { deltaY: 40 }); el.scrollTop = el.scrollHeight; fireEvent.scroll(el) })
    expect(g.scrollTop).toBe(136)
    g.scrollHeight = 472
    act(() => {
      h.source.set({ nodes: [assistant(2, 'a'), bashResult(3, 'c1', 'npm test'), editResult(4, 'c2', 'x.ts'), editResult(5, 'c3', 'y.ts')] })
    })
    expect(g.scrollTop).toBe(172)
  })

  it('ignores a programmatic scroll event and lets a reader interrupt a smooth jump', () => {
    const h = harness([assistant(2, 'a'), bashResult(3, 'c1', 'npm test')])
    const el = h.view.getByTestId('execution-list')
    const g = mockListGeometry(el, { clientHeight: 300, scrollHeight: 400 })
    act(() => { el.scrollTop = 0; fireEvent.scroll(el) })
    g.scrollHeight = 436
    act(() => { h.source.set({ nodes: [assistant(2, 'a'), bashResult(3, 'c1', 'npm test'), editResult(4, 'c2', 'x.ts')] }) })
    expect(g.scrollTop).toBe(136)

    act(() => { fireEvent.wheel(el, { deltaY: -1 }); el.scrollTop = 131; fireEvent.scroll(el) })
    const scrollTo = vi.fn()
    el.scrollTo = scrollTo
    fireEvent.click(h.view.getByRole('button', { name: h.props.t('execution.jumpLatest') }))
    expect(scrollTo).toHaveBeenCalledWith({ top: 436, behavior: 'smooth' })
    act(() => { fireEvent.wheel(el, { deltaY: -1 }); fireEvent.scroll(el) })
    g.scrollHeight = 472
    act(() => { h.source.set({ nodes: [assistant(2, 'a'), bashResult(3, 'c1', 'npm test'), editResult(4, 'c2', 'x.ts'), editResult(5, 'c3', 'y.ts')] }) })
    expect(g.scrollTop).toBe(131)
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

  it('shows the live child strip under a running executor call header', () => {
    const h = harness([], { runningCalls: [runningExecutor('d1')], running: true },
      listState([runningChild('kid-1', 'Recon', 'grep')], ['Recon']))
    expect(h.view.container.querySelector('[data-subagent-activity]')?.textContent).toBe('子智能体 Recon：grep')
  })

  it('falls back to the plain running label before the child detail lands', () => {
    const h = harness([], { runningCalls: [runningExecutor('d1')], running: true },
      listState([runningChild('kid-1', 'Recon', '')], ['Recon']))
    expect(h.view.container.querySelector('[data-subagent-activity]')?.textContent).toBe('子智能体 Recon 正在执行…')
  })

  it('keeps the child strip only while the delegation row stays collapsed', () => {
    const h = harness([], { runningCalls: [runningExecutor('d1')], running: true },
      listState([runningChild('kid-1', 'Recon', 'grep')], ['Recon']))
    const row = h.view.getByTestId('execution-event')
    expect(h.view.container.querySelector('[data-subagent-activity]')).toBeTruthy()
    fireEvent.click(within(row).getByRole('button'))
    expect(h.view.container.querySelector('[data-subagent-activity]')).toBeNull()
  })

  it('shows a completed subagent row after a delegation call settles', () => {
    const h = harness([executorResult(3, 'd2')], {}, listState([settledChild('kid-2', 'Recon')], ['Recon']))
    expect(h.view.container.querySelector('[data-subagent-activity]')?.textContent).toBe('子智能体 Recon 已完成')
  })

  it('shows no child strip without children or for non-delegation calls', () => {
    const children = listState([runningChild('kid-1', 'Recon', 'grep')], ['Recon'])
    const empty = harness([], { runningCalls: [runningExecutor('d1')], running: true }, listState())
    expect(empty.view.container.querySelector('[data-subagent-activity]')).toBeNull()
    const bash = harness([], { runningCalls: [runningBash('b1')], running: true }, children)
    expect(bash.view.container.querySelector('[data-subagent-activity]')).toBeNull()
    // A settled delegation call keeps naming its children (running in the
    // background or already completed) so the trace shows which subagent did what.
    const settled = harness([executorResult(3, 'd2')], {}, children)
    expect(settled.view.container.querySelector('[data-subagent-activity]')?.textContent).toBe('子智能体 Recon：grep')
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
