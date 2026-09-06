/**
 * Tests for the execution invariant companion registration.
 * @module @deepseek-ai/dsh-execution/invariant.spec
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import ExecutionService from '../src/index.ts'
import * as ExecutionInvariantCompanion from '../src/invariant.ts'

async function setup(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(InvariantRegistry, { enabled: true })
  await ctx.plugin(ExecutionService)
  return ctx
}

describe('execution invariant', () => {
  it('exports the companion name and inject list', () => {
    expect(ExecutionInvariantCompanion.name).toBe('execution-invariant')
    expect(ExecutionInvariantCompanion.inject).toEqual(['invariants'])
  })

  it('apply registers the manifest and mounts the no-op installer', async () => {
    const ctx = await setup()
    // register() is thenable: awaiting apply resolves only after the child
    // installer fiber mounted, which runs the v1 no-op body without failures.
    const disposer = await ExecutionInvariantCompanion.apply(ctx)
    expect(typeof disposer).toBe('function')
    disposer()
  })

  it('rejects a second registration of the same package', async () => {
    const ctx = await setup()
    await ExecutionInvariantCompanion.apply(ctx)
    // register() reserves the name synchronously; the second apply throws.
    expect(() => { void ExecutionInvariantCompanion.apply(ctx) }).toThrow(/already registered/)
  })
})
