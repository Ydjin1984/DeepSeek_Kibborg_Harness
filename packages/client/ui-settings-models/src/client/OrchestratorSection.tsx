/**
 * Orchestrator settings section: choose the EXECUTOR (local) model route and
 * toggle the mode. The HEAD role needs no route: it is always the session's
 * live chat model (the composer picker owns it), so only the local worker
 * route is configured here. Writes the `orchestrator` settings namespace read
 * by @deepseek-ai/dsh-orchestrator at runtime — the executor tool appears and
 * the head prompt section renders as soon as the mode is enabled with a model
 * set. Copy rides the Models page dictionary (`settings.models`).
 */

import { useEffect, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './ModelsSection.module.css'

/** One model row of a provider group in the llm.models catalog. */
interface CatalogModel {
  readonly id: string
  readonly name?: string
}

/**
 * One provider group of the llm.models catalog. The catalog is the api-remotes
 * ModelProviderGroup projection (`id` route + `name` display + `models`), so
 * pickers key providers by the group id.
 */
export interface OrchestratorCatalogGroup {
  readonly id: string
  readonly name?: string
  readonly models: readonly CatalogModel[]
}

/** Current orchestrator view loaded from the settings namespace. */
export interface OrchestratorSettingsView {
  readonly enabled: boolean
  readonly executorProvider: string
  readonly executorModel: string
}

/** Injected actions for the section: read/write the namespace and the model catalog. */
export interface OrchestratorSectionInjected {
  /** Load the current orchestrator settings. */
  load: () => Promise<OrchestratorSettingsView>
  /** Persist one patch into the orchestrator settings namespace. */
  save: (patch: Partial<OrchestratorSettingsView>) => Promise<void>
  /** List available model routes (provider groups with their models). */
  listModels: () => Promise<readonly OrchestratorCatalogGroup[]>
}

/** Full props of the section. */
export type OrchestratorSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'settings.models'>
  & OrchestratorSectionInjected

/** Resolve a group's display name for pickers. */
function providerName(group: OrchestratorCatalogGroup): string {
  return group.name !== undefined && group.name !== '' ? group.name : group.id
}

/** The model group whose provider id matches a stored route, if any. */
function groupFor(groups: readonly OrchestratorCatalogGroup[], provider: string): OrchestratorCatalogGroup | undefined {
  return groups.find(group => group.id === provider)
}

/** All model ids a route may take (stored fallback first when not catalogued). */
function modelOptions(group: OrchestratorCatalogGroup | undefined, current: string): string[] {
  const models = group?.models.map(model => model.id) ?? []
  return current !== '' && !models.includes(current) ? [current, ...models] : models
}

/**
 * Render the orchestrator role settings.
 * @param props - standard section kit plus injected actions.
 * @returns the section tree.
 */
export function OrchestratorSection({ load, save, listModels, t }: OrchestratorSectionProps) {
  const [view, setView] = useState<OrchestratorSettingsView | null>(null)
  const [groups, setGroups] = useState<readonly OrchestratorCatalogGroup[]>([])
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void Promise.all([load(), listModels()]).then(([settings, catalog]) => {
      if (cancelled) return
      setView(settings)
      setGroups(catalog)
    }).catch((cause: unknown) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause))
    })
    return () => { cancelled = true }
  }, [load, listModels])

  const update = (patch: Partial<OrchestratorSettingsView>): void => {
    setView(previous => previous === null ? previous : { ...previous, ...patch })
  }

  const saveAll = async (): Promise<void> => {
    if (view === null) return
    // Enabling the mode without a local route silently does nothing (the tool
    // never mounts); reject the save loudly instead.
    if (view.enabled && (view.executorProvider.trim() === '' || view.executorModel.trim() === '')) {
      setError(t('orchestratorRouteRequired'))
      return
    }
    setSaving(true)
    setError(null)
    setMessage(null)
    try {
      await save(view)
      setMessage(t('orchestratorSaved'))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSaving(false)
    }
  }

  const title = t('orchestratorNav')

  if (view === null) {
    return (
      <section className={css.orchestratorCard} aria-label={title}>
        {error !== null
          ? <p className={css.orchestratorError} role="alert">{error}</p>
          : <div className={css.orchestratorLoading}>…</div>}
      </section>
    )
  }

  const executorGroup = groupFor(groups, view.executorProvider)

  return (
    <section className={css.orchestratorCard} aria-label={title}>
      <h3 className={css.orchestratorTitle}>{title}</h3>
      <p className={css.orchestratorIntro}>{t('orchestratorIntro')}</p>

      <label className={css.orchestratorRow}>
        <input
          type="checkbox"
          checked={view.enabled}
          onChange={(event) => { update({ enabled: event.currentTarget.checked }) }}
        />
        {t('orchestratorEnable')}
      </label>

      <fieldset className={css.orchestratorGroup} disabled={groups.length === 0}>
        <legend>{t('orchestratorExecutorLegend')}</legend>
        <div className={css.orchestratorRow}>
          <span className={css.orchestratorLabel}>{t('orchestratorProvider')}</span>
          <input
            list="orchestrator-executor-providers"
            aria-label={t('orchestratorProvider')}
            value={view.executorProvider}
            onChange={(event) => { update({ executorProvider: event.currentTarget.value }) }}
          />
          <datalist id="orchestrator-executor-providers">
            {groups.map(group => <option key={group.id} value={group.id}>{providerName(group)}</option>)}
          </datalist>
          <span className={css.orchestratorLabel}>{t('orchestratorModel')}</span>
          <input
            list="orchestrator-executor-models"
            aria-label={t('orchestratorModel')}
            value={view.executorModel}
            onChange={(event) => { update({ executorModel: event.currentTarget.value }) }}
          />
          <datalist id="orchestrator-executor-models">
            {modelOptions(executorGroup, view.executorModel).map(id => <option key={id} value={id} />)}
          </datalist>
        </div>
      </fieldset>

      {message !== null ? <p className={css.orchestratorNotice} role="status">{message}</p> : null}
      {error !== null ? <p className={css.orchestratorError} role="alert">{error}</p> : null}

      <button
        type="button"
        className={css.orchestratorSave}
        disabled={saving}
        onClick={() => { void saveAll() }}
      >
        {saving ? t('orchestratorSaving') : t('orchestratorSave')}
      </button>
    </section>
  )
}
