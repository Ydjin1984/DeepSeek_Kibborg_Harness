/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-engagement-stub`.
 * @module @deepseek-ai/dsh-engagement-stub/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-engagement-stub'

/** Cordis companion plugin name. */
export const name = 'engagement-stub-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the engagement contour is a pure pre-execute listener
 * with no package-local event history or mutable state beyond the seam it
 * intercepts.
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
