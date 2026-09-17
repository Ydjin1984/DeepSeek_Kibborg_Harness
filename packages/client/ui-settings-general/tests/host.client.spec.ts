import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { installUiDebugSink, isUiDebugEnabled, resetUiDebugForTests } from '@deepseek-ai/dsh-debug-log'
import { SettingsProvider, settingsNamespace, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import { apply, decodeUiDebugSettings, UI_DEBUG_SETTINGS_NAMESPACE } from '../src/index.ts'

/** Mirrors the module-local namespace id in src/index.ts. */
const ONBOARDING_SETTINGS_NAMESPACE = 'ui-onboarding'

afterEach(() => {
  resetUiDebugForTests()
})

class MemorySettings extends SettingsProvider {
  readonly writable = true
  protected load(): Promise<Record<string, unknown>> { return Promise.resolve({}) }
  protected persist(_ns: SettingsNamespace, _section: Record<string, unknown>): Promise<void> {
    return Promise.resolve()
  }
}

describe('ui-settings-general host', () => {
  it('registers and disposes the durable onboarding namespace with its fiber', async () => {
    const ctx = new Context()
    await ctx.plugin(MemorySettings).await()
    const fiber = ctx.plugin({ apply })
    await fiber.await()
    expect(ctx.settings.describe().map(row => row.ns)).toContain(
      settingsNamespace(ONBOARDING_SETTINGS_NAMESPACE),
    )
    await fiber.dispose()
    expect(ctx.settings.describe().map(row => row.ns)).not.toContain(
      settingsNamespace(ONBOARDING_SETTINGS_NAMESPACE),
    )
  })

  it('registers ui-debug off by default, enables the tracer on update, and clears it on dispose', async () => {
    const stopSink = installUiDebugSink(() => {})
    const ctx = new Context()
    await ctx.plugin(MemorySettings).await()
    const fiber = ctx.plugin({ apply })
    await fiber.await()
    const ns = settingsNamespace(UI_DEBUG_SETTINGS_NAMESPACE)
    expect(ctx.settings.describe().map(row => row.ns)).toContain(ns)
    expect(ctx.settings.get(ns)).toEqual({ enabled: false })
    expect(isUiDebugEnabled()).toBe(false)
    await ctx.settings.update(ns, { enabled: true })
    await vi.waitFor(() => { expect(isUiDebugEnabled()).toBe(true) })
    await fiber.dispose()
    expect(isUiDebugEnabled()).toBe(false)
    expect(ctx.settings.describe().map(row => row.ns)).not.toContain(ns)
    stopSink()
  })
})

describe('decodeUiDebugSettings', () => {
  it('accepts an object and rejects a non-object', () => {
    expect(decodeUiDebugSettings({ enabled: true })).toEqual({ enabled: true })
    expect(decodeUiDebugSettings({ enabled: false })).toEqual({ enabled: false })
    expect(decodeUiDebugSettings({ enabled: 'yes' })).toEqual({ enabled: false })
    expect(decodeUiDebugSettings(null)).toBeUndefined()
    expect(decodeUiDebugSettings('no')).toBeUndefined()
  })
})
