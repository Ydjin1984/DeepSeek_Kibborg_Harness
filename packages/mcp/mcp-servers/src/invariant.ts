/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-mcp-servers`.
 * @module @deepseek-ai/dsh-mcp-servers/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-mcp-servers'

/** Cordis companion plugin name. */
export const name = 'mcp-servers-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: MCP server deployment contributes through the tool
 * registry and the `mcp-client` generations it owns; the registry keeps no
 * independent server-to-tool snapshot after an asynchronous resync.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
