/** Package-owned execution SM invariant: manifest registration only.
 * v1 is projection-only — the invariant will check SM consistency in v2
 * when concrete source adapters are installed.
 * @module @deepseek-ai/dsh-execution/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-execution'

/** Cordis companion plugin name. */
export const name = 'execution-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** Install function — v1 registers manifest name only. */
const install: InvariantInstaller = Object.assign((_ctx: Context, _fail: InvariantFailure) => {
  // v1: No runtime invariant to check (projection-only layer).
  // v2: Will verify SM consistency against source adapters.
}, { inject: ['executions'] })

/**
 * Register the execution invariant companion. Duplicate registration throws
 * synchronously (the invariants service reserves the package name).
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
