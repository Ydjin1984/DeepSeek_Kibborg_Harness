// @vitest-environment jsdom
/**
 * ui-files browser half: occupant registration into the declared
 * `conversation.input.left` list seat, locale dictionary registration, and
 * fiber-teardown removal (HMR safety).
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { apply as applyNodeHalf } from '../src/index.ts'
import { apply, inject } from '../src/client/index.ts'

interface Capture {
  slots: SlotRegistry
  dictionaries: Array<{ namespace: string; dictionaries: unknown }>
  localeDisposed: boolean
}

/** Provide presentation registries and capture the plugin's registrations. */
function providePresentation(ctx: Context): Capture {
  const slots = new SlotRegistry(ctx)
  // The composer tool row seat ui-files occupies; ui-conversation declares it
  // in production, so the test root declares it here for the contribution to land.
  slots.register({
    name: 'root',
    children: {
      'conversation.input.left': { kind: 'list', scope: 'session', owner: {} },
    },
  } as never, () => null)
  const capture: Capture = { slots, dictionaries: [], localeDisposed: false }
  ctx.provide('locale', {
    register(namespace: string, dictionaries: unknown) {
      capture.dictionaries.push({ namespace, dictionaries })
      return () => { capture.localeDisposed = true }
    },
    bind: () => (key: string) => key,
    getLocale: () => ({ active: 'en' as const, locales: [], revision: 0 }),
  })
  return capture
}

describe('ui-files node half', () => {
  it('provides an inert host apply (browser half owns the plugin)', () => {
    applyNodeHalf()
  })
})

describe('ui-files browser apply', () => {
  it('registers one occupant into conversation.input.left and its dictionaries', async () => {
    const ctx = new Context()
    const capture = providePresentation(ctx)
    ctx.provide('connection', { api: {} })
    await ctx.plugin({ inject: [...inject], apply }).await()

    const entries = capture.slots.entries('conversation.input.left')
    expect(entries).toHaveLength(1)
    expect(entries[0]?.options).toMatchObject({ id: 'files' })
    expect(capture.dictionaries.some(entry => entry.namespace === 'files')).toBe(true)
  })

  it('removes the occupant and dictionaries with the plugin fiber', async () => {
    const ctx = new Context()
    const capture = providePresentation(ctx)
    ctx.provide('connection', { api: {} })
    const plugin = ctx.plugin({ inject: [...inject], apply })
    await plugin.await()

    expect(capture.slots.entries('conversation.input.left')).toHaveLength(1)
    await plugin.dispose()
    expect(capture.slots.entries('conversation.input.left')).toHaveLength(0)
    expect(capture.localeDisposed).toBe(true)
  })

  it('binds the host verbs to the session and surfaces host errors', async () => {
    const ctx = new Context()
    const capture = providePresentation(ctx)
    const signal = new AbortController().signal
    const host = {
      listChildren: vi.fn()
        .mockResolvedValueOnce({ result: { ok: true as const, value: { entries: [{ name: 'a.md', kind: 'file' }] } } })
        .mockResolvedValueOnce({ result: { ok: false as const, error: { code: 'list-failed', message: 'no' } } }),
      readTextFile: vi.fn()
        .mockResolvedValueOnce({ result: { ok: true as const, value: { text: 'hi' } } })
        .mockResolvedValueOnce({ result: { ok: false as const, error: { code: 'file-not-text', message: '' } } }),
      writeTextFile: vi.fn()
        .mockResolvedValueOnce({ result: { ok: true as const } })
        .mockResolvedValueOnce({ result: { ok: false as const, error: { code: 'write-failed', message: 'nope' } } }),
    }
    ctx.provide('connection', { api: { host } })
    await ctx.plugin({ inject: [...inject], apply }).await()

    const entry = capture.slots.entries('conversation.input.left')[0]
    const bind = (entry as unknown as { inject?: (sessionId: string) => {
      listChildren: (path: string, signal: AbortSignal) => Promise<unknown>
      readTextFile: (path: string) => Promise<{ ok: boolean; text?: string; code?: string; message?: string }>
      writeTextFile: (path: string, text: string) => Promise<{ ok: boolean; message?: string }>
    } }).inject
    expect(bind).toBeDefined()
    const verbs = bind?.('s1')
    expect(verbs).toBeDefined()

    await expect(verbs?.listChildren('/p', signal)).resolves.toEqual([{ name: 'a.md', kind: 'file' }])
    await expect(verbs?.listChildren('/p', signal)).rejects.toThrow('no')

    await expect(verbs?.readTextFile('/p/a.md')).resolves.toEqual({ ok: true, text: 'hi' })
    await expect(verbs?.readTextFile('/p/a.md')).resolves.toEqual({ ok: false, code: 'file-not-text', message: '' })

    await expect(verbs?.writeTextFile('/p/a.md', 'x')).resolves.toEqual({ ok: true })
    await expect(verbs?.writeTextFile('/p/a.md', 'x')).resolves.toEqual({ ok: false, message: 'nope' })
  })
})
