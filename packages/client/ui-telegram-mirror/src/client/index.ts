/**
 * Telegram mirror toggle plugin, browser half. Registers the mirror button
 * into the composer tool row (`conversation.input.left`); one click attaches
 * or detaches the mirror of the current session through the wire `telegram`
 * API.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls the shell's SlotMap merge (the composer tool row entries).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { TelegramMirrorButton } from './TelegramMirrorButton.tsx'
import type { TelegramMirrorInjected } from './TelegramMirrorButton.tsx'
import { en, ru, zh, type TelegramMirrorKey } from './locales.ts'

export type { TelegramMirrorButtonProps, TelegramMirrorInjected } from './TelegramMirrorButton.tsx'
export type { TelegramMirrorKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The Telegram mirror toggle copy. */
    'telegram.mirror': TelegramMirrorKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'telegram.mirror'

/**
 * Required services (cordis fiber inject). Registration depends on the
 * `conversation.input.left` declaration through `slots.inject()`.
 */
export const inject = ['slots', 'locale', 'connection']

/**
 * Register the Telegram mirror toggle into the composer tool row.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en, ru }), 'ui-telegram-mirror: copy dictionaries')

  const connection = ctx.get('connection') as ConnectionHandle
  const injected = (): TelegramMirrorInjected => ({ api: connection.api.telegram })

  ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
    name: 'conversation.input.left',
    id: 'telegram-mirror',
    order: 10,
    locale: NS,
    inject: injected,
  }, TelegramMirrorButton))
}
