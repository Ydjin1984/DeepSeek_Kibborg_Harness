/** MCP settings section registration: slot declaration injection and the locale-following label thunk. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import { apply as settingsApply, inject as settingsInject } from '@deepseek-ai/dsh-client-ui-settings/client'
import { apply, inject } from '@deepseek-ai/dsh-client-ui-settings-mcp/client'
import { McpSection } from '../src/client/McpSection.tsx'

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  locale.setLocale('en')
  ctx.provide('locale', locale)
  new TestRemote(ctx)
  ctx.provide('connection', {
    api: { mcp: {} },
    isLoopback: true,
  } as never)
  await ctx.plugin({ inject: [...settingsInject], apply: settingsApply }).await()
  return { ctx, slots: ctx.get('slots') as SlotRegistry, locale }
}

function declare(slots: SlotRegistry): () => void {
  return slots.register(
    {
      name: 'root',
      children: {
        'settings.section': { kind: 'list', scope: 'root' },
      },
    } as never,
    () => null,
  )
}

describe('ui-settings-mcp apply', () => {
  it('declares the services it uses', () => {
    expect(inject).toEqual(['slots', 'locale', 'connection'])
  })

  it('registers the MCP nav entry and wires its inject face', async () => {
    const before = await bench()
    declare(before.slots)
    await before.ctx.plugin({ inject: [...inject], apply }).await()
    const entry = before.slots.entries('settings.section')[0]!
    expect(entry.component).toBe(McpSection)
    expect(entry.options).toMatchObject({ id: 'mcp', order: 25 })
    expect(resolveSlotLabel(entry.options.label)).toBe('MCP servers')
    const injected = (
      entry.inject as unknown as () => import('../src/client/McpSection.tsx').McpSectionInjected
    )()
    expect(injected.t('nav')).toBe('MCP servers')
    expect(injected.api.mcp).toBeDefined()

    // The nav label follows the active locale without re-registration.
    const after = await bench()
    declare(after.slots)
    await after.ctx.plugin({ inject: [...inject], apply }).await()
    after.locale.setLocale('ru')
    expect(resolveSlotLabel(after.slots.entries('settings.section')[0]!.options.label)).toBe('MCP-серверы')
  })
})
