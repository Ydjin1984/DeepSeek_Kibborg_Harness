/**
 * MCP servers settings plugin, browser half. It registers the MCP servers
 * section whose rows come from the Host registry API (`mcp.list`/`mcp.save`/
 * `mcp.remove`) — the same registry `@deepseek-ai/dsh-mcp-servers` deploys
 * from on the Host.
 * Export discipline: packages/client/AGENTS.md.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls the shell's SlotMap merge (the 'settings.section' entry).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { McpSection } from './McpSection.tsx'
import type { McpSectionInjected } from './McpSection.tsx'
import { en, ru, zh, type McpKey } from './locales.ts'

export type { McpSectionInjected, McpSectionProps } from './McpSection.tsx'
export type { McpKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The MCP servers settings page copy. */
    'settings.mcp': McpKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'settings.mcp'

/**
 * Required services (cordis fiber inject). Registration depends on the
 * `settings.section` declaration through `slots.inject()`.
 */
export const inject = ['slots', 'locale', 'connection']

/**
 * Register the MCP servers section once the `settings.section` declaration is
 * on the ledger, wiring it to the registry wire API.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en, ru }), 'ui-settings-mcp: copy dictionaries')

  const connection = ctx.get('connection') as ConnectionHandle
  const t = ctx.locale.bind(NS) as McpSectionInjected['t']
  const injected = (): McpSectionInjected => ({
    api: { mcp: connection.api.mcp },
    t,
  })

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'mcp',
    order: 25,
    label: () => t('nav'),
    inject: injected,
  }, McpSection))
}
