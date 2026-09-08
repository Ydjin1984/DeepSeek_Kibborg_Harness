/**
 * Telegram settings plugin, browser half. Registers the Telegram section
 * whose form writes the `telegram` settings namespace (bot token + chat id)
 * and drives the bridge test through the wire `telegram` API.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls the shell's SlotMap merge (the 'settings.section' entry).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { TelegramSection } from './TelegramSection.tsx'
import type { TelegramSectionInjected, TelegramUserSettings } from './TelegramSection.tsx'
import { en, ru, zh, type TelegramSettingsKey } from './locales.ts'

export type { TelegramSectionInjected, TelegramSectionProps, TelegramUserSettings } from './TelegramSection.tsx'
export type { TelegramSettingsKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The Telegram settings page copy. */
    'settings.telegram': TelegramSettingsKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'settings.telegram'

/** Settings namespace the bridge reads its binding from. */
const SETTINGS_NAMESPACE = 'telegram'

/**
 * Required services (cordis fiber inject). Registration depends on the
 * `settings.section` declaration through `slots.inject()`.
 */
export const inject = ['slots', 'locale', 'connection', 'settingsScope']

/**
 * Register the Telegram section once the `settings.section` declaration is on
 * the ledger.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en, ru }), 'ui-settings-telegram: copy dictionaries')

  const connection = ctx.get('connection') as ConnectionHandle
  const scope = ctx.settingsScope.bind<TelegramUserSettings>({ namespace: SETTINGS_NAMESPACE })
  const t = ctx.locale.bind(NS) as TelegramSectionInjected['t']
  const injected = (): TelegramSectionInjected => ({
    api: connection.api.telegram,
    scope,
    t,
  })

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'telegram',
    order: 30,
    label: () => t('nav'),
    inject: injected,
  }, TelegramSection))
}
