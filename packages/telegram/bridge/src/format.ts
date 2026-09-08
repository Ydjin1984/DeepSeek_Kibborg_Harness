/**
 * Pure text formatting for the mirror: user/assistant lines, compact tool
 * action lines, and human-readable question answers. Kept free of cordis and
 * transport imports so the mapping is unit-testable in isolation.
 * @module @deepseek-ai/dsh-telegram-bridge/format
 */

import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { ToolCallKind } from '@deepseek-ai/dsh-tools'
import type { AskUserQuestionItem } from '@deepseek-ai/dsh-user-questions'

/** Prefix for lines authored by the human. */
export const USER_PREFIX = '👤'

/** Cap applied to one assistant or user line (Telegram's 4096 limit minus slack). */
export const MAX_MESSAGE_CHARS = 3900

/** Trim one line to {@link MAX_MESSAGE_CHARS} with an ellipsis marker. */
export function clampLine(text: string, max = MAX_MESSAGE_CHARS): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}

/** A human line, mirroring what the browser renders for a user message. */
export function userLine(text: string): string {
  return `${USER_PREFIX} ${clampLine(text)}`
}

/** Concatenate the visible `text` blocks of a message (reasoning excluded). */
export function extractVisibleText(content: readonly ContentBlock[]): string {
  let out = ''
  for (const block of content) {
    if (block.type === 'text') out += block.text
  }
  return out
}

const TOOL_ICONS: Record<string, string> = {
  execute: '🛠',
  read: '📖',
  edit: '✏️',
  delete: '🗑',
  move: '📦',
  search: '🔍',
  fetch: '🌐',
}

/** Emoji for one tool-call presentation kind. */
export function iconForKind(kind: ToolCallKind | undefined): string {
  return kind === undefined ? '⚙️' : (TOOL_ICONS[kind] ?? '⚙️')
}

/** Emoji fallback for tools whose presenter did not classify the call. */
export function iconForToolName(name: string): string {
  if (name.startsWith('bash') || name.startsWith('pwsh') || name === 'run') return '🛠'
  if (name === 'read' || name === 'write' || name === 'edit') return '📝'
  if (name === 'glob' || name === 'grep' || name.includes('search')) return '🔍'
  if (name.startsWith('web_')) return '🌐'
  return '⚙️'
}

/** One compact action line: `🛠 <title>` (the presenter title is human-readable). */
export function toolActionLine(title: string, kind: ToolCallKind | undefined, name: string): string {
  const icon = kind === undefined ? iconForToolName(name) : iconForKind(kind)
  return `${icon} ${clampLine(title)}`
}

/** Success/error suffix appended to an action line once the tool settles. */
export function toolOutcomeSuffix(errorCode: string | undefined): string {
  return errorCode === undefined ? ' — ✅' : ` — ❌ ${clampLine(errorCode, 80)}`
}

/** The parsed `{ answers }` payload an `ask_user_question` result carries. */
export interface ParsedQuestionAnswers {
  answers: { id: string; selected: string[]; custom?: string }[]
}

/** Parse the JSON render of an `ask_user_question` tool result. */
export function parseQuestionAnswers(raw: string): ParsedQuestionAnswers | undefined {
  try {
    const parsed = JSON.parse(raw) as { answers?: unknown }
    if (!Array.isArray(parsed.answers)) return undefined
    return {
      answers: parsed.answers.flatMap((answer) => {
        if (typeof answer !== 'object' || answer === null) return []
        const record = answer as Record<string, unknown>
        if (typeof record.id !== 'string' || !Array.isArray(record.selected)) return []
        const selected = record.selected.filter((item): item is string => typeof item === 'string')
        const custom = typeof record.custom === 'string' ? record.custom : undefined
        return [{ id: record.id, selected, ...(custom === undefined ? {} : { custom }) }]
      }),
    }
  } catch {
    return undefined
  }
}

/** One human-readable answer line naming the question it settles. */
export function questionAnswerLine(
  questions: readonly AskUserQuestionItem[],
  answers: ParsedQuestionAnswers['answers'],
): string {
  if (answers.length === 0) return `${USER_PREFIX} Ответ: —`
  const lines = answers.map((answer) => {
    const question = questions.find(candidate => candidate.id === answer.id)
    const label = question === undefined ? answer.id : question.question
    const chosen = [
      ...answer.selected,
      ...(answer.custom === undefined || answer.custom === '' ? [] : [`«${answer.custom}»`]),
    ]
    return chosen.length === 0
      ? `${USER_PREFIX} ${label}: —`
      : `${USER_PREFIX} ${label}: ${chosen.join(', ')}`
  })
  return clampLine(lines.join('\n'))
}
