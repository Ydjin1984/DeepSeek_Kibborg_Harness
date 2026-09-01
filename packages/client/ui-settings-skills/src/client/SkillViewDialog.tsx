/**
 * Read-only skill viewer: the full body with a rendered/raw presentation
 * toggle. "Rendered" shows the body as readable text; "raw" shows it inside a
 * code block, so a user can copy the exact on-disk bytes.
 */

import { useState } from 'react'
import clsx from 'clsx'
import type { ManagedSkillView } from '@deepseek-ai/dsh-host-apiproxy/api'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import css from './SkillsSettingsSection.module.css'

/** Props of the viewer dialog. */
export interface SkillViewDialogProps {
  /** The full managed skill to inspect. */
  skill: ManagedSkillView
  /** Locale reader for the Skills section. */
  t: TranslateNS<'settings.skills'>
  /** Close the dialog. */
  onClose: () => void
}

/**
 * Render the skill body in the chosen presentation.
 * @param props - the skill plus dialog callbacks.
 * @returns the dialog overlay.
 */
export function SkillViewDialog({ skill, t, onClose }: SkillViewDialogProps) {
  const [raw, setRaw] = useState(false)
  const empty = skill.content.trim().length === 0
  return (
    <div className={css.overlay} role="presentation">
      <div className={css.dialog} role="dialog" aria-modal="true" aria-label={t('viewTitle')}>
        <div className={css.dialogHeader}>
          <h3 className={css.dialogTitle}>{t('viewTitle')}: {skill.name}</h3>
          <button type="button" className={css.dialogClose} aria-label={t('actionClose')} onClick={onClose}>
            {t('actionClose')}
          </button>
        </div>
        <div className={css.viewModes}>
          <button
            type="button"
            className={clsx(css.modeButton, !raw && css.modeActive)}
            aria-pressed={!raw}
            onClick={() => { setRaw(false) }}
          >
            {t('viewRendered')}
          </button>
          <button
            type="button"
            className={clsx(css.modeButton, raw && css.modeActive)}
            aria-pressed={raw}
            onClick={() => { setRaw(true) }}
          >
            {t('viewRaw')}
          </button>
        </div>
        <div className={css.dialogBody}>
          {empty
            ? <p className={css.empty}>{t('viewContentEmpty')}</p>
            : raw
              ? <pre className={css.rawContent} data-mode="raw"><code>{skill.content}</code></pre>
              : <pre className={css.renderedContent} data-mode="rendered">{skill.content}</pre>}
        </div>
      </div>
    </div>
  )
}
