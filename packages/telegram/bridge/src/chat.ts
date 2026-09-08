/**
 * Chat transport seam: the mirror and the question provider render through it,
 * so unit tests can substitute an in-memory recorder instead of a live bot.
 * @module @deepseek-ai/dsh-telegram-bridge/chat
 */

import type { BotClient } from './bot.ts'
import type { InlineKeyboardMarkup } from './types.ts'

/** Raised when the underlying bot call reports `ok: false`. */
export class ChatSendError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'ChatSendError'
  }
}

/** Outbound chat operations the mirror can issue. */
export interface ChatTransport {
  /** Send one message; resolves with the message id. */
  sendText(text: string, markup?: InlineKeyboardMarkup): Promise<number>
  /** Replace an earlier message's text. */
  editText(messageId: number, text: string): Promise<void>
  /** Drop the inline keyboard of an earlier message. */
  clearKeyboard(messageId: number): Promise<void>
  /** Delete one of our own messages. */
  deleteMessage(messageId: number): Promise<void>
}

/** {@link ChatTransport} backed by a {@link BotClient} and one chat id. */
export class TelegramChatTransport implements ChatTransport {
  /**
   * @param bot - the Bot API client in use.
   * @param chatId - the chat the mirror talks to.
   */
  constructor(
    private bot: BotClient,
    private chatId: string,
  ) {}

  /** Point the transport at a fresh client/chat (settings changed). */
  rebind(bot: BotClient, chatId: string): void {
    this.bot = bot
    this.chatId = chatId
  }

  async sendText(text: string, markup?: InlineKeyboardMarkup): Promise<number> {
    const result = await this.bot.sendMessage(this.chatId, text, markup === undefined ? {} : { replyMarkup: markup })
    if (!result.ok) throw new ChatSendError(result.description)
    return result.result.message_id
  }

  async editText(messageId: number, text: string): Promise<void> {
    const result = await this.bot.editMessageText(this.chatId, messageId, text)
    if (!result.ok) throw new ChatSendError(result.description)
  }

  async clearKeyboard(messageId: number): Promise<void> {
    const result = await this.bot.editMessageReplyMarkup(this.chatId, messageId)
    if (!result.ok) throw new ChatSendError(result.description)
  }

  async deleteMessage(messageId: number): Promise<void> {
    const result = await this.bot.deleteMessage(this.chatId, messageId)
    if (!result.ok) throw new ChatSendError(result.description)
  }
}
