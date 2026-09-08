/**
 * The mirror engine: turns one attached session's live event stream into a
 * sequence of chat messages. Assistant text streams into one editable message
 * (debounced edits, chunked at the Telegram length cap), tool calls render as
 * compact action lines that gain a success/error suffix when the result
 * arrives, and `ask_user_question` calls render as an answer recap instead of
 * an action line (the question itself is delivered by the question provider).
 * @module @deepseek-ai/dsh-telegram-bridge/mirror
 */

import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { CallId, ContentBlock } from '@deepseek-ai/dsh-llm'
import type { ToolCallKind } from '@deepseek-ai/dsh-tools'
import type { AskUserQuestionItem } from '@deepseek-ai/dsh-user-questions'
import type { ChatTransport } from './chat.ts'
import {
  clampLine,
  extractVisibleText,
  MAX_MESSAGE_CHARS,
  parseQuestionAnswers,
  questionAnswerLine,
  toolActionLine,
  toolOutcomeSuffix,
  userLine,
} from './format.ts'

/** Debounce between two edits of one live assistant message. */
const EDIT_DEBOUNCE_MS = 800

/** A human-readable tool-call title, when the tool ships a presenter. */
export interface ToolPresentation {
  title: string
  kind?: ToolCallKind
}

/** Presenter hook the engine calls for compact action lines. */
export interface ToolPresenter {
  presentCall(name: string, rawArgs: string): ToolPresentation | undefined
}

/** Minimal logger surface the engine needs. */
export interface MirrorLogger {
  warn(message: string): void
}

/** One live assistant text stream (a single chat message being edited). */
interface LiveStream {
  text: string
  messageId: number | null
  timer: ReturnType<typeof setTimeout> | null
}

/** Maps one attached session's events to chat operations. */
export class MirrorEngine {
  private sessionId: string | null = null
  private stream: LiveStream | null = null
  private readonly toolMessages = new Map<string, { messageId: number | null; line: string }>()
  private readonly askCalls = new Map<string, { questions: AskUserQuestionItem[] }>()

  constructor(
    private readonly transport: ChatTransport,
    private readonly present: ToolPresenter,
    private readonly logger: MirrorLogger,
  ) {}

  /** Begin mirroring `sessionId`; drops any earlier mirror state. */
  attach(sessionId: string): void {
    this.reset()
    this.sessionId = sessionId
  }

  /** Stop mirroring and drop all per-session state. */
  detach(): void {
    this.reset()
  }

  /** Forward one session event; ignored unless it belongs to the attached session. */
  onSessionEvent(session: Session, event: SessionEvent): void {
    if (this.sessionId === null || session.id !== this.sessionId) return
    switch (event.type) {
      case 'user/message': {
        if (event.data.source.kind !== 'user') return
        const text = extractVisibleText(event.data.content)
        if (text === '') return
        void this.send(userLine(text))
        return
      }
      case 'assistant/chunk': {
        const chunk = event.data.chunk
        if (chunk.type !== 'text-delta' || chunk.text === '') return
        this.onAssistantDelta(chunk.text)
        return
      }
      case 'assistant/message': {
        this.onAssistantFinal(extractVisibleText(event.data.message.content))
        return
      }
      case 'tool/call': {
        this.onToolCall(event.data.callId, event.data.name, event.data.arguments)
        return
      }
      case 'tool/result': {
        const source = event.data.message.source
        if (source.kind !== 'tool') return
        this.onToolResult(source.callId, event.data.message.content, event.data.error)
        return
      }
      default:
        return
    }
  }

  private onAssistantDelta(delta: string): void {
    if (this.stream === null) {
      this.stream = { text: '', messageId: null, timer: null }
    }
    const stream = this.stream
    stream.text += delta
    this.scheduleFlush(stream)
  }

  private onAssistantFinal(finalText: string): void {
    const stream = this.stream
    if (stream === null) {
      if (finalText !== '') void this.deliver(finalText, null)
      return
    }
    this.clearTimer(stream)
    this.stream = null
    if (finalText !== '') void this.deliver(finalText, stream.messageId)
  }

  private scheduleFlush(stream: LiveStream): void {
    if (stream.timer !== null) clearTimeout(stream.timer)
    stream.timer = setTimeout(() => {
      stream.timer = null
      this.flush(stream)
    }, EDIT_DEBOUNCE_MS)
  }

