/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-ui-files`.
 * @module @deepseek-ai/dsh-client-ui-files/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-files'

/** Cordis companion plugin name. */
export const name = 'client-ui-files-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the plugin's one `conversation.input.left` occupant
 * registers with the framework's own disposal tracking (HMR-safe by the
 * platform's registration contract); the package owns no cordis event stream,
 * no cross-plugin mutable service, and no durable state of its own.
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
