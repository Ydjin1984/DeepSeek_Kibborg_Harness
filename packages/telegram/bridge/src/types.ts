/**
 * Wire types for the Telegram Bot API surface this bridge uses, and the
 * settings shape it consumes. Deliberately minimal: only the fields the
 * bridge reads or writes are modelled.
 * @module @deepseek-ai/dsh-telegram-bridge/types
 */

/** Bot token + chat binding configured by the user. */
export interface TelegramSettings {
  /** Telegram bot token issued by @BotFather. */
  botToken: string
  /** Numeric chat id the mirror talks to. */
  chatId: string
  /** Bot API base URL (test/proxy seam). */
  apiBaseUrl?: string
}

/** One inline keyboard button. */
export interface InlineKeyboardButton {
  /** Button text. */
  text: string
  /** Callback payload echoed back on press. */
  callback_data?: string
}

/** Reply-markup: rows of inline buttons under a message. */
export interface InlineKeyboardMarkup {
  inline_keyboard: InlineKeyboardButton[][]
}

/** Options shared by every send/edit call. */
export interface TelegramSendOptions {
  /** Reply markup (question option buttons). */
  reply_markup?: InlineKeyboardMarkup
}

/** A message as returned by the Bot API (fields the bridge needs). */
export interface TelegramMessage {
  message_id: number
  chat: { id: number }
  text?: string
}

/** An inbound update (fields the bridge handles). */
export interface TelegramUpdate {
  update_id: number
  message?: {
    message_id: number
    chat: { id: number }
    text?: string
  }
  callback_query?: {
    id: string
    message?: TelegramMessage
    data?: string
  }
}

/** Result envelope the Bot API returns for every call. */
export interface TelegramApiResponse<T> {
  ok: boolean
  result?: T
  description?: string
}

/** Outcome of one Telegram API call. */
export type TelegramCallResult<T> =
  | { ok: true; result: T }
  | { ok: false; description: string }

/** Why the bridge cannot currently answer an incoming message. */
export type TelegramRejectReason = 'not-configured' | 'no-active-session' | 'session-not-running'