  /** Send or edit whatever the stream accumulated so far, chunking at the cap. */
  private flush(stream: LiveStream): void {
    if (stream.text === '') return
    const over = stream.text.length > MAX_MESSAGE_CHARS
    const chunk = over ? stream.text.slice(0, MAX_MESSAGE_CHARS) : stream.text
    if (over) {
      // Keep the tail for a follow-up message; this one is final at the cap.
      const tail = stream.text.slice(MAX_MESSAGE_CHARS)
      stream.text = tail
      stream.messageId = null
      void this.deliver(chunk, null).then(() => {
        if (tail !== '') this.scheduleFlush(stream)
      })
    } else {
      stream.text = ''
      void this.deliver(chunk, stream.messageId).then((messageId) => {
        if (messageId !== undefined) stream.messageId = messageId
      })
    }
  }

  /** Send `text`, or edit `messageId` when one exists; returns the live message id. */
  private async deliver(text: string, messageId: number | null): Promise<number | undefined> {
    const content = clampLine(text)
    if (messageId === null) {
      try {
        return await this.transport.sendText(content)
      } catch (error: unknown) {
        this.logger.warn(`telegram send failed: ${String(error)}`)
        return undefined
      }
    }
    try {
      await this.transport.editText(messageId, content)
      return messageId
    } catch (error: unknown) {
      this.logger.warn(`telegram edit failed: ${String(error)}`)
      return undefined
    }
  }

  private onToolCall(callId: CallId, name: string, rawArgs: string): void {
    if (name === 'ask_user_question') {
      const questions = parseAskArguments(rawArgs)
      if (questions !== undefined) this.askCalls.set(callId, { questions })
      return
    }
    const presented = this.safePresent(name, rawArgs)
    const title = presented?.title ?? `${name}`
    const line = toolActionLine(title, presented?.kind, name)
    const id = callId
    this.toolMessages.set(id, { messageId: null, line })
    void this.deliver(line, null).then((messageId) => {
      const entry = this.toolMessages.get(id)
      if (entry !== undefined && messageId !== undefined) entry.messageId = messageId
    })
  }

  private onToolResult(callId: CallId, content: readonly ContentBlock[], error: { name: string; code: string } | undefined): void {
    const ask = this.askCalls.get(callId)
    if (ask !== undefined) {
      this.askCalls.delete(callId)
      const raw = extractVisibleText(content)
      const parsed = parseQuestionAnswers(raw)
      const text = parsed === undefined
        ? userLine(raw === '' ? '—' : raw)
        : questionAnswerLine(ask.questions, parsed.answers)
      void this.send(text)
      return
    }
    const tool = this.toolMessages.get(callId)
    if (tool === undefined || tool.messageId === null) return
    this.toolMessages.delete(callId)
    const updated = clampLine(`${tool.line}${toolOutcomeSuffix(error?.code)}`)
    void this.transport.editText(tool.messageId, updated)
      .catch((reason: unknown) => this.logger.warn(`telegram edit failed: ${String(reason)}`))
  }

  private safePresent(name: string, rawArgs: string): ToolPresentation | undefined {
    try {
      return this.present.presentCall(name, rawArgs)
    } catch {
      return undefined
    }
  }

  private send(text: string): Promise<number | undefined> {
    return this.deliver(text, null)
  }

  private clearTimer(stream: LiveStream): void {
    if (stream.timer !== null) {
      clearTimeout(stream.timer)
      stream.timer = null
    }
  }

  private reset(): void {
    this.sessionId = null
    if (this.stream !== null) this.clearTimer(this.stream)
    this.stream = null
    this.toolMessages.clear()
    this.askCalls.clear()
  }
}

/** Parse the raw `arguments` JSON of an `ask_user_question` call. */
function parseAskArguments(raw: string): AskUserQuestionItem[] | undefined {
  try {
    const parsed = JSON.parse(raw) as { questions?: unknown }
    if (!Array.isArray(parsed.questions)) return undefined
    return parsed.questions.flatMap((question): AskUserQuestionItem[] => {
      if (typeof question !== 'object' || question === null) return []
      const record = question as Record<string, unknown>
      if (typeof record.id !== 'string' || typeof record.question !== 'string') return []
      const options = Array.isArray(record.options)
        ? record.options.flatMap((option): { label: string; description?: string }[] => {
          if (typeof option !== 'object' || option === null) return []
          const o = option as Record<string, unknown>
          return typeof o.label === 'string'
            ? [{ label: o.label, ...(typeof o.description === 'string' ? { description: o.description } : {}) }]
            : []
        })
        : undefined
      return [{
        id: record.id,
        question: record.question,
        ...(typeof record.header === 'string' ? { header: record.header } : {}),
        ...(options === undefined ? {} : { options }),
        ...(record.multi_select === true ? { multiSelect: true } : {}),
      }]
    })
  } catch {
    return undefined
  }
}
