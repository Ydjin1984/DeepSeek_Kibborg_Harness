// @vitest-environment jsdom
/** OpenRouter Free settings: reads/writes the `openrouter-free` namespace and stores the API key. */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OpenRouterFreeSection } from '../src/client/OpenRouterFreeSection.tsx'
import type {
  OpenRouterFreeSectionProps, OpenRouterFreeSettingsView,
} from '../src/client/OpenRouterFreeSection.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

/** Translate through the English dictionary (params-free keys). */
function t(key: keyof typeof en): string {
  return en[key]
}

/** The pool view the host would report after one scan. */
const SETTINGS: OpenRouterFreeSettingsView = {
  enabled: true,
  providerRoute: 'openrouter',
  baseURL: 'https://openrouter.ai/api/v1',
  apiKeyEnv: 'OPENROUTER_API_KEY',
  refreshMinutes: 30,
  refreshNonce: 0,
  maxModels: 20,
  requestsPerDayPerModel: 50,
  scannedAt: 1_760_000_000_000,
  status: [
    {
      id: 'vendor/alpha:free',
      name: 'Alpha',
      contextLength: 262_144,
      requestsUsedToday: 3,
      requestsRemainingToday: 47,
      cooldownUntil: 0,
      state: 'ready',
    },
    {
      id: 'vendor/beta:free',
      name: 'Beta',
      contextLength: 65_536,
      requestsUsedToday: 50,
      requestsRemainingToday: 0,
      cooldownUntil: 1_700_000_000_000,
      state: 'cooling',
    },
  ],
}

function mount(options: {
  settings?: Partial<OpenRouterFreeSettingsView>
  keyConfigured?: boolean
  loadRejects?: string
  saveRejects?: string
  keyRejects?: string
} = {}) {
  const load = options.loadRejects === undefined
    ? vi.fn(() => Promise.resolve({
      settings: { ...SETTINGS, ...options.settings },
      credentialRef: 'OPENROUTER_API_KEY',
      keyConfigured: options.keyConfigured ?? false,
    }))
    : vi.fn(() => Promise.reject(new Error(options.loadRejects)))
  const save = options.saveRejects === undefined
    ? vi.fn((_patch: Partial<OpenRouterFreeSettingsView>) => Promise.resolve())
    : vi.fn((_patch: Partial<OpenRouterFreeSettingsView>) => Promise.reject(new Error(options.saveRejects)))
  const saveKey = options.keyRejects === undefined
    ? vi.fn((_value: string) => Promise.resolve())
    : vi.fn((_value: string) => Promise.reject(new Error(options.keyRejects)))
  const props = {
    close: () => {},
    load,
    save,
    saveKey,
    t,
  } as unknown as OpenRouterFreeSectionProps
  render(<OpenRouterFreeSection {...props} />)
  return { load, save, saveKey }
}

describe('OpenRouterFreeSection', () => {
  it('shows a placeholder until the namespace read settles', () => {
    mount()
    expect(screen.getByText('…')).toBeTruthy()
  })

  it('shows the load failure instead of a forever placeholder', async () => {
    mount({ loadRejects: 'settings transport unavailable' })
    expect((await screen.findByRole('alert')).textContent).toBe('settings transport unavailable')
  })

  it('renders the pool configuration and the reported free models', async () => {
    mount({ keyConfigured: true })
    await screen.findByRole('button', { name: t('openRouterSave') })
    expect(screen.getByRole('checkbox', { name: t('openRouterEnable') })).toBeTruthy()
    expect(screen.getByLabelText<HTMLInputElement>(t('openRouterRefreshMinutes')).value).toBe('30')
    expect(screen.getByLabelText<HTMLInputElement>(t('openRouterMaxModels')).value).toBe('20')
    expect(screen.getByLabelText<HTMLInputElement>(t('openRouterRequestsPerDay')).value).toBe('50')
    expect(screen.getByPlaceholderText(t('openRouterKeyConfigured'))).toBeTruthy()
    expect(screen.getByText(/vendor\/alpha:free/)).toBeTruthy()
    expect(screen.getByText(/47\/50/)).toBeTruthy()
    expect(screen.getByText(/\(rate limited\)/)).toBeTruthy()
  })

  it('reports an empty pool instead of an empty list', async () => {
    mount({ settings: { status: [] } })
    expect((await screen.findByRole('status')).textContent).toBe(t('openRouterNoModels'))
  })

  it('shows when the pool was last scanned and asks for a fresh scan on demand', async () => {
    const { save } = mount()
    await screen.findByRole('button', { name: t('openRouterSave') })
    expect(screen.getByText(new RegExp(t('openRouterScannedAt')))).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: t('openRouterRefreshNow') }))
    await screen.findByRole('status')
    const patch = save.mock.calls[0]![0] as OpenRouterFreeSettingsView
    expect(typeof patch.refreshNonce).toBe('number')
    expect(patch.refreshNonce).toBeGreaterThan(0)
  })

  it('says so when no scan has run yet', async () => {
    mount({ settings: { scannedAt: 0 } })
    await screen.findByRole('button', { name: t('openRouterSave') })
    expect(screen.getByText(t('openRouterNeverScanned'))).toBeTruthy()
  })

  it('persists the edited configuration', async () => {
    const { save } = mount()
    await screen.findByRole('button', { name: t('openRouterSave') })
    fireEvent.click(screen.getByRole('checkbox', { name: t('openRouterEnable') }))
    fireEvent.change(screen.getByLabelText<HTMLInputElement>(t('openRouterRequestsPerDay')), {
      target: { value: '80' },
    })
    fireEvent.click(screen.getByRole('button', { name: t('openRouterSave') }))
    await screen.findByRole('status')
    const patch = save.mock.calls[0]![0] as OpenRouterFreeSettingsView
    expect(patch.enabled).toBe(false)
    expect(patch.requestsPerDayPerModel).toBe(80)
  })

  it('surfaces a save failure', async () => {
    mount({ saveRejects: 'revision conflict' })
    await screen.findByRole('button', { name: t('openRouterSave') })
    fireEvent.click(screen.getByRole('button', { name: t('openRouterSave') }))
    expect((await screen.findByRole('alert')).textContent).toBe('revision conflict')
  })

  it('stores the key under the reference the route resolves', async () => {
    const { saveKey } = mount()
    await screen.findByRole('button', { name: t('openRouterSave') })
    const keyField = screen.getByLabelText<HTMLInputElement>(t('openRouterApiKey'))
    expect(screen.getByRole('button', { name: t('openRouterSaveKey') }).hasAttribute('disabled')).toBe(true)
    fireEvent.change(keyField, { target: { value: 'sk-or-test' } })
    fireEvent.click(screen.getByRole('button', { name: t('openRouterSaveKey') }))
    await screen.findByRole('status')
    expect(saveKey).toHaveBeenCalledWith('sk-or-test')
    expect(screen.getByPlaceholderText(t('openRouterKeyConfigured'))).toBeTruthy()
  })

  it('surfaces a key write failure', async () => {
    mount({ keyRejects: 'credentials are read-only' })
    await screen.findByRole('button', { name: t('openRouterSave') })
    fireEvent.change(screen.getByLabelText<HTMLInputElement>(t('openRouterApiKey')), {
      target: { value: 'sk-or-test' },
    })
    fireEvent.click(screen.getByRole('button', { name: t('openRouterSaveKey') }))
    expect((await screen.findByRole('alert')).textContent).toBe('credentials are read-only')
  })
})
