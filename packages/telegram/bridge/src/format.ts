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

/** Filename of the report the bridge uploads when a task finishes. */
export const FINAL_REPORT_FILENAME = 'Final_Report.md'

/** Caption shown under the uploaded report. */
export const FINAL_REPORT_CAPTION = '✅ Задание выполнено — итоговый отчёт во вложении'

/**
 * Render the report document for a finished task: the turn it closed on,
 * when it closed, and the model's final answer.
 * @param sessionId - the mirrored session the report belongs to.
 * @param turn - the finished turn number.
 * @param answer - the model's final answer text.
 * @param time - the `turn/end` event time, in epoch milliseconds.
 * @returns the Markdown document uploaded as {@link FINAL_REPORT_FILENAME}.
 */
export function finalReportDocument(sessionId: string, turn: number, answer: string, time: number): string {
  return [
    '# Итоговый отчёт',
    '',
    `- **Сессия:** \`${sessionId}\``,
    `- **Задание:** turn ${String(turn)}`,
    `- **Завершено:** ${new Date(time).toISOString()}`,
    '',
    '## Финальный ответ',
    '',
    answer,
    '',
  ].join('\n')
}

/**
 * Trim one line to {@link MAX_MESSAGE_CHARS} with an ellipsis marker. The cut is
 * by UTF-16 code unit, so it can land inside a word or split a surrogate pair.
 * @param text - the line to trim.
 * @param max - character budget for the result, including the marker.
 * @returns `text` unchanged when it fits, otherwise its prefix plus `…`.
 */
export function clampLine(text: string, max = MAX_MESSAGE_CHARS): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}

/**
 * A human line, mirroring what the browser renders for a user message.
 * @param text - the message text as the user authored it.
 * @returns the {@link USER_PREFIX}-prefixed line, clamped to {@link MAX_MESSAGE_CHARS}.
 */
export function userLine(text: string): string {
  return `${USER_PREFIX} ${clampLine(text)}`
}

/**
 * Concatenate the visible `text` blocks of a message (reasoning excluded).
 * @param content - the message's content blocks, in order.
 * @returns the text blocks joined without separators; `''` when the message carries none.
 */
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

/**
 * Emoji for one tool-call presentation kind.
 * @param kind - the kind a tool's presenter classified the call as, or `undefined` when it did not.
 * @returns the kind's emoji, or the generic gear for an unclassified or unmapped kind.
 */
export function iconForKind(kind: ToolCallKind | undefined): string {
  return kind === undefined ? '⚙️' : (TOOL_ICONS[kind] ?? '⚙️')
}

/**
 * Emoji fallback for tools whose presenter did not classify the call.
 * @param name - the tool name as the model called it.
 * @returns the emoji matched by the name's family (`bash`/`pwsh`/`run`, file tools,
 *   search tools, `web_*`), or the generic gear when no family matches.
 */
export function iconForToolName(name: string): string {
  if (name.startsWith('bash') || name.startsWith('pwsh') || name === 'run') return '🛠'
  if (name === 'read' || name === 'write' || name === 'edit') return '📝'
  if (name === 'glob' || name === 'grep' || name.includes('search')) return '🔍'
  if (name.startsWith('web_')) return '🌐'
  return '⚙️'
}

/**
 * One compact action line: `🛠 <title>` (the presenter title is human-readable).
 * @param title - the human-readable call title.
 * @param kind - the presenter's classification, or `undefined` to fall back to the tool name.
 * @param name - the tool name, used for the icon only when `kind` is `undefined`.
 * @returns the icon and the clamped title on one line.
 */
export function toolActionLine(title: string, kind: ToolCallKind | undefined, name: string): string {
  const icon = kind === undefined ? iconForToolName(name) : iconForKind(kind)
  return `${icon} ${clampLine(title)}`
}

/**
 * Success/error suffix appended to an action line once the tool settles.
 * @param errorCode - the tool result's error code, or `undefined` when the call succeeded.
 * @returns the success marker, or the error marker plus the code clamped to 80 characters.
 */
export function toolOutcomeSuffix(errorCode: string | undefined): string {
  return errorCode === undefined ? ' — ✅' : ` — ❌ ${clampLine(errorCode, 80)}`
}

/** The parsed `{ answers }` payload an `ask_user_question` result carries. */
export interface ParsedQuestionAnswers {
  answers: { id: string; selected: string[]; custom?: string }[]
}

/**
 * Parse the JSON render of an `ask_user_question` tool result. Malformed JSON and
 * entries missing a string `id` or a `selected` array are dropped; non-string
 * `selected` items are dropped individually, so a partially usable result still
 * renders its valid answers.
 * @param raw - the tool result's textual content.
 * @returns the parsed answers payload, or `undefined` when the text is not JSON with an
 *   `answers` array.
 */
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

/**
 * One human-readable answer line naming the question it settles. An answer whose id
 * matches no asked question is labelled by that id; an answer with no selection and
 * no custom text renders as `—`. The joined lines are clamped as a whole.
 * @param questions - the questions the batch asked, used to label each answer.
 * @param answers - the parsed answers, in the order they were collected.
 * @returns one {@link USER_PREFIX}-prefixed line per answer, or a single `—` line for an empty batch.
 */
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
