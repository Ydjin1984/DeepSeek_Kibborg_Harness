/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-llm-openrouter-free`.
 * @module @deepseek-ai/dsh-llm-openrouter-free/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-llm-openrouter-free'

/** Cordis companion plugin name. */
export const name = 'llm-openrouter-free-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this package appends no session event and owns no
 * durable relation beyond its own ledger file, whose read boundary revalidates
 * every field it accepts (`readUsage`) and whose write boundary is one atomic
 * rename. The pool's correctness relation — a model is selectable only with
 * budget left — is enforced by the operation that selects (limits.ts) and
 * covered by its unit suite.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
