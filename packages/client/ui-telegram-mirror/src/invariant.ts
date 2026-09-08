/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-ui-telegram-mirror`.
 * @module @deepseek-ai/dsh-client-ui-telegram-mirror/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-telegram-mirror'

/** Cordis companion plugin name. */
export const name = 'ui-telegram-mirror-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the toggle drives the mirror only through the
 * telegram wire API; the package owns no independent event/durable
 * relationship to assert.
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
