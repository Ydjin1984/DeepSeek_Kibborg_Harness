import type {
  AssistantMessageNode, CommandNode, ConversationNode, ToolResultNode, UserMessageNode,
} from '@deepseek-ai/dsh-client-runtime/client'
import { chatSnapshotFixture } from './chat-snapshot-fixture.client.ts'

/** Counts that identify one deterministic conversation activity workload. */
export interface ConversationActivityProfile {
  readonly total: number
  readonly error: number
  readonly running: 0
}

/** Real-runtime fixture for a mixed conversation activity history. */
export interface ConversationActivityFixture {
  readonly nodes: readonly ConversationNode[]
  readonly profile: ConversationActivityProfile
  readonly snapshot: ReturnType<typeof chatSnapshotFixture>
}

function user(seq: number, turn: number): UserMessageNode {
  return {
    kind: 'user', seq, time: seq * 1_000,
    content: [{ type: 'text', text: `Review turn ${String(turn)} and report the result.` }], source: null,
  }
}

function reasoning(seq: number, turn: number): AssistantMessageNode {
  return {
    kind: 'assistant', seq, time: seq * 1_000, turn, step: 1,
    blocks: [{ kind: 'reasoning', text: `Inspect the evidence for turn ${String(turn)} before changing files.` }],
  }
}

function tool(
  seq: number,
  name: string,
  args: Record<string, unknown>,
  text: string,
  isError = false,
): ToolResultNode {
  return {
    kind: 'tool-result', seq, time: seq * 1_000 + 40, callId: `activity-${String(seq)}`,
    call: { name, argsRaw: JSON.stringify(args) }, callTime: seq * 1_000,
    content: [{ type: 'text', text }], isError, callView: null, resultView: null, subCalls: [],
    ...(isError ? { error: { name: 'ToolError', code: 'fixture_failure' } } : {}),
  }
}

function edit(seq: number): ToolResultNode {
  const diffs = [{ path: 'src/activity.ts', oldText: 'export const state = "old"', newText: 'export const state = "new"' }]
  return {
    ...tool(seq, 'edit', { file_path: 'src/activity.ts', old_string: 'old', new_string: 'new' }, 'Updated src/activity.ts.'),
    callView: { card: 'diff', title: 'Edit src/activity.ts', diffs },
    resultView: { card: 'diff', title: 'Edit src/activity.ts', diffs },
  }
}

function read(seq: number): ToolResultNode {
  return {
    ...tool(seq, 'read', { file_path: 'src/activity.ts', offset: 1 }, '1: export const state = "old"'),
    resultView: {
      card: 'read', path: 'src/activity.ts', offset: 1, totalLines: 12, lang: 'ts',
      lines: [{ number: 1, text: 'export const state = "old"' }],
    },
  }
}

function plan(seq: number): CommandNode {
  return {
    kind: 'command', seq, time: seq * 1_000, commandId: `plan-${String(seq)}` as CommandNode['commandId'],
    name: 'plan', args: 'Review the affected file, change it, and verify the result.',
    outcome: { kind: 'success', text: 'Plan recorded.' },
  }
}

function eventAt(seq: number): ConversationNode {
  const turn = Math.floor((seq - 1) / 10) + 1
  switch ((seq - 1) % 10) {
    case 0: return user(seq, turn)
    case 1: return reasoning(seq, turn)
    case 2: return read(seq)
    case 3: return edit(seq)
    case 4: return tool(seq, 'bash', { command: 'pnpm exec vitest run' }, 'All focused tests passed.')
    case 5: return seq === 6
      ? tool(seq, 'bash', { command: 'pnpm run lint' }, 'lint failed: fixture_failure', true)
      : tool(seq, 'bash', { command: 'pnpm run lint' }, 'Lint completed.')
    case 6: return tool(seq, 'search', { query: 'activity fixture' }, 'Found 3 matching files.')
    case 7: return tool(seq, 'subagent', { task: 'Review the mixed workload.' }, 'Subagent completed its review.')
    case 8: return tool(seq, 'ask_user', { question: 'Apply the reviewed change?' }, 'Approval recorded.')
    case 9: return seq % 20 === 0
      ? plan(seq)
      : tool(seq, 'todo_write', { todos: [{ content: 'Verify the activity fixture', status: 'completed' }] }, 'Todo list updated.')
    default: throw new Error(`unsupported fixture event ${String(seq)}`)
  }
}

/**
 * Count the deterministic categories in a fixture length.
 * @param count - number of requested runtime nodes.
 * @returns workload counts used by baseline assertions and reports.
 */
export function conversationActivityProfile(count: number): ConversationActivityProfile {
  if (!Number.isSafeInteger(count) || count < 1) throw new RangeError('fixture event count must be a positive safe integer')
  return {
    total: count,
    error: count >= 6 ? 1 : 0,
    running: 0,
  }
}

/**
 * Build a deterministic mixed runtime-node workload for feed baselines.
 * @param count - number of requested runtime nodes.
 * @returns nodes, their Chat snapshot, and the stable workload profile.
 */
export function conversationActivityFixture(count = 50): ConversationActivityFixture {
  const profile = conversationActivityProfile(count)
  const nodes = Array.from({ length: count }, (_, index) => eventAt(index + 1))
  return { nodes, profile, snapshot: chatSnapshotFixture({ nodes }) }
}
