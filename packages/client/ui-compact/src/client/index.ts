/**
 * Context compaction control plugin, browser half: one composer button in the
 * `conversation.input.right` tool row. The button reads the host `compaction`
 * session projection (capability gate, auto-threshold, in-flight lock) and the
 * token-meter `contextPressure` occupancy, and executes the `/compact` host
 * command through the command Remote — the settled result renders as the
 * durable command/compaction flow node, so this plugin owns no store, no event
 * listener, and no refresh chain.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the generated Remote API and ctx.remote merge through the Client assembly boundary.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls the ui-conversation SlotMap merge (the input.right entry).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the `compaction` SessionProjectionMap key merge.
import type {} from '@deepseek-ai/dsh-compaction/client'
import type { CompactControlInjected, CompactOutcome } from './slots.ts'
import { CompactControl } from './CompactControl.tsx'
import { en, ru, zh } from './locales.ts'

export type { CompactControlInjected, CompactOutcome } from './slots.ts'
export type { CompactKey } from './locales.ts'

/** Dictionary namespace owned by this plugin. */
const NS = 'compact'

/** Required services: the slot registry, the command Remote (and its nested
 * `commands` Remote — the property proxy requires the dotted name in
 * `inject`, see docs/postmortem/0001), and locale. */
export const inject = ['slots', 'remote', 'remote.commands', 'locale']

/**
 * Client plugin body: register the composer compact button over the `/compact`
 * command Remote.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en, ru }), 'ui-compact: dictionaries')

  ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
    name: 'conversation.input.right',
    id: 'compact',
    locale: NS,
    inject: (sessionId): CompactControlInjected => ({
      compact: async (): Promise<CompactOutcome> => {
        const result = await ctx.remote.commands.execute(sessionId, '/compact', [])
        if (!result.ok) {
          return { kind: 'error', text: `${result.error.message} (${result.error.code})` }
        }
        if (result.value === undefined) return { kind: 'unmatched' }
        return result.value.result
      },
    }),
  }, CompactControl))
}
