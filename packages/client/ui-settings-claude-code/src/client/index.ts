/**
 * Claude Code technology settings surface, browser half: one Settings section
 * that manages the ECC-derived skill library (.dsh/skills cc-* and cc-role-*)
 * through the shared wire client (`ctx.connection.api`). The section keeps its
 * catalog snapshot in local state and re-reads after every mutation, because a
 * reading gesture has no cross-entry state to share.
 * Export discipline: packages/client/AGENTS.md.
 */

import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the settings shell's SlotMap merge (the 'settings.section' entry).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { ClaudeCodeSection } from './ClaudeCodeSection.tsx'
import type { ClaudeCodeSectionInjected } from './ClaudeCodeSection.tsx'
import { createCcActions } from './claude-code-api.ts'
import { en, ru, zh, type ClaudeCodeLocaleKey } from './locales.ts'

export type { ClaudeCodeSectionInjected, ClaudeCodeSectionProps } from './ClaudeCodeSection.tsx'
export type { ClaudeCodeLocaleKey } from './locales.ts'
export type { CcActions } from './claude-code-api.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Claude Code technology section copy. */
    'settings.claudeCode': ClaudeCodeLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'settings.claudeCode'

/** Required services (cordis fiber inject). */
export const inject = ['slots', 'locale', 'connection']

/**
 * Register the Claude Code section once the `settings.section` declaration is
 * on the ledger, binding its actions to the shared wire client.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en, ru }), 'ui-settings-claude-code: copy dictionaries')

  const t = ctx.locale.bind(NS)
  const connection = ctx.get('connection') as ConnectionHandle
  const actions = createCcActions(connection.api)
  const injected = (): ClaudeCodeSectionInjected => ({ actions })

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'claude-code',
    order: 18,
    label: () => t('nav'),
    locale: NS,
    inject: injected,
  }, ClaudeCodeSection))
}
