/** General Settings row for process-local UI diagnostics timings. */
import clsx from 'clsx'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SettingsKey } from './locales.ts'
import css from './DebugRow.module.css'

/** Registration-side diagnostics face. */
export interface DebugRowInjected {
  hooks: {
    /** Persisted enablement bound as useEnabled. */
    enabled: SnapshotStore<boolean>
  }
  /** Change whether this process writes `[dsh-debug]` timings. */
  setEnabled: (enabled: boolean) => void
}

/** Full Settings-row props. */
export type DebugRowProps =
  PropsRuntime<'settings.general.item'>
  & PropsLocale<'settings'>
  & InjectFace<DebugRowInjected>

const OPTIONS: readonly { id: boolean; label: SettingsKey }[] = [
  { id: false, label: 'debug.off' },
  { id: true, label: 'debug.on' },
]

/**
 * Render the UI diagnostics on/off row.
 * @param props - composed Settings slot props.
 * @returns the preference row.
 */
export function DebugRow({ useEnabled, setEnabled, t }: DebugRowProps) {
  const enabled = useEnabled(value => value)
  return (
    <div className={css.row}>
      <div className={css.rowText}>
        <div className={css.title}>{t('debug.title')}</div>
        <div className={css.desc}>{t('debug.description')}</div>
      </div>
      <div className={css.pills}>
        {OPTIONS.map(option => (
          <button
            key={String(option.id)}
            type="button"
            className={clsx(css.pill, enabled === option.id && css.selected)}
            aria-pressed={enabled === option.id}
            onClick={() => { setEnabled(option.id) }}
          >
            {t(option.label)}
          </button>
        ))}
      </div>
    </div>
  )
}
