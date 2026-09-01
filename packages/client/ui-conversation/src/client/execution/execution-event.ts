/**
 * Execution event model: the normalized AgentEvent the Execution view
 * projects from final Chat nodes. One timeline row per Chat node — the
 * presentation layer reuses the conversation engine's folded business nodes
 * instead of re-deriving raw session events, so the trace stays in lockstep
 * with the chat flow and the existing specialized renderers keep ownership
 * of every payload. Pure derivation: `executionEventFromNode` is a function
 * of one final node, cache-stable and replayable.
 * @module
 */

import type { ContentBlock } from '@deepseek-ai/dsh-llm/types'
import type { AssistantBlock, ToolCallBlock } from '@deepseek-ai/dsh-client-runtime/client'
import type { ChatNode } from '../contract/chat-nodes.ts'

/** One timeline event's visual status, mapped from the node lifecycle. */
export type ExecutionEventStatus = 'running' | 'success' | 'warning' | 'error' | 'info'

/** Coarse filter bucket an event belongs to (the toolbar filter chips). */
export type ExecutionEventCategory =
  | 'agent'
  | 'tools'
  | 'files'
  | 'terminal'
  | 'git'
  | 'code'
  | 'state'
  | 'message'

/** Display type label domain, following the trace taxonomy. */
export type ExecutionEventType =
  | 'thinking'
  | 'analysis'
  | 'planning'
  | 'decision'
  | 'observation'
  | 'file_read'
  | 'file_write'
  | 'file_edit'
  | 'file_create'
  | 'file_delete'
  | 'file_rename'
  | 'code'
  | 'diff'
  | 'tool_call'
  | 'tool_result'
  | 'tool_error'
  | 'command'
  | 'stdout'
  | 'stderr'
  | 'exit_code'
  | 'git_diff'
  | 'git_status'
  | 'git_commit'
  | 'git_branch'
  | 'task_started'
  | 'task_progress'
  | 'task_completed'
  | 'task_failed'
  | 'warning'
  | 'confirmation_required'
  | 'user_message'
  | 'context'

/**
 * One normalized execution-trace event. `key` is the owning Chat node's
 * stable context key, so the row can subscribe to its node and render it
 * through the shared `conversation.chat.node` seat.
 */
export interface ExecutionEvent {
  /** Stable Chat node context key (also the virtual-row identity). */
  readonly key: string
  /** Node anchor seq; ascending order equals trace order. */
  readonly seq: number
  /** Unix epoch ms of the anchoring event. */
  readonly time: number
  /** Owning Chat node renderer kind. */
  readonly kind: ChatNode['kind']
  readonly category: ExecutionEventCategory
  readonly type: ExecutionEventType
  readonly status: ExecutionEventStatus
  /** One-line headline for the timeline header. */
  readonly title: string
  /** One-line secondary summary (path, command, first result line). */
  readonly description: string
  /** Wire tool name for tool-backed events. */
  readonly toolName?: string
  /** Primary touched path for file/tool events. */
  readonly filePath?: string
  /** Summed added lines across the root call's diff hunks. */
  readonly additions?: number
  /** Summed removed lines across the root call's diff hunks. */
  readonly deletions?: number
  /** Settled call duration (result time minus call time). */
  readonly durationMs?: number
}

/** Default collapsed state of one event kind: heavy technical rows start folded. */
export function isDefaultExpanded(kind: string): boolean {
  switch (kind) {
    case 'user':
    case 'steering':
    case 'context':
    case 'assistant-step':
    case 'command':
      return true
    default:
      return false
  }
}

/** First non-empty line of a string, capped for one-line headers. */
function firstLine(text: string, max = 140): string {
  const line = text.split('\n')[0]?.trim() ?? ''
  if (line.length <= max) return line
  return `${line.slice(0, Math.max(0, max - 1))}…`
}

function firstTextBlock(blocks: readonly ContentBlock[]): string {
  for (const block of blocks) {
    if (block.type === 'text') {
      const text: unknown = (block as { text?: unknown }).text
      if (typeof text === 'string' && text.trim() !== '') return text
    }
  }
  return ''
}

