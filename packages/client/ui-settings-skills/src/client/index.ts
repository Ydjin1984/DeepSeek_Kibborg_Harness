/**
 * Skills Manager settings surface, browser half: one Settings section that
 * lists, searches, edits, versions, benchmarks, and trashes the managed
 * skills the host's skill-manager service owns. All data flows through the
 * shared wire client (`ctx.connection.api`); the section keeps its catalog
 * snapshot in local state and re-reads after every mutation, because a
 * reading gesture has no cross-entry state to share.
 * Export discipline: packages/client/AGENTS.md.
 */

import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the settings shell's SlotMap merge (the 'settings.section' entry).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { SkillsSettingsSection } from './SkillsSettingsSection.tsx'
import type { SkillsSectionInjected } from './SkillsSettingsSection.tsx'
import { createSkillsActions } from './skills-api.ts'
import { en, ru, zh, type SkillsLocaleKey } from './locales.ts'

export type { SkillsSectionInjected, SkillsSettingsSectionProps } from './SkillsSettingsSection.tsx'
export type { SkillsLocaleKey } from './locales.ts'
export type { SkillsActions, SkillWriteScope, SaveSkillInput, BenchmarkStartInput } from './skills-api.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Skills Manager section copy. */
    'settings.skills': SkillsLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'settings.skills'

/** Required services (cordis fiber inject). */
export const inject = ['slots', 'locale', 'connection']

/**
 * Register the Skills section once the `settings.section` declaration is on
 * the ledger, binding its actions to the shared wire client.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en, ru }), 'ui-settings-skills: copy dictionaries')

  const t = ctx.locale.bind(NS)
  const connection = ctx.get('connection') as ConnectionHandle
  const actions = createSkillsActions(connection.api)
  const injected = (): SkillsSectionInjected => ({
    actions,
    hooks: {
      locale: {
        getSnapshot: () => ctx.locale.getSnapshot().active,
        subscribe: listener => ctx.locale.subscribe(listener),
      },
    },
  })

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'skills',
    order: 16,
    label: () => t('nav'),
    locale: NS,
    inject: injected,
  }, SkillsSettingsSection))
}
