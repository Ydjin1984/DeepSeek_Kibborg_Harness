/**
 * Skill editor: textarea over the body, with the save pipeline the manager
 * requires — validate, then security-check, then save — and in-dialog
 * resolution for a blocked security verdict (force). The dialog only edits
 * skills that already exist on disk (it opens from a managed-skill card), so
 * every save is an in-place update and publishes `replace: true`; the manager
 * snapshots the previous body as a version before overwriting. The dialog
 * never writes directly; every step is a prop callback.
 */

import { useState } from 'react'
import type {
  ManagedSkillView, SecurityVerdictView,
} from '@deepseek-ai/dsh-host-apiproxy/api'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import css from './SkillsSettingsSection.module.css'

/** Save-options the dialog resolved through its confirmation steps. */
export interface SkillSaveOptions {
  /** Overwrite the existing skill's file (always true: the editor targets an existing skill). */
  replace: boolean
  /** Save despite a blocked security verdict. */
  force: boolean
}

/** Props of the editor dialog. */
export interface SkillEditDialogProps {
  /** The skill being edited (its body seeds the textarea). */
  skill: ManagedSkillView
  /** Locale reader for the Skills section. */
  t: TranslateNS<'settings.skills'>
  /** Validate raw SKILL.md content. */
  validate: (content: string) => Promise<{ ok: boolean; reason?: string }>
  /** Run the static security check over raw SKILL.md content. */
  securityCheck: (content: string) => Promise<SecurityVerdictView>
  /** Persist the content; rejects with the host error message on failure. */
  save: (content: string, options: SkillSaveOptions) => Promise<void>
  /** The save committed; the parent refreshes and closes. */
  onSaved: () => void
  /** Close the dialog (discards the draft). */
  onClose: () => void
}

/**
 * Render the editor with its staged save pipeline.
 * @param props - the skill, the pipeline callbacks, and dialog controls.
 * @returns the dialog overlay.
 */
export function SkillEditDialog(props: SkillEditDialogProps) {
  const { skill, t } = props
  const [content, setContent] = useState(skill.content)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [blocked, setBlocked] = useState(false)

  /** Run the staged pipeline; `force` reflects the blocked-verdict confirmation. */
  const save = async (force: boolean): Promise<void> => {
    // v8 ignore next -- every save button is disabled while a save is in flight.
    if (saving) return
    setSaving(true)
    setError(null)
    try {
      const validation = await props.validate(content)
      if (!validation.ok) {
        setError(t('editValidationFailed', { reason: validation.reason ?? '' }))
        setSaving(false)
        return
      }
      const verdict = await props.securityCheck(content)
      if (verdict.status === 'blocked' && !force) {
        setBlocked(true)
        setSaving(false)
        return
      }
      await props.save(content, { replace: true, force })
      setSaved(true)
      props.onSaved()
    } catch (cause) {
      setError(t('editError', { message: cause instanceof Error ? cause.message : String(cause) }))
      setSaving(false)
    }
  }

  return (
    <div className={css.overlay} role="presentation">
      <div className={css.dialog} role="dialog" aria-modal="true" aria-label={t('editTitle')}>
        <div className={css.dialogHeader}>
          <h3 className={css.dialogTitle}>{t('editTitle')}: {skill.name}</h3>
          <button type="button" className={css.dialogClose} aria-label={t('actionClose')} onClick={props.onClose}>
            {t('actionClose')}
          </button>
        </div>
        <div className={css.dialogBody}>
          <label className={css.editLabel}>
            <span>{t('editContent')}</span>
            <textarea
              className={css.textarea}
              value={content}
              rows={16}
              disabled={saving}
              onChange={(event) => { setContent(event.currentTarget.value) }}
            />
          </label>
          {saved ? <p className={css.notice} role="status">{t('editSaved')}</p> : null}
          {error !== null ? <p className={css.failure} role="alert">{error}</p> : null}
          {blocked ? (
            <div className={css.confirmPanel}>
              <p>{t('editSecurityBlocked')}</p>
              <div className={css.footer}>
                <button type="button" className={css.buttonSecondary} disabled={saving} onClick={props.onClose}>
                  {t('actionCancel')}
                </button>
                <button type="button" className={css.buttonPrimary} disabled={saving} onClick={() => { void save(true) }}>
                  {t('editSaveAnyway')}
                </button>
              </div>
            </div>
          ) : (
            <div className={css.footer}>
              <button type="button" className={css.buttonSecondary} disabled={saving} onClick={props.onClose}>
                {t('actionCancel')}
              </button>
              <button type="button" className={css.buttonPrimary} disabled={saving || content.trim().length === 0} onClick={() => { void save(false) }}>
                {t(saving ? 'editSaving' : 'editSave')}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
