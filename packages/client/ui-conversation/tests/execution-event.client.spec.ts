// Execution event derivation: normalized timeline events from final Chat
// nodes. Pure function tests — no rendering machinery.

import { describe, expect, it } from 'vitest'
import type {
  AssistantMessageNode, CommandNode, CompactionSummaryNode, ModelRetryNode, RunningToolCall,
  ToolResultNode, TurnErrorNode, TurnMaxTokensNode, UserMessageNode,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { ChatConversationViewNode } from '@deepseek-ai/dsh-client-runtime/client'
import type { ChatNode } from '../src/client/contract/chat-nodes.ts'
import { executionEventFromNode, isDefaultExpanded } from '../src/client/execution/execution-event.ts'
import { executionTypeLabel } from '../src/client/execution/execution-labels.ts'

const asChatNode = (node: ChatConversationViewNode): ChatNode => node as ChatNode

function settled(key: string, seq: number, node: ChatConversationViewNode['data']): ChatConversationViewNode {
  return {
    key, id: String(seq), target: 'chat', kind: 'tool-call', anchorSeq: seq,
    location: { kind: 'session' }, visibility: 'visible', data: node,
  }
}

const userNode = (text: string): ChatConversationViewNode => ({
  key: 'k:user', id: '1', target: 'chat', kind: 'user', anchorSeq: 1,
  location: { kind: 'session' }, visibility: 'visible',
  data: {
    kind: 'user', seq: 1, time: 1_000,
    content: [{ type: 'text', text }] as never, source: null,
  } satisfies UserMessageNode,
})

const assistantNode = (blocks: AssistantMessageNode['blocks'], seq = 2, status: 'settled' | 'interrupted' = 'settled'): ChatConversationViewNode => ({
  key: `k:assistant:${seq}`, id: String(seq), target: 'chat', kind: 'assistant-step', anchorSeq: seq,
  location: { kind: 'session' }, visibility: 'visible',
  data: {
    status, turn: 1, step: 1, blocks, time: seq * 1_000,
    ...status === 'settled'
      ? { finalNode: { kind: 'assistant', seq, time: seq * 1_000, turn: 1, step: 1, blocks } as AssistantMessageNode }
      : {},
  },
})

const runningBash = (callId: string, seq = 3): RunningToolCall => ({
  callId, name: 'bash', argsRaw: '{"command":"npm test"}', turn: 1, step: 2, time: seq * 1_000,
  callView: null, subCalls: [],
})

const settledEdit = (callId: string, seq = 4): ToolResultNode => ({
  kind: 'tool-result', seq, time: seq * 1_000 + 40, callId,
  call: { name: 'edit', argsRaw: '{"path":"src/auth/login.ts"}' }, callTime: seq * 1_000,
  content: [{ type: 'text', text: 'updated' }] as never, isError: false,
  callView: {
    card: 'diff',
    title: 'Edit',
    diffs: [{ path: 'src/auth/login.ts', oldText: 'a\nb', newText: 'a\nb\nc' }],
  },
  resultView: null, subCalls: [],
})

describe('executionEventFromNode', () => {
  it('projects a user message as a message event with its first line', () => {
    const event = executionEventFromNode(asChatNode(userNode('Fix the auth bug')))
    expect(event).toMatchObject({
      kind: 'user', category: 'message', type: 'user_message', status: 'info',
      title: 'Fix the auth bug', time: 1_000,
    })
  })

  it('classifies a reasoning-only assistant step as thinking', () => {
    const node = assistantNode([{ kind: 'reasoning', text: 'Check JWT middleware first' }])
    const event = executionEventFromNode(asChatNode(node))
    expect(event).toMatchObject({ category: 'agent', type: 'thinking', status: 'success' })
    expect(event.description).toBe('Check JWT middleware first')
  })

  it('classifies a text assistant step as analysis with a truncated headline', () => {
    const long = `line one\n${'x'.repeat(500)}`
    const event = executionEventFromNode(asChatNode(assistantNode([{ kind: 'text', text: long }])))
    expect(event).toMatchObject({ category: 'agent', type: 'analysis', status: 'success' })
    expect(event.title.startsWith('line one')).toBe(true)
    expect(event.title.length).toBeLessThanOrEqual(141)
  })

  it('maps a running bash call to a running terminal command with the command line', () => {
    const node = settled('k:bash', 3, { root: runningBash('c1') })
    const event = executionEventFromNode(asChatNode(node))
    expect(event).toMatchObject({
      category: 'terminal', type: 'command', status: 'running',
      title: 'bash', description: 'npm test', toolName: 'bash',
    })
    expect(event.durationMs).toBeUndefined()
  })

  it('maps a settled edit to a file edit with path, counts, and duration', () => {
    const node = settled('k:edit', 4, { root: settledEdit('c2') })
    const event = executionEventFromNode(asChatNode(node))
    expect(event).toMatchObject({
      category: 'files', type: 'file_edit', status: 'success',
      title: 'edit', filePath: 'src/auth/login.ts', additions: 3, deletions: 2,
      durationMs: 40,
    })
  })

  it('flags a settled error result as tool_error with the error status', () => {
    const result: ToolResultNode = {
      ...settledEdit('c3', 5), isError: true,
      error: { name: 'Failed', code: 'E_FAIL' }, call: { name: 'some_tool', argsRaw: '{}' },
    }
    const event = executionEventFromNode(asChatNode(settled('k:err', 5, { root: result })))
    expect(event).toMatchObject({ category: 'tools', type: 'tool_error', status: 'error' })
  })

  it('projects a command lifecycle with its outcome status', () => {
    const command: CommandNode = {
      kind: 'command', seq: 6, time: 6_000, commandId: 'cmd1' as CommandNode['commandId'],
      name: 'plan', args: 'do the thing', outcome: { kind: 'success', text: 'ok' },
    }
    const event = executionEventFromNode(asChatNode({
      key: 'k:cmd', id: '6', target: 'chat', kind: 'command', anchorSeq: 6,
      location: { kind: 'session' }, visibility: 'visible', data: command,
    }))
    expect(event).toMatchObject({
      category: 'terminal', type: 'command', status: 'success',
      title: 'plan', description: 'do the thing',
    })
  })

  it('projects turn failures, retries, compaction, and completion markers', () => {
    const turnError = executionEventFromNode(asChatNode({
      key: 'k:err', id: '7', target: 'chat', kind: 'turn-error', anchorSeq: 7,
      location: { kind: 'session' }, visibility: 'visible',
      data: { kind: 'turn-error', seq: 7, time: 7_000, turn: 1, step: 1, message: 'npm test failed', code: 'E1' } satisfies TurnErrorNode,
    }))
    expect(turnError).toMatchObject({ type: 'task_failed', status: 'error', title: 'npm test failed' })

    const retry: ModelRetryNode = {
      kind: 'model-retry', retryId: 'r' as ModelRetryNode['retryId'], seq: 8, time: 8_000,
      turn: 1, step: 1, retry: 2, retryState: 'scheduled',
      provider: 'mock', mode: 'normal', policyKey: 'mock-normal',
      maxRetries: 3, delayMs: 450,
      failure: { code: 'TRANSPORT', message: 'reset' },
    }
    const retryEvent = executionEventFromNode(asChatNode({
      key: 'k:retry', id: '8', target: 'chat', kind: 'model-retry', anchorSeq: 8,
      location: { kind: 'session' }, visibility: 'visible',
      data: { attempts: [retry], current: retry },
    }))
    expect(retryEvent).toMatchObject({ type: 'warning', status: 'warning', description: 'retry 2' })

    const compaction: CompactionSummaryNode = {
      kind: 'compaction', seq: 9, time: 9_000, summary: 'older context shadowed',
      summaryEventSeq: 9, shadowedItemCount: 3, shadowedTokenCount: 100,
    }
    const compactionEvent = executionEventFromNode(asChatNode({
      key: 'k:compact', id: '9', target: 'chat', kind: 'compaction', anchorSeq: 9,
      location: { kind: 'session' }, visibility: 'visible', data: compaction,
    }))
    expect(compactionEvent).toMatchObject({ type: 'task_progress', title: 'Compaction' })
    expect(compactionEvent.description).toBe('older context shadowed')

    const maxTokens = executionEventFromNode(asChatNode({
      key: 'k:max', id: '10', target: 'chat', kind: 'turn-max-tokens', anchorSeq: 10,
      location: { kind: 'session' }, visibility: 'visible',
      data: { kind: 'turn-max-tokens', seq: 10, time: 10_000, turn: 1, step: 1 } satisfies TurnMaxTokensNode,
    }))
    expect(maxTokens).toMatchObject({ type: 'warning', status: 'warning' })
  })

  it('derives a turn completion marker with the closing duration', () => {
    const event = executionEventFromNode(asChatNode({
      key: 'k:tail', id: '11', target: 'chat', kind: 'turn-tail', anchorSeq: 11,
      location: { kind: 'session' }, visibility: 'visible',
      data: {
        turn: 1, seq: 11, time: 11_000, closing: null, branchUnavailable: true,
      },
    }))
    expect(event).toMatchObject({ type: 'task_completed', status: 'success', title: 'Turn 1 complete' })
  })
})

describe('isDefaultExpanded', () => {
  it('expands prose rows and folds technical rows by default', () => {
    expect(isDefaultExpanded('user')).toBe(true)
    expect(isDefaultExpanded('assistant-step')).toBe(true)
    expect(isDefaultExpanded('command')).toBe(true)
    expect(isDefaultExpanded('tool-call')).toBe(false)
    expect(isDefaultExpanded('turn-tail')).toBe(false)
    expect(isDefaultExpanded('unknown-kind')).toBe(false)
  })
})

describe('executionTypeLabel', () => {
  it('labels every trace type', () => {
    expect(executionTypeLabel('tool_call')).toBe('Tool call')
    expect(executionTypeLabel('file_edit')).toBe('File edit')
    expect(executionTypeLabel('task_completed')).toBe('Completed')
    expect(executionTypeLabel('user_message')).toBe('User')
  })
})
