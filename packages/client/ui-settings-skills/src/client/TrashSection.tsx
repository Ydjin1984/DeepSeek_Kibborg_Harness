/**
 * Trash section: trashed skills with restore and permanent-delete actions.
 * Both actions are destructive-adjacent, so they stay explicit buttons per
 * entry rather than a single bulk control.
 */

import type { TrashEntryView } from '@deepseek-ai/dsh-host-apiproxy/api'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { SkillsLocaleKey } from './locales.ts'
import css from './SkillsSettingsSection.module.css'

/** Locale key per trash-entry scope. */
const SCOPE_KEYS: Record<TrashEntryView['scope'], SkillsLocaleKey> = {
  user: 'scopeUser',
  project: 'scopeProject',
  agents: 'scopeAgents',
}

/** Props of the trash section. */
export interface TrashSectionProps {
  /** Trashed skills. */
  entries: readonly TrashEntryView[]
  /** Locale reader for the Skills section. */
  t: TranslateNS<'settings.skills'>
  /** Non-null while an entry action is in flight (blocks every row action). */
  busyName: string | null
  /** Restore one trashed skill. */
  onRestore: (name: string) => void
  /** Permanently delete one trashed skill. */
  onDeletePermanently: (name: string) => void
}

/**
 * Render the trash list.
 * @param props - the trashed entries and their actions.
 * @returns the trash block.
 */
export function TrashSection({ entries, t, busyName, onRestore, onDeletePermanently }: TrashSectionProps) {
  return (
    <section className={css.trash} aria-label={t('trashTitle')}>
      <h3 className={css.groupTitle}>{t('trashTitle')}</h3>
      {entries.length === 0 ? <p className={css.empty}>{t('trashEmpty')}</p> : (
        <ul className={css.trashList}>
          {entries.map(entry => (
            <li key={`${entry.scope}/${entry.name}`} className={css.trashRow} data-trash-entry={entry.name}>
              <div className={css.trashMain}>
                <strong>{entry.name}</strong>
                <span className={css.trashMeta}>{t(SCOPE_KEYS[entry.scope])} · {entry.path}</span>
              </div>
              <div className={css.trashActions}>
                <button
                  type="button"
                  className={css.actionButton}
                  disabled={busyName !== null}
                  onClick={() => { onRestore(entry.name) }}
                >
                  {t('actionRestore')}
                </button>
                <button
                  type="button"
                  className={css.actionDanger}
                  disabled={busyName !== null}
                  onClick={() => { onDeletePermanently(entry.name) }}
                >
                  {t('actionDeletePermanently')}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
