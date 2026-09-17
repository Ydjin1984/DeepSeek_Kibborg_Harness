/**
 * OpenRouter Free settings section: switch the free-model pool on, store the
 * API key it authenticates with, bound what one model may spend per day, and
 * show what the last scan pooled and what each model has left today.
 *
 * The status list is not an independent read: the pool service writes it into
 * its own settings section after every scan and every settled lease, so this
 * component renders the same document it edits. Copy rides the Models page
 * dictionary (`settings.models`).
 */

import { useEffect, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './ModelsSection.module.css'

/** One pooled model as the pool reported it. */
export interface OpenRouterFreeStatusView {
  readonly id: string
  readonly name: string
  readonly contextLength: number
  readonly requestsUsedToday: number
  readonly requestsRemainingToday: number
  readonly cooldownUntil: number
  readonly state: string
  readonly lastError?: string
}

/** Current pool view loaded from the settings namespace. */
export interface OpenRouterFreeSettingsView {
  readonly enabled: boolean
  readonly providerRoute: string
  readonly baseURL: string
  readonly apiKeyEnv: string
  readonly refreshMinutes: number
  /** Operator-side scan trigger: changing it asks the pool to rescan now. */
  readonly refreshNonce: number
  readonly maxModels: number
  readonly requestsPerDayPerModel: number
  /** Epoch milliseconds of the pool's last successful scan, or 0. */
  readonly scannedAt: number
  readonly status: readonly OpenRouterFreeStatusView[]
}

/** Everything the section needs to render before it can be edited. */
export interface OpenRouterFreeSnapshot {
  /** The pool's stored configuration and last reported status. */
  readonly settings: OpenRouterFreeSettingsView
  /** Credential reference the published route resolves. */
  readonly credentialRef: string
  /** Whether a value is stored under that reference. */
  readonly keyConfigured: boolean
}

/** Injected actions for the section: read/write the namespace and the key. */
export interface OpenRouterFreeSectionInjected {
  /** Load the pool configuration, its status, and the key's presence. */
  load: () => Promise<OpenRouterFreeSnapshot>
  /** Persist one patch into the pool's settings namespace. */
  save: (patch: Partial<OpenRouterFreeSettingsView>) => Promise<void>
  /** Store the API key under the reference the route resolves. */
  saveKey: (value: string) => Promise<void>
}

/** Full props of the section. */
export type OpenRouterFreeSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'settings.models'>
  & OpenRouterFreeSectionInjected

/** Human label for one pooled model's selectability. */
function stateLabel(
  row: OpenRouterFreeStatusView,
  t: (key: 'openRouterCooling' | 'openRouterExhausted') => string,
): string {
  if (row.state === 'cooling') return t('openRouterCooling')
  if (row.state === 'exhausted') return t('openRouterExhausted')
  return ''
}

/**
 * Render the timestamps the pool reports in the reader's locale.
 * @param epochMs - epoch milliseconds, or 0 when nothing has been reported.
 * @returns the local time, or nothing for an unset timestamp.
 */
function formatScanTime(epochMs: number): string {
  if (epochMs <= 0) return ''
  return new Date(epochMs).toLocaleTimeString()
}

/**
 * Render the OpenRouter free-pool settings.
 * @param props - standard section kit plus injected actions.
 * @returns the section tree.
 */
export function OpenRouterFreeSection({ load, save, saveKey, t }: OpenRouterFreeSectionProps) {
  const [view, setView] = useState<OpenRouterFreeSettingsView | null>(null)
  const [credentialRef, setCredentialRef] = useState('')
  const [keyConfigured, setKeyConfigured] = useState(false)
  const [keyValue, setKeyValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void load().then((snapshot) => {
      if (cancelled) return
      setView(snapshot.settings)
      setCredentialRef(snapshot.credentialRef)
      setKeyConfigured(snapshot.keyConfigured)
    }).catch((cause: unknown) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause))
    })
    return () => { cancelled = true }
  }, [load])

  const update = (patch: Partial<OpenRouterFreeSettingsView>): void => {
    setView(previous => previous === null ? previous : { ...previous, ...patch })
  }

  const saveAll = async (): Promise<void> => {
    if (view === null) return
    setSaving(true)
    setError(null)
    setMessage(null)
    try {
      await save({
        enabled: view.enabled,
        refreshMinutes: view.refreshMinutes,
        maxModels: view.maxModels,
        requestsPerDayPerModel: view.requestsPerDayPerModel,
      })
      setMessage(t('openRouterSaved'))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSaving(false)
    }
  }

  const saveApiKey = async (): Promise<void> => {
    if (keyValue.trim() === '') return
    setSaving(true)
    setError(null)
    setMessage(null)
    try {
      await saveKey(keyValue.trim())
      setKeyConfigured(true)
      setKeyValue('')
      setMessage(t('openRouterSaved'))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSaving(false)
    }
  }

  /**
   * Ask the pool to rescan now. The service rescans on every configuration
   * change, so an otherwise meaningless nonce is the whole request; the
   * refreshed pool arrives on the pool's own schedule, which is why the
   * message says the list will follow rather than showing it immediately.
   */
  const refreshNow = async (): Promise<void> => {
    setSaving(true)
    setError(null)
    setMessage(null)
    try {
      await save({ refreshNonce: Date.now() })
      const snapshot = await load()
      setView(snapshot.settings)
      setKeyConfigured(snapshot.keyConfigured)
      setMessage(t('openRouterRefreshRequested'))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSaving(false)
    }
  }

  const title = t('openRouterNav')

  if (view === null) {
    return (
      <section className={css.orchestratorCard} aria-label={title}>
        {error !== null
          ? <p className={css.orchestratorError} role="alert">{error}</p>
          : <div className={css.orchestratorLoading}>…</div>}
      </section>
    )
  }

  return (
    <section className={css.orchestratorCard} aria-label={title}>
      <h3 className={css.orchestratorTitle}>{title}</h3>
      <p className={css.orchestratorIntro}>{t('openRouterIntro')}</p>

      <label className={css.orchestratorRow}>
        <input
          type="checkbox"
          checked={view.enabled}
          onChange={(event) => { update({ enabled: event.currentTarget.checked }) }}
        />
        {t('openRouterEnable')}
      </label>

      <fieldset className={css.orchestratorGroup}>
        <legend>{t('openRouterApiKey')}</legend>
        <div className={css.orchestratorRow}>
          <span className={css.orchestratorLabel}>{credentialRef}</span>
          <input
            type="password"
            aria-label={t('openRouterApiKey')}
            value={keyValue}
            placeholder={keyConfigured ? t('openRouterKeyConfigured') : t('openRouterKeyMissing')}
            onChange={(event) => { setKeyValue(event.currentTarget.value) }}
          />
          <button type="button" disabled={saving || keyValue.trim() === ''} onClick={() => { void saveApiKey() }}>
            {t('openRouterSaveKey')}
          </button>
        </div>
      </fieldset>

      <fieldset className={css.orchestratorGroup}>
        <legend>{t('openRouterModelsTitle')}</legend>
        <div className={css.orchestratorRow}>
          <span className={css.orchestratorLabel}>{t('openRouterRefreshMinutes')}</span>
          <input
            type="number"
            min={1}
            aria-label={t('openRouterRefreshMinutes')}
            value={String(view.refreshMinutes)}
            onChange={(event) => {
              const parsed = Number.parseInt(event.currentTarget.value, 10)
              update({ refreshMinutes: Number.isFinite(parsed) ? Math.max(1, parsed) : view.refreshMinutes })
            }}
          />
          <span className={css.orchestratorLabel}>{t('openRouterMaxModels')}</span>
          <input
            type="number"
            min={1}
            max={200}
            aria-label={t('openRouterMaxModels')}
            value={String(view.maxModels)}
            onChange={(event) => {
              const parsed = Number.parseInt(event.currentTarget.value, 10)
              update({ maxModels: Number.isFinite(parsed) ? Math.min(200, Math.max(1, parsed)) : view.maxModels })
            }}
          />
          <span className={css.orchestratorLabel}>{t('openRouterRequestsPerDay')}</span>
          <input
            type="number"
            min={1}
            aria-label={t('openRouterRequestsPerDay')}
            value={String(view.requestsPerDayPerModel)}
            onChange={(event) => {
              const parsed = Number.parseInt(event.currentTarget.value, 10)
              update({
                requestsPerDayPerModel: Number.isFinite(parsed)
                  ? Math.max(1, parsed)
                  : view.requestsPerDayPerModel,
              })
            }}
          />
          <button type="button" disabled={saving} onClick={() => { void refreshNow() }}>
            {t('openRouterRefreshNow')}
          </button>
          <span className={css.orchestratorLabel}>
            {view.scannedAt > 0
              ? `${t('openRouterScannedAt')} ${formatScanTime(view.scannedAt)}`
              : t('openRouterNeverScanned')}
          </span>
        </div>
        {view.status.length === 0
          ? <p className={css.orchestratorNotice} role="status">{t('openRouterNoModels')}</p>
          : (
            <ul className={css.orchestratorList}>
              {view.status.map(row => (
                <li key={row.id}>
                  <code>{row.id}</code>
                  {' — '}
                  {`${String(row.requestsRemainingToday)}/${String(row.requestsRemainingToday + row.requestsUsedToday)} ${t('openRouterLeftToday')}`}
                  {stateLabel(row, t) === '' ? null : ` (${stateLabel(row, t)})`}
                </li>
              ))}
            </ul>
          )}
      </fieldset>

      {message !== null ? <p className={css.orchestratorNotice} role="status">{message}</p> : null}
      {error !== null ? <p className={css.orchestratorError} role="alert">{error}</p> : null}

      <button
        type="button"
        className={css.orchestratorSave}
        disabled={saving}
        onClick={() => { void saveAll() }}
      >
        {saving ? t('openRouterSaving') : t('openRouterSave')}
      </button>
    </section>
  )
}