function firstAssistantLine(blocks: readonly AssistantBlock[]): string {
  for (const block of blocks) {
    if (block.kind === 'text' && block.text.trim() !== '') return block.text
    if (block.kind === 'reasoning' && block.text.trim() !== '') return block.text
  }
  return ''
}

function firstReasoningLine(blocks: readonly AssistantBlock[]): string {
  for (const block of blocks) {
    if (block.kind === 'reasoning' && block.text.trim() !== '') return block.text
  }
  return ''
}

function hasText(blocks: readonly AssistantBlock[]): boolean {
  return blocks.some(block => block.kind === 'text' && block.text.trim() !== '')
}

/** Tool names whose payload is terminal output. */
const TERMINAL_TOOLS = new Set([
  'bash', 'pwsh', 'powershell', 'shell', 'sh', 'zsh', 'run_command', 'run_code', 'run', 'exec', 'execute', 'terminal',
])
/** Tool names that read a file or search the tree. */
const READ_TOOLS = new Set([
  'read', 'read_file', 'read_files', 'view_file', 'cat', 'grep', 'ripgrep', 'glob', 'search', 'find',
])
const WRITE_TOOLS = new Set(['write', 'write_file', 'append', 'append_file'])
const CREATE_TOOLS = new Set(['create', 'create_file', 'touch', 'new_file', 'mkdir'])
const EDIT_TOOLS = new Set([
  'edit', 'edit_file', 'apply_patch', 'patch', 'str_replace', 'str_replace_editor',
  'multi_edit', 'replace', 'update_file', 'rewrite',
])
const DELETE_TOOLS = new Set(['delete', 'delete_file', 'remove', 'rm', 'unlink'])
const RENAME_TOOLS = new Set(['rename', 'move', 'mv', 'file_rename', 'relocate'])
const PLAN_TOOLS = new Set(['todo_write', 'todo', 'update_todos', 'todos', 'plan', 'create_plan'])
const ASK_TOOLS = new Set(['ask_user', 'ask_question', 'ask', 'confirmation', 'confirm', 'user_question', 'question'])

/** Derive the trace type/category for a wire tool name. */
function toolEventType(name: string): { type: ExecutionEventType; category: ExecutionEventCategory } {
  if (TERMINAL_TOOLS.has(name)) return { type: 'command', category: 'terminal' }
  if (READ_TOOLS.has(name)) return { type: 'file_read', category: 'files' }
  if (CREATE_TOOLS.has(name)) return { type: 'file_create', category: 'files' }
  if (WRITE_TOOLS.has(name)) return { type: 'file_write', category: 'files' }
  if (EDIT_TOOLS.has(name)) return { type: 'file_edit', category: 'files' }
  if (DELETE_TOOLS.has(name)) return { type: 'file_delete', category: 'files' }
  if (RENAME_TOOLS.has(name)) return { type: 'file_rename', category: 'files' }
  if (PLAN_TOOLS.has(name)) return { type: 'planning', category: 'agent' }
  if (ASK_TOOLS.has(name)) return { type: 'confirmation_required', category: 'state' }
  if (name.startsWith('git')) {
    if (name.includes('diff')) return { type: 'git_diff', category: 'git' }
    if (name.includes('status')) return { type: 'git_status', category: 'git' }
    if (name.includes('commit')) return { type: 'git_commit', category: 'git' }
    if (name.includes('branch')) return { type: 'git_branch', category: 'git' }
    return { type: 'git_status', category: 'git' }
  }
  if (name.startsWith('diff')) return { type: 'diff', category: 'code' }
  return { type: 'tool_call', category: 'tools' }
}

/** Extract a touched path from a tool-call args JSON string. */
function argsPath(argsRaw: string): string | undefined {
  if (argsRaw === '') return undefined
  try {
    const parsed: unknown = JSON.parse(argsRaw)
    if (typeof parsed !== 'object' || parsed === null) return undefined
    const record = parsed as Record<string, unknown>
    for (const key of ['path', 'filePath', 'file', 'target', 'filename', 'name']) {
      const value = record[key]
      if (typeof value === 'string' && value.trim() !== '') return value
    }
    return undefined
  } catch {
    return undefined
  }
}

