// @vitest-environment jsdom
/** What the browser half registers, and that its actions delegate to the wire. */

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply, inject, NS } from '../src/client/index.ts'
import { ClaudeCodeSection } from '../src/client/ClaudeCodeSection.tsx'
import type { ClaudeCodeSectionInjected } from '../src/client/ClaudeCodeSection.tsx'

/** A settled bench: slot registry, zh locale, and a fake wire client. */
async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  locale.setLocale('zh')
  ctx.provide('locale', locale)
  const listManaged = vi.fn(() => Promise.resolve({ rpcId: 'r', result: { ok: true, value: { skills: [] } } }))
  const setEnabled = vi.fn(() => Promise.resolve({ rpcId: 'r', result: { ok: true, value: {} } }))
  ctx.provide('connection', {
    isLoopback: true,
    api: {
      skills: {
        listManaged, setEnabled,
        list: vi.fn(), read: vi.fn(), save: vi.fn(), remove: vi.fn(), restore: vi.fn(),
        permanentDelete: vi.fn(), versions: vi.fn(), rollback: vi.fn(),
        validate: vi.fn(), securityCheck: vi.fn(), benchmarkStart: vi.fn(), benchmarkPoll: vi.fn(),
        benchmarkCancel: vi.fn(), autoImprove: vi.fn(),
      },
    },
  } as never)
  return { ctx, slots: ctx.get('slots') as SlotRegistry, locale, listManaged, setEnabled }
}

function declareRoot(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: { 'settings.section': { kind: 'list', scope: 'root' } },
  } as never, () => null)
}

describe('ui-settings-claude-code apply', () => {
  it('declares the services it uses', () => {
    expect(inject).toEqual(['slots', 'locale', 'connection'])
  })

  it('registers one localized Claude Code section and binds its wire actions', async () => {
    const { ctx, slots, listManaged } = await bench()
    declareRoot(slots)
    await ctx.plugin({ inject: [...inject], apply }).await()

    const section = slots.entries('settings.section')[0]!
    expect(section.component).toBe(ClaudeCodeSection)
    expect(section.options).toMatchObject({ id: 'claude-code', order: 18 })
    expect(section.locale).toBe(NS)
    expect(resolveSlotLabel(section.options.label)).toBe('Claude Code')
    expect(listManaged).not.toHaveBeenCalled()

    const face = (section.inject as unknown as () => ClaudeCodeSectionInjected)()
    await expect(face.actions.listManaged('s' as never)).resolves.toEqual([])
    expect(listManaged).toHaveBeenCalledExactlyOnceWith({ sessionId: 's' })

    await ctx.fiber.dispose()
    expect(slots.entries('settings.section')).toHaveLength(0)
  })

  it('registers into a declaration that arrives after apply', async () => {
    const { ctx, slots } = await bench()
    await ctx.plugin({ inject: [...inject], apply }).await()

    declareRoot(slots)

    await vi.waitFor(() => { expect(slots.entries('settings.section')).toHaveLength(1) })
    await ctx.fiber.dispose()
  })

  it('collapses its contribution on teardown', async () => {
    const { ctx, slots } = await bench()
    declareRoot(slots)
    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(slots.entries('settings.section')).toHaveLength(1)

    await fiber.dispose()

    expect(slots.entries('settings.section')).toHaveLength(0)
  })
})
