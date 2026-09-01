/**
 * ui-compact browser half on a real SlotRegistry: the plugin occupies the
 * conversation-declared `conversation.input.right` list seat with the composer
 * compact button; the injected face executes /compact and folds admission
 * outcomes into the normalized CompactOutcome; teardown empties the seat (HMR
 * safety). Node-half apply and the invariant companion stay inert.
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { CompactControl } from '../src/client/CompactControl.tsx'
import type { CompactControlInjected } from '../src/client/index.ts'
import { apply, inject } from '../src/client/index.ts'
import { apply as nodeApply } from '../src/index.ts'

const SID = 's-compact' as SessionId

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const slots = ctx.get('slots') as SlotRegistry
  slots.register({
    name: 'root',
    children: { 'conversation.input.right': { kind: 'list', scope: 'session' } },
  } as never, () => null)
  const execute = vi.fn((_sessionId: SessionId, _line: string) =>
    Promise.resolve({
      ok: true as const,
      value: { commandId: 'c1', result: { kind: 'success' as const } },
    }))
  const commandsRemote = { execute }
  ctx.provide('remote', { commands: commandsRemote })
  ctx.provide('remote.commands', commandsRemote)
  ctx.provide('locale', new LocaleRuntime(ctx))
  return { ctx, slots, execute }
}

describe('ui-compact browser apply', () => {
  it('declares every service it binds', () => {
    expect(inject).toEqual(['slots', 'remote', 'remote.commands', 'locale'])
  })

  it('node-half apply is an intentional no-op', () => {
    expect(() => { nodeApply() }).not.toThrow()
  })

  it('waits until conversation declares the input seat', async () => {
    const ctx = new Context()
    await ctx.plugin(SlotRegistry).await()
    ctx.provide('remote', { commands: {} })
    ctx.provide('remote.commands', {})
    ctx.provide('locale', new LocaleRuntime(ctx))
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(ctx.slots.entries('conversation.input.right')).toHaveLength(0)
    ctx.slots.register({
      name: 'root', children: { 'conversation.input.right': { kind: 'list', scope: 'session' } },
    } as never, () => null)
    await Promise.resolve()
    expect(ctx.slots.entries('conversation.input.right')).toHaveLength(1)
    await fiber.dispose()
  })

  it('registers the button, executes /compact, and unregisters on teardown', async () => {
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    const entry = b.slots.entries('conversation.input.right')[0]!
    expect(entry.component).toBe(CompactControl)
    const injected = (entry.inject as unknown as (id: SessionId) => CompactControlInjected)(SID)

    await expect(injected.compact()).resolves.toEqual({ kind: 'success' })
    expect(b.execute).toHaveBeenLastCalledWith(SID, '/compact', [])

    // Business failure folds to a user-visible error line.
    b.execute.mockResolvedValueOnce({
      ok: false,
      error: { code: 'session-not-found', message: 'gone', details: {} },
    } as never)
    await expect(injected.compact()).resolves.toEqual({
      kind: 'error',
      text: 'gone (session-not-found)',
    })

    // Unmatched admission (no /compact command composed host-side) is a
    // distinct outcome.
    b.execute.mockResolvedValueOnce({ ok: true, value: undefined } as never)
    await expect(injected.compact()).resolves.toEqual({ kind: 'unmatched' })

    await fiber.dispose()
    expect(b.slots.entries('conversation.input.right')).toHaveLength(0)
  })
})
