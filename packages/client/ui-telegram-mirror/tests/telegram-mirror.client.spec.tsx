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

  it('swallows an aborted status probe without an unhandled rejection', async () => {
    const abort = Object.assign(new Error('The user aborted a request.'), { name: 'AbortError' })
    const api = {
      status: vi.fn(() => Promise.reject(abort)),
      attach: vi.fn(),
      detach: vi.fn(),
    }
    const runtime = {
      useSession: (selector: (snapshot: { sessionId: string; removed: boolean }) => unknown) =>
        selector({ sessionId: 's1', removed: false }),
    }
    const button = (): TelegramMirrorButtonProps => ({ ...runtime, api, t: t as never } as unknown as TelegramMirrorButtonProps)
    const view = render(<TelegramMirrorButton {...button()} />)
    await Promise.resolve()
    await Promise.resolve()
    const trigger = await triggerOf(view)
    expect(trigger.disabled).toBe(true)
    expect(api.attach).not.toHaveBeenCalled()
  })

  it('treats a non-abort probe failure as unconfigured', async () => {
    const api = {
      status: vi.fn(() => Promise.reject(new Error('network'))),
      attach: vi.fn(),
      detach: vi.fn(),
    }
    const runtime = {
      useSession: (selector: (snapshot: { sessionId: string; removed: boolean }) => unknown) =>
        selector({ sessionId: 's1', removed: false }),
    }
    const button = (): TelegramMirrorButtonProps => ({ ...runtime, api, t: t as never } as unknown as TelegramMirrorButtonProps)
    const view = render(<TelegramMirrorButton {...button()} />)
    const trigger = await triggerOf(view)
    await vi.waitFor(() => expect(trigger.disabled).toBe(true))
    expect(trigger.getAttribute('aria-label')).toBe('notConfiguredTitle')
  })

  it('swallows an aborted attach without flipping on', async () => {
    const abort = Object.assign(new Error('The user aborted a request.'), { name: 'AbortError' })
    const { view, api } = props({ configured: true, attached: false })
    api.attach.mockRejectedValueOnce(abort)
    const trigger = await triggerOf(view)
    await vi.waitFor(() => expect(trigger.disabled).toBe(false))
    fireEvent.click(trigger)
    await Promise.resolve()
    await Promise.resolve()
    expect(trigger.getAttribute('aria-pressed')).toBe('false')
  })

  it('aborts the in-flight status probe on unmount', async () => {
    let seen: AbortSignal | undefined
    const api = {
      status: vi.fn((_payload: unknown, signal?: AbortSignal) => {
        seen = signal
        return new Promise(() => {})
      }),
      attach: vi.fn(),
      detach: vi.fn(),
    }
    const runtime = {
      useSession: (selector: (snapshot: { sessionId: string; removed: boolean }) => unknown) =>
        selector({ sessionId: 's1', removed: false }),
    }
    const button = (): TelegramMirrorButtonProps => ({ ...runtime, api, t: t as never } as unknown as TelegramMirrorButtonProps)
    const view = render(<TelegramMirrorButton {...button()} />)
    await Promise.resolve()
    expect(seen).toBeDefined()
    expect(seen?.aborted).toBe(false)
    view.unmount()
    expect(seen?.aborted).toBe(true)
  })

  it('drops a status result that lands after unmount', async () => {
    const api = {
      status: vi.fn((_payload: unknown, signal?: AbortSignal) => new Promise((resolve) => {
        signal?.addEventListener('abort', () => {
          resolve(okResult({ configured: true, attached: true }))
        })
      })),
      attach: vi.fn(),
      detach: vi.fn(),
    }
    const runtime = {
      useSession: (selector: (snapshot: { sessionId: string; removed: boolean }) => unknown) =>
        selector({ sessionId: 's1', removed: false }),
    }
    const button = (): TelegramMirrorButtonProps => ({ ...runtime, api, t: t as never } as unknown as TelegramMirrorButtonProps)
    const view = render(<TelegramMirrorButton {...button()} />)
    await Promise.resolve()
    view.unmount()
    await Promise.resolve()
    await Promise.resolve()
  })

  it('leaves the toggle on when detach is aborted', async () => {
    const abort = Object.assign(new Error('The user aborted a request.'), { name: 'AbortError' })
    const { view, api } = props({ configured: true, attached: true })
    api.detach.mockRejectedValueOnce(abort)
    const trigger = await triggerOf(view)
    await vi.waitFor(() => expect(trigger.getAttribute('aria-pressed')).toBe('true'))
    fireEvent.click(trigger)
    await Promise.resolve()
    await Promise.resolve()
    expect(trigger.getAttribute('aria-pressed')).toBe('true')
  })

  it('leaves the toggle off when attach throws a transport error', async () => {
    const { view, api } = props({ configured: true, attached: false })
    api.attach.mockRejectedValueOnce(new Error('network'))
    const trigger = await triggerOf(view)
    await vi.waitFor(() => expect(trigger.disabled).toBe(false))
    fireEvent.click(trigger)
    await Promise.resolve()
    await Promise.resolve()
    expect(trigger.getAttribute('aria-pressed')).toBe('false')
  })
})