/** Command text for terminal tools; first line, capped. */
function argsCommand(argsRaw: string): string {
  if (argsRaw === '') return ''
  try {
    const parsed: unknown = JSON.parse(argsRaw)
    if (typeof parsed !== 'object' || parsed === null) return ''
    const command: unknown = (parsed as Record<string, unknown>).command
    if (typeof command === 'string' && command.trim() !== '') return firstLine(command, 160)
    const commands: unknown = (parsed as Record<string, unknown>).commands
    if (Array.isArray(commands)) {
      const first = commands.find(candidate => typeof candidate === 'string')
      if (typeof first === 'string') return firstLine(first, 160)
    }
    return ''
  } catch {
    return ''
  }
}

/** First non-empty line of a settled tool result's text content. */
function resultFirstLine(block: ToolCallBlock): string {
  if (!('kind' in block)) return ''
  for (const content of block.content) {
    if (content.type === 'text') {
      const text: unknown = (content as { text?: unknown }).text
      if (typeof text === 'string' && text.trim() !== '') return firstLine(text, 160)
    }
  }
  return ''
}

interface RawDiffHunk {
  readonly path?: unknown
  readonly oldText?: unknown
  readonly newText?: unknown
}

/** Narrow one wire `card:'diff'` view's `diffs` to line counts and paths. */
function diffCounts(diffs: unknown): { readonly paths: readonly string[]; readonly additions: number; readonly deletions: number } | null {
  if (!Array.isArray(diffs) || diffs.length === 0) return null
  let additions = 0
  let deletions = 0
  const paths: string[] = []
  for (const hunk of diffs) {
    if (typeof hunk !== 'object' || hunk === null) return null
    const { path, oldText, newText } = hunk as RawDiffHunk
    if (oldText !== null && typeof oldText !== 'string') return null
    if (typeof newText !== 'string') return null
    additions += newText === '' ? 0 : newText.split('\n').length
    deletions += oldText === '' || oldText === null ? 0 : oldText.split('\n').length
    if (typeof path === 'string' && path !== '') paths.push(path)
  }
  return { paths, additions, deletions }
}

/** Diff counts for one Tool block: the result view wins once settled, else the call view. */
function blockDiffCounts(block: ToolCallBlock):
  { readonly paths: readonly string[]; readonly additions: number; readonly deletions: number } | null {
  const result = 'kind' in block && block.resultView?.card === 'diff'
    ? diffCounts(block.resultView.diffs)
    : null
  if (result !== null) return result
  return block.callView?.card === 'diff' ? diffCounts(block.callView.diffs) : null
}

/** Node-level anchor time for ordering and the timeline clock. */
function eventTime(node: ChatNode): number {
  switch (node.kind) {
    case 'assistant-step':
    case 'command':
    case 'compaction':
    case 'turn-error':
    case 'turn-max-tokens':
    case 'turn-tail':
      return node.data.time
    case 'tool-call':
      return node.data.root.time
    case 'manual-compaction':
      return node.data.command.time
    case 'model-retry':
      return node.data.current.time
    case 'user':
    case 'steering':
    case 'context':
      return node.data.time
    case 'unknown':
      return node.data.time
  }
}

