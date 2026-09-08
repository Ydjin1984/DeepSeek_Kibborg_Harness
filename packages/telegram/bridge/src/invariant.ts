/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-telegram-bridge`.
 * @module @deepseek-ai/dsh-telegram-bridge/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-telegram-bridge'

/** Cordis companion plugin name. */
export const name = 'telegram-bridge-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant to assert: the bridge only mirrors events already
 * emitted by the session seam and relays answers through the userQuestions
 * channel, and the settings namespace it registers is validated by the
 * settings provider; the bridge itself owns no independent event/durable
 * relationship a companion could check.
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
