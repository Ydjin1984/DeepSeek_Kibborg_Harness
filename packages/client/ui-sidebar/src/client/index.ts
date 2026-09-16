/** Registers the sidebar shell into the layout-owned slot. */
import { createSnapshotStore, type ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { ServerStatus, SidebarRootInjected } from './contract/slots.ts'
import { SidebarRoot } from './SidebarRoot.tsx'
import { en, ru, zh, type SidebarKey } from './locales.ts'

export type {
  SidebarBrandMarkOwnerProps, SidebarBrandNameOwnerProps, SidebarFooterActionOwnerProps,
  SidebarRootComponentProps, SidebarRootInjected, SidebarSectionOwnerProps, SidebarSettingsOwnerProps,
} from './contract/slots.ts'
export type { SidebarKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Sidebar shell controls copy. */
    sidebar: SidebarKey
  }
}

/** Dictionary namespace owned by this plugin (shell controls copy). */
const NS = 'sidebar'

/** Services required by the sidebar plugin. */
export const inject = ['slots', 'layout', 'sessions', 'workspaces', 'locale']

/** Registers the sidebar shell and its service callbacks.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en, ru }), 'ui-sidebar: dictionaries')

  // Server connectivity status for the brand-mark indicator: a periodic health
  // check against the Host root. `unknown` (white) until the first check,
  // `alive` (blinking green) while it answers, `dead` (steady red) once it
  // stops responding. Polling keeps the light honest without relying on a
  // single transport's reconnect state.
  const serverStatus = createSnapshotStore<ServerStatus>('unknown')
  const checkServer = (): void => {
    // Non-browser runs (jsdom unit tests) have no fetch; report alive there,
    // matching a Host that has not yet failed a check.
    if (typeof fetch !== 'function') { serverStatus.set('alive'); return }
    fetch('/', { method: 'GET', cache: 'no-store' })
      .then((res) => { serverStatus.set(res.ok ? 'alive' : 'dead') })
      .catch(() => { serverStatus.set('dead') })
  }
  checkServer()
  const healthTimer = setInterval(checkServer, 3000)
  ctx.effect(() => () => clearInterval(healthTimer), 'ui-sidebar: server health check')

  const injectProps = (): SidebarRootInjected => ({
    // The shell's New Session button rides the runtime's shared action
    // (current Session Workspace, then recent Workspace).
    startSession: (workspaceId) => { ctx.workspaces.startSession(workspaceId) },
    toggleSidebar: () => { ctx.layout.toggleSidebar() },
    hooks: { serverStatus },
  })
  ctx.effect(
    () => ctx.slots.register({
      name: 'sidebar',
      locale: NS,
      // The shell owns geometry; ui-workspace registers the whole browsing
      // region (header, search, session list, workspace dialogs), ui-settings
      // registers the foot trigger + settings panel.
      children: {
        'sidebar.brand.mark': { kind: 'single', scope: 'root' },
        'sidebar.brand.name': { kind: 'single', scope: 'root' },
        'sidebar.workspaces': { kind: 'single', scope: 'root' },
        'sidebar.settings': { kind: 'single', scope: 'root' },
        'sidebar.footer.action': { kind: 'list', scope: 'root' },
      },
      inject: injectProps,
    }, SidebarRoot),
    'ui-sidebar: slot registration',
  )
}
