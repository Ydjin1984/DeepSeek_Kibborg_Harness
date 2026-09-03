/**
 * Workspace file panel plugin, browser half: one occupant of the composer
 * tool row (`conversation.input.left`, list seat) that owns the right-side
 * file drawer, the drag-into-composer file attach path, and the Markdown
 * viewer/editor. The occupant's session-scoped inject face binds the three
 * host project-file verbs (listChildren / readTextFile / writeTextFile) to
 * its own session, so the panel never reads a path the session did not open.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the ui-conversation SlotMap merge (the input.left entry).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ConnectionHandle, SessionId } from '@deepseek-ai/dsh-client-connection/client'
import { FilesPanelButton, type FilesInjected } from './FilesPanelButton.tsx'
import { en, NS, ru, zh } from './locales.ts'

/** Required services: the slot registry, the locale dictionary seat, and the host connection. */
export const inject = ['slots', 'locale', 'connection']

/**
 * Bind the host project-file verbs to one session.
 * @param ctx - client root context carrying the connection handle.
 * @param sessionId - the occupant's session; the containment root for every path.
 * @returns the injected verb table.
 */
function makeFilesInjected(ctx: ClientContext, sessionId: SessionId): FilesInjected {
  const api = (ctx.get('connection') as ConnectionHandle).api
  return {
    async listChildren(path, signal) {
      const response = await api.host.listChildren({ sessionId, path }, signal)
      // Let listing failures surface: the tree row marks the folder failed and
      // offers a retry instead of silently rendering an empty folder.
      if (!response.result.ok) throw new Error(response.result.error.message)
      return response.result.value.entries
    },
    async readTextFile(path) {
      const response = await api.host.readTextFile({ sessionId, path })
      if (response.result.ok) return { ok: true, text: response.result.value.text }
      return { ok: false, code: response.result.error.code, message: response.result.error.message }
    },
    async writeTextFile(path, text) {
      const response = await api.host.writeTextFile({ sessionId, path, text })
      if (response.result.ok) return { ok: true }
      return { ok: false, message: response.result.error.message }
    },
  }
}

/**
 * Client plugin body: register dictionaries and the single tool-row occupant.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en, ru }), 'ui-files: dictionaries')

  ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
    name: 'conversation.input.left',
    id: 'files',
    order: 10,
    locale: NS,
    inject: (sessionId: SessionId): FilesInjected => makeFilesInjected(ctx, sessionId),
  }, FilesPanelButton))
}
