/**
 * @deepseek-ai/dsh-telegram-bridge — the Telegram mirror bridge for the web
 * GUI. While a session mirror is attached it forwards the session's live event
 * stream (user lines, streaming assistant text, compact tool actions) into a
 * configured Telegram chat through Bot API long polling, relays the user's
 * answers and messages back into the session, and answers `ctx.userQuestions`
 * from the chat (option buttons or free text). Exposes `ctx.telegramBridge`
 * (attach/detach/status/test) for the web UI.
 *
 * Settings namespace `telegram`: `{ botToken, chatId }`; `botToken` is a
 * redacted secret.
 *
 * @module @deepseek-ai/dsh-telegram-bridge
 */

import { Context, Service } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type { SessionId, Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { installSettingsSection, settingsNamespace, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import type { ToolCallKind } from '@deepseek-ai/dsh-tools'
import type { UserQuestionProvider } from '@deepseek-ai/dsh-user-questions'
import z from '@deepseek-ai/schemastery'
import { BotClient, TELEGRAM_API_BASE } from './bot.ts'
import { TelegramChatTransport } from './chat.ts'
import { MirrorEngine, type ToolPresenter } from './mirror.ts'
import { TelegramQuestionProvider } from './questions.ts'
import type { TelegramSettings } from './types.ts'

/** Namespace holding the user-configured bot token and chat binding. */
export const TELEGRAM_SETTINGS_NS: SettingsNamespace = settingsNamespace('telegram')

/** Polling restart wait after a transient Bot API failure. */
const RETRY_DELAY_MS = 5000

/** One mirror runtime: client, transport, and the two renderers it feeds. */
interface BridgeRuntime {
  bot: BotClient
  transport: TelegramChatTransport
  mirror: MirrorEngine
  questions: TelegramQuestionProvider
}

/** The bridge service: owns settings, polling, the attached session mirror, and the Telegram question channel. */
export class TelegramBridgeService extends Service {
  static Config: z<TelegramSettings> = z.object({
    botToken: z.string().role('secret').default(''),
    chatId: z.string().default(''),
    apiBaseUrl: z.string(),
  })

  private currentSettings: () => TelegramSettings = () => ({ botToken: '', chatId: '' })
  private runtime: BridgeRuntime | null = null
  private activeSessionId: SessionId | null = null
  private questionProviderRegistered = false
  private questionProviderDispose: (() => void) | null = null
  private pollingAbort: AbortController | null = null

  constructor(ctx: Context, config: TelegramSettings) {
    super(ctx, 'telegramBridge')
    installSettingsSection(ctx, TELEGRAM_SETTINGS_NS, TelegramBridgeService.Config, config, {
      setSource: (source: () => TelegramSettings) => {
        this.currentSettings = source
      },
      onChange: () => {
        this.restartPolling()
      },
    })
    ctx.on('session/event', (session: Session, event: SessionEvent) => {
      this.runtime?.mirror.onSessionEvent(session, event)
    })
  }

  // ── public service surface (consumed by the web UI via the api gateway) ────

  /** Whether the bridge has a usable bot token + chat binding. */
  configured(): boolean {
    const settings = this.currentSettings()
    return settings.botToken !== '' && settings.chatId !== ''
  }

  /** Mirror state for one session (or configuration state only when none is given). */
  status(sessionId: SessionId | undefined): { configured: boolean; attached: boolean } {
    return {
      configured: this.configured(),
      attached: sessionId !== undefined && this.activeSessionId === sessionId,
    }
  }

  /** Attach the mirror to `sessionId`, replacing any earlier attachment. */
  attach(sessionId: SessionId): { ok: boolean; reason?: string } {
    if (!this.configured()) return { ok: false, reason: 'not-configured' }
    if (this.runtime === null) {
      const runtime = this.createRuntime()
      if (runtime === null) return { ok: false, reason: 'not-configured' }
      this.runtime = runtime
    }
    this.registerQuestionProvider()
    this.runtime.mirror.attach(sessionId)
    this.activeSessionId = sessionId
    return { ok: true }
  }

  /** Detach the mirror when `sessionId` is the attached one. */
  detach(sessionId: SessionId): void {
    if (this.activeSessionId !== sessionId) return
    this.teardownRuntime()
  }

  /** Send one test message to prove the token + chat binding. */
  async test(): Promise<{ ok: boolean; description?: string }> {
    const settings = this.currentSettings()
    if (!this.configured()) return { ok: false, description: 'Telegram не настроен' }
    try {
      const bot = new BotClient(settings.botToken, settings.apiBaseUrl ?? TELEGRAM_API_BASE)
      const transport = new TelegramChatTransport(bot, settings.chatId)
      await transport.sendText('✅ Telegram-мост работает')
      return { ok: true }
    } catch (error: unknown) {
      return { ok: false, description: String(error) }
    }
  }

  // ── runtime lifecycle ──────────────────────────────────────────────────────

  private createRuntime(): BridgeRuntime | null {
    const settings = this.currentSettings()
    if (!this.configured()) return null
    const bot = new BotClient(settings.botToken, settings.apiBaseUrl ?? TELEGRAM_API_BASE)
    const transport = new TelegramChatTransport(bot, settings.chatId)
    const present: ToolPresenter = {
      presentCall: (name, rawArgs) => this.presentToolCall(name, rawArgs),
    }
    const mirror = new MirrorEngine(transport, present, { warn: message => this.ctx.logger.warn(message) })
    const questions = new TelegramQuestionProvider(transport, { warn: message => this.ctx.logger.warn(message) })
    return { bot, transport, mirror, questions }
  }

  /** Register the question channel; answers arrive only while a mirror is attached. */
  private registerQuestionProvider(): void {
    const runtime = this.runtime
    const userQuestions = this.ctx.get('userQuestions')
    if (runtime === null || userQuestions === undefined || this.questionProviderRegistered) return
    const provider: UserQuestionProvider = { ask: request => runtime.questions.ask(request) }
    runtime.questions.abortActive()
    this.questionProviderDispose = userQuestions.registerProvider(provider)
    this.questionProviderRegistered = true
  }

  private teardownRuntime(): void {
    const runtime = this.runtime
    this.runtime = null
    this.activeSessionId = null
    if (runtime === null) return
    runtime.mirror.detach()
    if (this.questionProviderRegistered) {
      runtime.questions.abortActive()
      this.questionProviderDispose?.()
      this.questionProviderDispose = null
      this.questionProviderRegistered = false
    }
  }

  private presentToolCall(name: string, rawArgs: string): { title: string; kind?: ToolCallKind } | undefined {
    const tools = this.ctx.get('tools')
    const tool = tools?.get(name)
    if (tool?.presentCall === undefined) return undefined
    let view: ReturnType<NonNullable<typeof tool.presentCall>>
    try {
      view = tool.presentCall(JSON.parse(rawArgs) as never)
    } catch {
      return undefined
    }
    if (view === undefined) return undefined
    if (view.card !== 'generic') return { title: view.title }
    return view.kind === undefined ? { title: view.title } : { title: view.title, kind: view.kind }
  }

  /** Re-derive the bot client from current settings and restart polling. */
  private restartPolling(): void {
    this.pollingAbort?.abort()
    this.pollingAbort = null
    if (this.runtime !== null) {
      // Settings changed under a live mirror: rebind the transport so the
      // mirror and question channel keep talking to the new client.
      this.teardownRuntime()
    }
    if (!this.configured()) return
    if (this.runtime === null) this.runtime = this.createRuntime()
    const controller = new AbortController()
    this.pollingAbort = controller
    void this.pollLoop(controller.signal)
  }

  private async pollLoop(signal: AbortSignal): Promise<void> {
    const runtime = this.runtime
    if (runtime === null) return
    let offset = 0
    while (!signal.aborted) {
      let updates
      try {
        updates = await runtime.bot.getUpdates(offset, signal)
      } catch (error: unknown) {
        this.ctx.logger.warn(`telegram polling error: ${String(error)}`)
        await sleep(RETRY_DELAY_MS, signal)
        continue
      }
      if (!updates.ok) {
        this.ctx.logger.warn(`telegram getUpdates failed: ${updates.description}`)
        if (updates.description.includes('Unauthorized')) return
        await sleep(RETRY_DELAY_MS, signal)
        continue
      }
      for (const update of updates.result) {
        offset = Math.max(offset, update.update_id + 1)
        if (update.message !== undefined) {
          void this.handleInboundMessage(update.message.chat.id, update.message.text)
        } else if (update.callback_query !== undefined) {
          void this.handleCallbackQuery(update.callback_query)
        }
      }
    }
  }

  private async handleInboundMessage(chatId: number, text: string | undefined): Promise<void> {
    const expected = this.currentSettings().chatId
    if (expected === '' || String(chatId) !== expected) return
    if (text === undefined) return
    const trimmed = text.trim()
    if (trimmed.startsWith('/start')) {
      await this.reply('Я — зеркало DeepSeek Harness. Включите зеркало сессии кнопкой в приложении, и ход работы будет приходить сюда.')
      return
    }
    if (this.runtime !== null && await this.runtime.questions.handleText(trimmed)) {
      return
    }
    if (this.activeSessionId === null) {
      await this.reply('Зеркало сейчас неактивно — откройте нужную сессию и нажмите иконку Telegram.')
      return
    }
    await this.relayUserMessage(this.activeSessionId, trimmed)
  }

  private async handleCallbackQuery(query: { id: string; message?: { chat: { id: number } }; data?: string }): Promise<void> {
    const chatId = query.message?.chat.id
    const expected = this.currentSettings().chatId
    if (chatId === undefined || expected === '' || String(chatId) !== expected) return
    const runtime = this.runtime
    if (runtime !== null && await runtime.questions.handleCallbackQuery(query.data)) {
      await this.ackCallback(query.id)
      return
    }
    await this.ackCallback(query.id, 'Этот вопрос больше неактивен')
  }

  private async relayUserMessage(sessionId: SessionId, text: string): Promise<void> {
    const agents = this.ctx.get('agents')
    const agent = agents?.get(sessionId)
    if (agent === undefined) {
      await this.reply('Сессия не запущена на компьютере — откройте её в приложении и попробуйте снова.')
      return
    }
    const message = createUserMessage({
      content: [{ type: 'text', text }],
      source: { kind: 'user' },
    })
    agent.followup(message)
  }

  private async reply(text: string): Promise<void> {
    const runtime = this.runtime
    if (runtime === null) return
    try {
      await runtime.transport.sendText(text)
    } catch (error: unknown) {
      this.ctx.logger.warn(`telegram reply failed: ${String(error)}`)
    }
  }

  private async ackCallback(queryId: string, text?: string): Promise<void> {
    const runtime = this.runtime
    if (runtime === null) return
    try {
      await runtime.bot.answerCallbackQuery(queryId, text === undefined ? {} : { text })
    } catch (error: unknown) {
      this.ctx.logger.warn(`telegram callback ack failed: ${String(error)}`)
    }
  }
}

/** Sleep that resolves early when the signal aborts (used between polling retries). */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve()
      return
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = (): void => {
      clearTimeout(timer)
      resolve()
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

export default TelegramBridgeService
