import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ChatTransport } from '../src/chat.ts'
import type { InlineKeyboardMarkup } from '../src/types.ts'

/** One recorded outbound message. */
export interface RecordedMessage {
  messageId: number
  text: string
  markup: InlineKeyboardMarkup | undefined
}

/** In-memory {@link ChatTransport} that records every operation. */
export class RecorderTransport implements ChatTransport {
  readonly messages: RecordedMessage[] = []
  private nextId = 1

  sendText(text: string, markup?: InlineKeyboardMarkup): Promise<number> {
    const messageId = this.nextId++
    this.messages.push({ messageId, text, markup })
    return Promise.resolve(messageId)
  }

  editText(messageId: number, text: string): Promise<void> {
    const message = this.messages.find(candidate => candidate.messageId === messageId)
    if (message !== undefined) message.text = text
    return Promise.resolve()
  }

  clearKeyboard(messageId: number): Promise<void> {
    const message = this.messages.find(candidate => candidate.messageId === messageId)
    if (message !== undefined) message.markup = undefined
    return Promise.resolve()
  }

  deleteMessage(messageId: number): Promise<void> {
    const index = this.messages.findIndex(candidate => candidate.messageId === messageId)
    if (index >= 0) this.messages.splice(index, 1)
    return Promise.resolve()
  }

  text(messageId: number): string | undefined {
    return this.messages.find(candidate => candidate.messageId === messageId)?.text
  }
}

/** Build one session event envelope for the mirror tests. */
export function sessionEvent(type: string, data: unknown, seq = 1): SessionEvent {
  return { type, seq, time: Date.now(), data } as unknown as SessionEvent
}

/** Drain the microtask queue so chained send/edit promises settle. */
export async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve()
}
