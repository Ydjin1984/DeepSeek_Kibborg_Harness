/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-typesafe-tool`.
 * @module @deepseek-ai/dsh-typesafe-tool/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-typesafe-tool'

/** Cordis companion plugin name. */
export const name = 'tool-typesafe-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this package writes no session event and owns no mutable data relation;
 * its only durable effect is a stateless outbound HTTP call.
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
