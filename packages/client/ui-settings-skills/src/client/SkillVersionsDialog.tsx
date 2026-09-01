/**
 * Version history dialog: one row per stored version with rollback to any
 * non-active version. Rollback failures surface inline without closing the
 * dialog, so a user can pick another version.
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
  /** Whether a rollback is in flight. */
  rolling: boolean
  /** Roll the skill back to one version; rejects on failure. */
  onRollback: (version: string) => Promise<void>
  /** Close the dialog. */
  onClose: () => void
}

/**
 * Render the version history with rollback controls.
 * @param props - the history plus rollback callbacks.
 * @returns the dialog overlay.
 */
export function SkillVersionsDialog(props: SkillVersionsDialogProps) {
  const { versions, activeVersion, t, locale, rolling } = props
  const [error, setError] = useState<string | null>(null)
  const [rolledBack, setRolledBack] = useState<string | null>(null)

  /** Roll back and report the outcome inline. */
  const rollback = async (version: string): Promise<void> => {
    // v8 ignore next -- every rollback button is disabled while one is in flight.
    if (rolling) return
    setError(null)
    try {
      await props.onRollback(version)
      setRolledBack(version)
    } catch (cause) {
      setError(t('versionsError', { message: cause instanceof Error ? cause.message : String(cause) }))
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
          {rolledBack !== null ? (
            <p className={css.notice} role="status">{t('versionsRolledBack', { version: rolledBack })}</p>
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
                        <button
                          type="button"
                          className={css.actionButton}
                          disabled={rolling}
                          onClick={() => { void rollback(version.id) }}
                        >
                          {t(rolling ? 'versionsRolling' : 'versionsRollback')}
                        </button>
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
