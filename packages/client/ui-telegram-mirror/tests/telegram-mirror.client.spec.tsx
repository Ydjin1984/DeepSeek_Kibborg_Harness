// @vitest-environment jsdom
/**
 * TelegramMirrorButton behavior: it probes the wire status on mount, enables
 * once configured, attaches on click when off, detaches when on, and disables
 * while the bridge is unconfigured or the session is removed.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { TelegramMirrorButton, type TelegramMirrorButtonProps } from '../src/client/TelegramMirrorButton.tsx'

afterEach(cleanup)

function t(key: string): string {
  return key
}

function okResult<T>(value: T): { result: { ok: true; value: T } } {
  return { result: { ok: true, value } }
}

function errResult(code: string): { result: { ok: false; error: { code: string; message: string } } } {
  return { result: { ok: false, error: { code, message: code } } }
}

interface MirrorApi {
  status: ReturnType<typeof vi.fn>
  attach: ReturnType<typeof vi.fn>
  detach: ReturnType<typeof vi.fn>
}

interface MirrorHarness {
  view: ReturnType<typeof render>
  api: MirrorApi
}

function props(overrides: Partial<{
  configured: boolean
  attached: boolean
  removed: boolean
  attachOk: boolean
}> = {}): MirrorHarness {
  const configured = overrides.configured ?? true
  const api = {
    status: vi.fn(async () => okResult({ configured, attached: overrides.attached ?? false })),
    attach: vi.fn(async () => (overrides.attachOk ?? true) ? okResult({}) : errResult('telegram-not-configured')),
    detach: vi.fn(async () => okResult({})),
  }
  const runtime = {
    useSession: (selector: (snapshot: { sessionId: string; removed: boolean }) => unknown) =>
      selector({ sessionId: 's1', removed: overrides.removed ?? false }),
  }
  const button = (): TelegramMirrorButtonProps => ({ ...runtime, api, t: t as never } as unknown as TelegramMirrorButtonProps)
  const view = render(<TelegramMirrorButton {...button()} />)
  return { view, api }
}

async function triggerOf(view: ReturnType<typeof render>): Promise<HTMLButtonElement> {
  const trigger = view.container.querySelector<HTMLButtonElement>('button[title="title"]')
    ?? view.container.querySelector<HTMLButtonElement>('button[title="titleActive"]')
    ?? view.container.querySelector<HTMLButtonElement>('button[aria-label="notConfiguredTitle"]')
  if (trigger === null) throw new Error('mirror trigger not rendered')
  return trigger
}

describe('TelegramMirrorButton', () => {
  it('probes the wire and attaches on click when off', async () => {
    const { view, api } = props({ configured: true, attached: false })
    const trigger = await triggerOf(view)
    await vi.waitFor(() => expect(trigger.disabled).toBe(false))
    fireEvent.click(trigger)
    await vi.waitFor(() => expect(api.attach).toHaveBeenCalledWith({ sessionId: 's1' }))
    await vi.waitFor(() => expect(trigger.getAttribute('aria-pressed')).toBe('true'))
  })

  it('detaches on click when on', async () => {
    const { view, api } = props({ configured: true, attached: true })
    const trigger = await triggerOf(view)
    await vi.waitFor(() => expect(api.status).toHaveBeenCalled())
    fireEvent.click(trigger)
    await vi.waitFor(() => expect(api.detach).toHaveBeenCalledWith({ sessionId: 's1' }))
    await vi.waitFor(() => expect(trigger.getAttribute('aria-pressed')).toBe('false'))
  })

  it('disables while unconfigured and never calls attach', async () => {
    const { view, api } = props({ configured: false })
    const trigger = await triggerOf(view)
    await vi.waitFor(() => expect(trigger.disabled).toBe(true))
    fireEvent.click(trigger)
    expect(api.attach).not.toHaveBeenCalled()
  })

  it('stays disabled while the session is removed', async () => {
    const { view, api } = props({ configured: true, removed: true })
    const trigger = await triggerOf(view)
    await vi.waitFor(() => expect(api.status).toHaveBeenCalled())
    expect(trigger.disabled).toBe(true)
  })
})