/** Duration text for a completed turn, from the closing assistant's timing. */
function turnDurationText(node: ChatNode<'turn-tail'>): string {
  const timing = node.data.closing?.finalNode.timing
  if (timing !== undefined && timing.stepStartTime != null) {
    const ms = Math.max(0, timing.completedTime - timing.stepStartTime)
    return ms >= 10_000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`
  }
  return ''
}

/**
 * Project one final Chat node into a normalized execution event.
 * @param node - final Chat node off the conversation snapshot.
 * @returns the timeline event model for that node.
 */
export function executionEventFromNode(node: ChatNode): ExecutionEvent {
  const base = {
    key: node.key,
    seq: node.anchorSeq,
    time: eventTime(node),
    kind: node.kind,
  }
  switch (node.kind) {
    case 'user':
    case 'steering': {
      const text = firstTextBlock(node.data.content)
      return {
        ...base,
        category: 'message',
        type: 'user_message',
        status: 'info',
        title: text === '' ? '…' : firstLine(text, 120),
        description: '',
      }
    }
    case 'context': {
      const producer = node.data.provenance.label ?? ''
      return {
        ...base,
        category: 'message',
        type: 'context',
        status: 'info',
        title: firstLine(firstTextBlock(node.data.content), 120),
        description: producer,
      }
    }
    case 'assistant-step': {
      const { status: nodeStatus, blocks } = node.data
      const reasoning = firstReasoningLine(blocks)
      const text = firstAssistantLine(blocks)
      const status: ExecutionEventStatus = nodeStatus === 'running'
        ? 'running'
        : nodeStatus === 'interrupted' ? 'warning' : 'success'
      if (reasoning !== '' && !hasText(blocks)) {
        return {
          ...base,
          category: 'agent',
          type: 'thinking',
          status,
          title: nodeStatus === 'running' ? 'Thinking' : 'Thought',
          description: firstLine(reasoning, 160),
        }
      }
      return {
        ...base,
        category: 'agent',
        type: 'analysis',
        status,
        title: text === '' ? (nodeStatus === 'running' ? 'Analyzing' : 'Analysis') : firstLine(text, 120),
        description: reasoning === '' ? '' : firstLine(reasoning, 160),
      }
    }
    case 'tool-call': {
      const root = node.data.root
      const name = 'kind' in root ? root.call?.name ?? '' : root.name
      const { type, category } = toolEventType(name)
      const settled = 'kind' in root
      const status: ExecutionEventStatus = settled ? (root.isError ? 'error' : 'success') : 'running'
      const diffs = blockDiffCounts(root)
      const argsRaw = 'kind' in root ? (root.call?.argsRaw ?? '') : root.argsRaw
      const filePath = argsPath(argsRaw)
      const description = category === 'terminal'
        ? argsCommand(argsRaw)
        : (category === 'files' ? (filePath ?? '') : (resultFirstLine(root) || ''))
      return {
        ...base,
        category,
        type: settled && root.isError ? 'tool_error' : type,
        status,
        title: name === '' ? 'Tool' : name,
        description,
        toolName: name,
        ...filePath !== undefined ? { filePath } : {},
        ...diffs !== null && diffs.additions + diffs.deletions > 0
          ? { additions: diffs.additions, deletions: diffs.deletions }
          : {},
        ...settled && root.callTime !== null
          ? { durationMs: Math.max(0, root.time - root.callTime) }
          : {},
      }
    }
    case 'command': {
      const { name, args, outcome } = node.data
      const status: ExecutionEventStatus = outcome === null
        ? 'running'
        : outcome.kind === 'error' ? 'error' : 'success'
      return {
        ...base,
        category: 'terminal',
        type: 'command',
        status,
        title: name ?? 'command',
        description: args === null ? '' : firstLine(args, 160),
      }
    }
    case 'manual-compaction': {
      const summary = node.data.compaction?.summary ?? ''
      return {
        ...base,
        category: 'state',
        type: 'task_progress',
        status: 'info',
        title: 'Compaction',
        description: summary === '' ? '' : firstLine(summary, 160),
      }
    }
    case 'compaction': {
      const summary = node.data.summary ?? ''
      return {
        ...base,
        category: 'state',
        type: 'task_progress',
        status: 'info',
        title: 'Compaction',
        description: summary === '' ? '' : firstLine(summary, 160),
      }
    }
    case 'model-retry': {
      const current = node.data.current
      return {
        ...base,
        category: 'state',
        type: 'warning',
        status: 'warning',
        title: 'Model retry',
        description: `retry ${current.retry}`,
      }
    }
    case 'turn-error': {
      return {
        ...base,
        category: 'state',
        type: 'task_failed',
        status: 'error',
        title: firstLine(node.data.message, 160),
        description: node.data.code ?? '',
      }
    }
    case 'turn-max-tokens': {
      return {
        ...base,
        category: 'state',
        type: 'warning',
        status: 'warning',
        title: 'Max tokens reached',
        description: '',
      }
    }
    case 'turn-tail': {
      const duration = turnDurationText(node)
      return {
        ...base,
        category: 'state',
        type: 'task_completed',
        status: 'success',
        title: `Turn ${node.data.turn} complete`,
        description: duration,
      }
    }
    case 'unknown': {
      return {
        ...base,
        category: 'state',
        type: 'warning',
        status: 'warning',
        title: 'Unknown event',
        description: node.data.type,
      }
    }
  }
}
