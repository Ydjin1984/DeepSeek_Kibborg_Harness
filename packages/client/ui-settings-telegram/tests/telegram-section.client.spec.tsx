// @vitest-environment jsdom
/**
 * TelegramSection behavior: the form saves the chat id and a non-empty token
 * draft into the settings scope, clears the token on demand, reports the
 * configured badge from the wire, and runs the connectivity test.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { act } from '@testing-library/react'
import { TelegramSection, type TelegramSectionProps } from '../src/client/TelegramSection.tsx'

afterEach(cleanup)

function t(key: string): string {
  return key
}

function okResult<T>(value: T): { result: { ok: true; value: T } } {
  return { result: { ok: true, value } }
}

interface ApiStub {
  status: ReturnType<typeof vi.fn>
  test: ReturnType<typeof vi.fn>
  attach: ReturnType<typeof vi.fn>
  detach: ReturnType<typeof vi.fn>
}

interface ScopeStub {
  set: ReturnType<typeof vi.fn>
  unset: ReturnType<typeof vi.fn>
  subscribe: ReturnType<typeof vi.fn>
  getSnapshot: ReturnType<typeof vi.fn>
}

interface SectionHarness {
  view: ReturnType<typeof render>
  api: ApiStub
  scope: ScopeStub
}

function props(overrides: Partial<{
  configured: boolean
  apiTestOk: boolean
  initialChatId: string
}> = {}): SectionHarness {
  const api = {
    status: vi.fn(async () => okResult({ configured: overrides.configured ?? false, attached: false })),
    test: vi.fn(async () => okResult({ ok: overrides.apiTestOk ?? true })),
    attach: vi.fn(async () => okResult({})),
    detach: vi.fn(async () => okResult({})),
  }
  const scope = {
    set: vi.fn(async () => {}),
    unset: vi.fn(async () => {}),
    subscribe: vi.fn(() => () => {}),
    getSnapshot: vi.fn(() => ({ value: { chatId: overrides.initialChatId ?? '42' } })),
  }
  const propsValue = { api, scope, t: t as never }
  const view = render(<TelegramSection {...propsValue as unknown as TelegramSectionProps} />)
  return { view, api, scope }
}

describe('TelegramSection', () => {
  it('renders the fields and the configured badge from the wire status', async () => {
    const { view, api } = props({ configured: true })
    expect(await view.findByLabelText('botTokenLabel')).not.toBeNull()
    expect(view.getByLabelText('chatIdLabel')).not.toBeNull()
    await vi.waitFor(() => expect(api.status).toHaveBeenCalled())
    expect(view.getByText('configured')).not.toBeNull()
    expect(view.getByText('chatIdHelp')).not.toBeNull()
  })

  it('saves the chat id and a non-empty token draft on submit', async () => {
    const { view, api, scope } = props({ configured: true, initialChatId: '' })
    const chatInput = await view.findByLabelText('chatIdLabel') as HTMLInputElement
    fireEvent.change(chatInput, { target: { value: '123' } })
    const tokenInput = view.getByLabelText('botTokenLabel') as HTMLInputElement
    fireEvent.change(tokenInput, { target: { value: 'secret-token' } })
    fireEvent.submit(view.container.querySelector('form') as HTMLFormElement)

    await vi.waitFor(() => expect(scope.set).toHaveBeenCalledWith('botToken', 'secret-token'))
    expect(scope.set).toHaveBeenCalledWith('chatId', '123')
    await vi.waitFor(() => expect(api.status).toHaveBeenCalled())
  })

  it('leaves an empty token field untouched on save', async () => {
    const { view, scope } = props({ initialChatId: '42' })
    fireEvent.submit(view.container.querySelector('form') as HTMLFormElement)
    await vi.waitFor(() => expect(scope.set).toHaveBeenCalledWith('chatId', '42'))
    expect(scope.set).not.toHaveBeenCalledWith('botToken', '')
  })

  it('clears the stored token on demand', async () => {
    const { view, scope } = props({ configured: true })
    const clear = await view.findByText('clearToken')
    fireEvent.click(clear)
    await vi.waitFor(() => expect(scope.unset).toHaveBeenCalledWith('botToken'))
  })

  it('runs the connectivity test and reports success', async () => {
    const { view, api } = props({ apiTestOk: true })
    const testButton = await view.findByText('test')
    await act(async () => {
      fireEvent.click(testButton)
    })
    expect(api.test).toHaveBeenCalledWith({})
    expect(view.getByText('testOk')).not.toBeNull()
  })
})
