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
    return this.send<T>(method, JSON.stringify(params), { 'content-type': 'application/json' }, signal)
  }

  /**
   * POST one Bot API call and unwrap its result envelope.
   * @param method - Bot API method name.
   * @param body - request body: JSON text or a multipart form.
   * @param headers - headers matching `body` (empty for a form; fetch adds the boundary).
   * @param signal - cancellation for the request.
   * @returns the call outcome: the decoded result, or the API description of the refusal.
   */
  private async send<T>(
    method: string,
    body: string | FormData,
    headers: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<TelegramCallResult<T>> {
    let response: Response
    try {
      response = await fetch(this.url(method), {
        method: 'POST',
        headers,
        body,
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

  /**
   * Fetch updates, long-polling up to {@link GET_UPDATES_LONG_POLL_SECONDS}.
   * @param offset - id of the first update to return: one past the highest id already processed.
   * @param signal - cancellation; aborting ends the pending long poll.
   * @returns the fetched updates, or the API description when Telegram refuses the call.
   */
  async getUpdates(offset: number, signal?: AbortSignal): Promise<TelegramCallResult<TelegramUpdate[]>> {
    return this.call<TelegramUpdate[]>('getUpdates', {
      offset,
      timeout: GET_UPDATES_LONG_POLL_SECONDS,
      limit: 100,
      allowed_updates: ['message', 'callback_query'],
    }, signal)
  }

  /**
   * Send one text message, optionally with an inline keyboard.
   * @param chatId - target chat id, as configured in the Telegram settings.
   * @param text - message body; the caller keeps it under Telegram's message length cap.
   * @param options - optional inline keyboard; omitted `replyMarkup` sends a message without buttons.
   * @param signal - cancellation for the request.
   * @returns the sent message, or the API description when Telegram refuses the call.
   */
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

  /**
   * Upload one file as a document, with `caption` shown under it.
   * @param chatId - target chat id.
   * @param filename - name the document is uploaded under and shown with in the chat.
   * @param content - the document's UTF-8 text, uploaded with the `text/markdown` media type.
   * @param caption - caption shown under the document; Telegram truncates it at its own caption cap.
   * @param signal - cancellation for the request.
   * @returns the sent message carrying the document, or the API description when Telegram refuses the call.
   */
  async sendDocument(
    chatId: string,
    filename: string,
    content: string,
    caption: string,
    signal?: AbortSignal,
  ): Promise<TelegramCallResult<TelegramMessage>> {
    const form = new FormData()
    form.append('chat_id', chatId)
    form.append('caption', caption)
    form.append('document', new Blob([content], { type: 'text/markdown' }), filename)
    return this.send<TelegramMessage>('sendDocument', form, {}, signal)
  }

  /**
   * Replace the text of an earlier bridge message. An edit that leaves the text
   * unchanged comes back as a refusal (Telegram rejects a no-op edit), not as the
   * message.
   * @param chatId - chat owning the message.
   * @param messageId - Telegram id of the bridge message to edit.
   * @param text - replacement text, kept under the message length cap by the caller.
   * @param signal - cancellation for the request.
   * @returns the edited message, or the API description when Telegram refuses the call.
   */
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

  /**
   * Remove the inline keyboard of an earlier bridge message, keeping its text.
   * @param chatId - chat owning the message.
   * @param messageId - Telegram id of the bridge message whose keyboard is dropped.
   * @param signal - cancellation for the request.
   * @returns the edited message, or the API description when Telegram refuses the call.
   */
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

  /**
   * Delete one of the bridge's own messages. Telegram refuses to delete messages
   * the bot did not send, and its own beyond the service's deletion window.
   * @param chatId - chat owning the message.
   * @param messageId - Telegram id of the message to delete.
   * @param signal - cancellation for the request.
   * @returns whether Telegram deleted the message, or the API description when it refuses.
   */
  async deleteMessage(chatId: string, messageId: number, signal?: AbortSignal): Promise<TelegramCallResult<boolean>> {
    return this.call<boolean>('deleteMessage', {
      chat_id: chatId,
      message_id: messageId,
    }, signal)
  }

  /**
   * Acknowledge an inline-button press (dismisses the client's loading state).
   * @param callbackQueryId - id carried by the pressed button's callback query.
   * @param options - optional reply text; `alert: true` shows it as a modal alert instead of a transient toast.
   * @param signal - cancellation for the request.
   * @returns whether Telegram accepted the acknowledgement, or the API description when it refuses.
   */
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
