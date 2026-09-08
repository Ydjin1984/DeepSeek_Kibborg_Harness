/**
 * Minimal Telegram Bot API client over fetch: getUpdates long polling plus the
 * message calls the mirror needs. Errors surface as `TelegramCallResult`
 * failures carrying the API description; transport failures throw.
 * @module @deepseek-ai/dsh-telegram-bridge/bot
 */

import type {
  InlineKeyboardMarkup,
  TelegramApiResponse,
  TelegramCallResult,
  TelegramMessage,
  TelegramUpdate,
} from './types.ts'

/** Bot API base URL; overridable so tests can point at a local mock. */
export const TELEGRAM_API_BASE = 'https://api.telegram.org'

/** Long-poll ceiling used by {@link BotClient.getUpdates}. */
const GET_UPDATES_LONG_POLL_SECONDS = 30

/** Thrown when a Bot API call cannot be transported (network, malformed reply). */
export class BotApiTransportError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'BotApiTransportError'
  }
}

/** Thin typed wrapper over the Bot API HTTP surface. */
export class BotClient {
  private readonly baseUrl: string

  /**
   * @param token - bot token from @BotFather.
   * @param apiBase - Bot API base URL (test seam).
   */
  constructor(
    private readonly token: string,
    apiBase: string = TELEGRAM_API_BASE,
  ) {
    this.baseUrl = apiBase
  }

  private url(method: string): string {
    return `${this.baseUrl}/bot${this.token}/${method}`
  }

  private async call<T>(method: string, params: Record<string, unknown>, signal?: AbortSignal): Promise<TelegramCallResult<T>> {
    let response: Response
    try {
      response = await fetch(this.url(method), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(params),
        ...(signal === undefined ? {} : { signal }),
      })
    } catch (error: unknown) {
      throw new BotApiTransportError(`telegram ${method} request failed: ${String(error)}`)
    }
    let payload: TelegramApiResponse<T>
    try {
      payload = await response.json() as TelegramApiResponse<T>
    } catch {
      throw new BotApiTransportError(`telegram ${method} returned non-JSON (HTTP ${response.status})`)
    }
    if (payload.ok !== true) {
      return { ok: false, description: payload.description ?? `telegram ${method} failed (HTTP ${response.status})` }
    }
    return { ok: true, result: payload.result as T }
  }

  /** Fetch updates, long-polling up to {@link GET_UPDATES_LONG_POLL_SECONDS}. */
  async getUpdates(offset: number, signal?: AbortSignal): Promise<TelegramCallResult<TelegramUpdate[]>> {
    return this.call<TelegramUpdate[]>('getUpdates', {
      offset,
      timeout: GET_UPDATES_LONG_POLL_SECONDS,
      limit: 100,
      allowed_updates: ['message', 'callback_query'],
    }, signal)
  }

  /** Send one text message, optionally with an inline keyboard. */
  async sendMessage(
    chatId: string,
    text: string,
    options: { replyMarkup?: InlineKeyboardMarkup } = {},
    signal?: AbortSignal,
  ): Promise<TelegramCallResult<TelegramMessage>> {
    return this.call<TelegramMessage>('sendMessage', {
      chat_id: chatId,
      text,
      ...(options.replyMarkup === undefined
        ? {}
        : { reply_markup: options.replyMarkup }),
    }, signal)
  }

  /** Replace the text of an earlier bridge message. */
  async editMessageText(
    chatId: string,
    messageId: number,
    text: string,
    signal?: AbortSignal,
  ): Promise<TelegramCallResult<TelegramMessage>> {
    return this.call<TelegramMessage>('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text,
    }, signal)
  }

  /** Remove the inline keyboard of an earlier bridge message, keeping its text. */
  async editMessageReplyMarkup(
    chatId: string,
    messageId: number,
    signal?: AbortSignal,
  ): Promise<TelegramCallResult<TelegramMessage>> {
    return this.call<TelegramMessage>('editMessageReplyMarkup', {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: { inline_keyboard: [] },
    }, signal)
  }

  /** Delete one of the bridge's own messages. */
  async deleteMessage(chatId: string, messageId: number, signal?: AbortSignal): Promise<TelegramCallResult<boolean>> {
    return this.call<boolean>('deleteMessage', {
      chat_id: chatId,
      message_id: messageId,
    }, signal)
  }

  /** Acknowledge an inline-button press (dismisses the client's loading state). */
  async answerCallbackQuery(
    callbackQueryId: string,
    options: { text?: string; alert?: boolean } = {},
    signal?: AbortSignal,
  ): Promise<TelegramCallResult<boolean>> {
    return this.call<boolean>('answerCallbackQuery', {
      callback_query_id: callbackQueryId,
      ...options,
    }, signal)
  }
}
