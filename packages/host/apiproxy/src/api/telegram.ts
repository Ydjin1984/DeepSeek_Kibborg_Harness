/**
 * telegram domain contract: the mirror state of the Telegram bridge the web
 * UI drives. The bridge itself is owned by `@deepseek-ai/dsh-telegram-bridge`;
 * this domain carries only session binding state — no token or chat id ever
 * crosses the wire (credentials live in the `telegram` settings namespace and
 * are redacted by the settings provider).
 */

import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { RpcRequest, RpcResponse } from './rpc.ts'

/** Mirror state for one session. */
export interface TelegramStatusView {
  /** Whether the bridge has a usable bot token + chat binding. */
  readonly configured: boolean
  /** Whether the mirror is attached to the queried session. */
  readonly attached: boolean
}

/** Outcome of the settings-page connectivity test. */
export interface TelegramTestView {
  /** Whether the test message was delivered. */
  readonly ok: boolean
  /** Delivery failure description; present when `ok` is false. */
  readonly description?: string
}

/** telegram-domain unary methods (the map keys telegram.* of RpcMethodMap). */
export interface TelegramApi {
  /**
   * Mirror state: configuration readiness always; per-session attachment when
   * `sessionId` is given (drives the composer button highlight).
   */
  status(request: RpcRequest<{ sessionId?: SessionId }>): Promise<RpcResponse<TelegramStatusView>>

  /**
   * Attach the mirror to `sessionId`, replacing any earlier attachment.
   * Fails when the bridge is absent or not configured.
   */
  attach(request: RpcRequest<{ sessionId: SessionId }>): Promise<RpcResponse<{}>>

  /** Detach the mirror when it is attached to `sessionId`. */
  detach(request: RpcRequest<{ sessionId: SessionId }>): Promise<RpcResponse<{}>>

  /** Send one test message through the configured bot/chat binding. */
  test(request: RpcRequest<{}>): Promise<RpcResponse<TelegramTestView>>
}
