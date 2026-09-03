// @vitest-environment jsdom
/** Orchestrator role settings: reads/writes the `orchestrator` namespace, lists the model catalog. */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OrchestratorSection } from '../src/client/OrchestratorSection.tsx'
import type {
  OrchestratorCatalogGroup, OrchestratorSectionProps, OrchestratorSettingsView,
} from '../src/client/OrchestratorSection.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

/** The deepseek-official and kibborg groups as llm.models advertises them. */
const CATALOG: OrchestratorCatalogGroup[] = [
  { id: 'deepseek-official', name: 'DeepSeek', models: [
    { id: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash' },
    { id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro' },
  ] },
  { id: 'kibborg', name: 'Kibborg Brain', models: [
    { id: 'Kibborg_Flash_v5.7', name: 'Kibborg_Flash_v5.7' },
  ] },
]

/** Translate through the English dictionary (params-free keys). */
function t(key: keyof typeof en): string {
  return en[key]
}

function mount(options: {
  view?: Partial<OrchestratorSettingsView>
  catalog?: readonly OrchestratorCatalogGroup[]
  loadRejects?: string
  saveRejects?: string
} = {}) {
  const load = options.loadRejects === undefined
    ? vi.fn(() => Promise.resolve({
      enabled: false,
      executorProvider: '',
      executorModel: '',
      ...options.view,
    }))
    : vi.fn(() => Promise.reject(new Error(options.loadRejects)))
  const save = options.saveRejects === undefined
    ? vi.fn((_patch: Partial<OrchestratorSettingsView>) => Promise.resolve())
    : vi.fn((_patch: Partial<OrchestratorSettingsView>) => Promise.reject(new Error(options.saveRejects)))
  const listModels = vi.fn(() => Promise.resolve(options.catalog ?? CATALOG))
  const props = {
    close: () => {},
    load,
    save,
    listModels,
    t,
  } as unknown as OrchestratorSectionProps
  render(<OrchestratorSection {...props} />)
  return { load, save, listModels }
}

describe('OrchestratorSection', () => {
  it('shows a loading placeholder until both reads settle', async () => {
    mount()
    expect(screen.getByText('…')).toBeTruthy()
    expect(screen.queryByRole('button', { name: t('orchestratorSave') })).toBeNull()
  })

  it('shows the load failure instead of a forever placeholder', async () => {
    mount({ loadRejects: 'settings transport unavailable' })
    expect((await screen.findByRole('alert')).textContent).toBe('settings transport unavailable')
  })

  it('fills the executor pickers from the resolved namespace and catalog', async () => {
    mount({
      view: {
        enabled: true,
        executorProvider: 'kibborg',
        executorModel: 'Kibborg_Flash_v5.7',
      },
    })
    await screen.findByRole('button', { name: t('orchestratorSave') })
    const checkbox = screen.getByRole('checkbox') as HTMLInputElement
    expect(checkbox.checked).toBe(true)
    expect(screen.getByLabelText<HTMLInputElement>(t('orchestratorProvider')).value).toBe('kibborg')
    expect(screen.getByLabelText<HTMLInputElement>(t('orchestratorModel')).value).toBe('Kibborg_Flash_v5.7')
  })

  it('persists the edited view through save on click', async () => {
    const { save } = mount({
      view: { executorProvider: 'kibborg', executorModel: 'Kibborg_Flash_v5.7' },
    })
    await screen.findByRole('button', { name: t('orchestratorSave') })
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: t('orchestratorSave') }))
    await screen.findByRole('status')
    expect(save).toHaveBeenCalledTimes(1)
    const patch = save.mock.calls[0]![0] as OrchestratorSettingsView
    expect(patch.enabled).toBe(true)
    expect(patch.executorModel).toBe('Kibborg_Flash_v5.7')
  })

  it('surfaces a save failure without clearing the edited form', async () => {
    const { save } = mount({
      saveRejects: 'revision conflict',
      view: { enabled: true, executorProvider: 'kibborg', executorModel: 'Kibborg_Flash_v5.7' },
    })
    await screen.findByRole('button', { name: t('orchestratorSave') })
    fireEvent.click(screen.getByRole('button', { name: t('orchestratorSave') }))
    expect((await screen.findByRole('alert')).textContent).toBe('revision conflict')
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true)
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('refuses to enable the mode without a local route', async () => {
    const { save } = mount()
    await screen.findByRole('button', { name: t('orchestratorSave') })
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: t('orchestratorSave') }))
    expect((await screen.findByRole('alert')).textContent).toBe(t('orchestratorRouteRequired'))
    expect(save).not.toHaveBeenCalled()
  })

  it('offers every catalogued provider route and model through the datalists', async () => {
    mount({ view: { executorProvider: 'kibborg', executorModel: 'Kibborg_Flash_v5.7' } })
    await screen.findByRole('button', { name: t('orchestratorSave') })
    const providers = document.getElementById('orchestrator-executor-providers')!
    expect(Array.from(providers.querySelectorAll('option')).map(option => option.value))
      .toEqual(['deepseek-official', 'kibborg'])
    const models = document.getElementById('orchestrator-executor-models')!
    expect(Array.from(models.querySelectorAll('option')).map(option => option.value))
      .toEqual(['Kibborg_Flash_v5.7'])
  })

  it('keeps a stored model the provider no longer advertises as a fallback option', async () => {
    mount({
      view: { executorProvider: 'kibborg', executorModel: 'stale-model' },
      catalog: [{ id: 'kibborg', name: 'Kibborg Brain', models: [{ id: 'Kibborg_Flash_v5.7' }] }],
    })
    await screen.findByRole('button', { name: t('orchestratorSave') })
    const models = document.getElementById('orchestrator-executor-models')!
    expect(Array.from(models.querySelectorAll('option')).map(option => option.value))
      .toEqual(['stale-model', 'Kibborg_Flash_v5.7'])
    const providers = document.getElementById('orchestrator-executor-providers')!
    expect(Array.from(providers.querySelectorAll('option')).map(option => option.value))
      .toEqual(['kibborg'])
  })

  it('disables the executor fieldset while the catalog is empty', async () => {
    mount({ view: { executorProvider: 'deepseek-official' }, catalog: [] })
    await screen.findByRole('button', { name: t('orchestratorSave') })
    const fieldsets = screen.getAllByRole('group')
    expect(fieldsets).toHaveLength(1)
    expect((fieldsets[0] as HTMLFieldSetElement).disabled).toBe(true)
    // The saved route survives even without catalog suggestions.
    expect(screen.getByLabelText<HTMLInputElement>(t('orchestratorProvider')).value)
      .toBe('deepseek-official')
  })
})
