import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as CompactInvariant from '../src/invariant.ts'

describe('ui-compact invariant companion', () => {
  it('registers the empty installer and keeps the node half inert', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await expect(ctx.plugin(CompactInvariant).await()).resolves.toBeDefined()
    const { apply } = await import('../src/index.ts')
    apply()
    await ctx.fiber.dispose()
  })
})
