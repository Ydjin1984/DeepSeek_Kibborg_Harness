/**
 * Tests for the execution-persistence invariant companion registration.
 * @module @deepseek-ai/dsh-execution-persistence/invariant.spec
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as PersistenceInvariantCompanion from '../src/invariant.ts'

async function setup(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(InvariantRegistry, { enabled: true })
  return ctx
}

describe('execution-persistence invariant', () => {
  it('exports the companion name and inject list', () => {
    expect(PersistenceInvariantCompanion.name).toBe('execution-persistence-invariant')
    expect(PersistenceInvariantCompanion.inject).toEqual(['invariants'])
  })

  it('apply registers the manifest and mounts the no-op installer', async () => {
    const ctx = await setup()
    const disposer = await PersistenceInvariantCompanion.apply(ctx)
    expect(typeof disposer).toBe('function')
    disposer()
  })

  it('rejects a second registration of the same package', async () => {
    const ctx = await setup()
    await PersistenceInvariantCompanion.apply(ctx)
    expect(() => { void PersistenceInvariantCompanion.apply(ctx) }).toThrow(/already registered/)
  })
})
