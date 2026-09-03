/**
 * Version history dialog: one row per stored version with two ways to select a
 * version — "Use as default" activates the published version without a new
 * version event, and "Roll back" publishes a new version whose body is the
 * target's. Failures surface inline without closing the dialog, so a user can
 * pick another version.
 */

import { useState } from 'react'
import type { SkillVersionView } from '@deepseek-ai/dsh-host-apiproxy/api'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { formatDateTime } from './formats.ts'
import css from './SkillsSettingsSection.module.css'

/** Props of the versions dialog. */
export interface SkillVersionsDialogProps {
  /** The skill's name (dialog heading). */
  name: string
  /** Version history, newest first. */
  versions: readonly SkillVersionView[]
  /** The currently active version id. */
  activeVersion: string
  /** Locale reader for the Skills section. */
  t: TranslateNS<'settings.skills'>
  /** BCP-47 locale tag for date formatting. */
  locale: string
  /** Whether an activation is in flight. */
  activating: boolean
  /** Whether a rollback is in flight. */
  rolling: boolean
  /** Activate one published version as the default; rejects on failure. */
  onActivate: (version: string) => Promise<void>
  /** Roll the skill back to one version; rejects on failure. */
  onRollback: (version: string) => Promise<void>
  /** Close the dialog. */
  onClose: () => void
}

/** One settled version selection, classified for the inline notice copy. */
type SelectionNotice =
  | { readonly kind: 'activate'; readonly version: string }
  | { readonly kind: 'rollback'; readonly version: string }

/**
 * Render the version history with activation and rollback controls.
 * @param props - the history plus selection callbacks.
 * @returns the dialog overlay.
 */
export function SkillVersionsDialog(props: SkillVersionsDialogProps) {
  const { versions, activeVersion, t, locale, activating, rolling } = props
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<SelectionNotice | null>(null)
  const busy = activating || rolling

  /** Run one selection action and report the outcome inline. */
  const select = async (
    action: 'activate' | 'rollback',
    version: string,
  ): Promise<void> => {
    // v8 ignore next -- every selection button is disabled while one is in flight.
    if (busy) return
    setError(null)
    try {
      if (action === 'activate') await props.onActivate(version)
      else await props.onRollback(version)
      setNotice({ kind: action, version })
    } catch (cause) {
      const key = action === 'activate' ? 'versionsActivateError' : 'versionsError'
      setError(t(key, { message: cause instanceof Error ? cause.message : String(cause) }))
    }
  }

  return (
    <div className={css.overlay} role="presentation">
      <div className={css.dialog} role="dialog" aria-modal="true" aria-label={t('versionsTitle')}>
        <div className={css.dialogHeader}>
          <h3 className={css.dialogTitle}>{t('versionsTitle')}: {props.name}</h3>
          <button type="button" className={css.dialogClose} aria-label={t('actionClose')} onClick={props.onClose}>
            {t('actionClose')}
          </button>
        </div>
        <div className={css.dialogBody}>
          {error !== null ? <p className={css.failure} role="alert">{error}</p> : null}
          {notice !== null ? (
            <p className={css.notice} role="status">
              {notice.kind === 'activate'
                ? t('versionsActivated', { version: notice.version })
                : t('versionsRolledBack', { version: notice.version })}
            </p>
          ) : null}
          {versions.length === 0 ? <p className={css.empty}>{t('versionsEmpty')}</p> : (
            <ul className={css.versions}>
              {versions.map((version) => {
                const active = version.id === activeVersion
                return (
                  <li key={version.id} className={css.versionRow} data-active={active ? 'true' : undefined}>
                    <div className={css.versionMain}>
                      <strong>{version.id}</strong>
                      {active ? <span className={css.activeTag}>{t('versionsActive')}</span> : null}
                      <span className={css.versionMeta}>
                        {formatDateTime(version.createdAt, locale)} · {version.source} · {version.reason}
                      </span>
                    </div>
                    {!active
                      ? (
                        <div className={css.versionActions}>
                          <button
                            type="button"
                            className={css.actionButton}
                            disabled={busy}
                            onClick={() => { void select('activate', version.id) }}
                          >
                            {t(activating ? 'versionsActivating' : 'versionsActivate')}
                          </button>
                          <button
                            type="button"
                            className={css.actionButton}
                            disabled={busy}
                            onClick={() => { void select('rollback', version.id) }}
                          >
                            {t(rolling ? 'versionsRolling' : 'versionsRollback')}
                          </button>
                        </div>
                      )
                      : null}
                  </li>
                )
              })}
            </ul>
          )}
          <div className={css.footer}>
            <button type="button" className={css.buttonSecondary} onClick={props.onClose}>
              {t('actionClose')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
