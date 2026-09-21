import type { PromptEntry } from '../contract/prompt-nav.ts'
import { visiblePromptWindow } from '../contract/prompt-nav.ts'
import css from './PromptRail.module.css'

/** Bounded, keyboard-accessible request navigation beside a transcript. */
export function PromptRail({ entries, activeKey, onSelect, label, navLabel, older }: {
  entries: readonly PromptEntry[]
  activeKey: string | null
  onSelect: (key: string) => void
  label: (index: number, preview: string) => string
  navLabel: string
  older?: { label: string; loading: boolean; onLoad: () => void } | undefined
}) {
  if (entries.length < 2 && older === undefined) return null
  const window = visiblePromptWindow(entries, activeKey)
  const before = window.before === null ? undefined : entries[window.before]
  const after = window.after === null ? undefined : entries[window.after]
  return (
    <nav className={css.rail} aria-label={navLabel} data-prompt-rail>
      {older !== undefined && (
        <button type="button" className={css.more} aria-label={older.label}
          disabled={older.loading} onClick={older.onLoad}>⋯</button>
      )}
      {before !== undefined && window.before !== null && (
        <button type="button" className={css.more} aria-label={label(window.before, before.preview)}
          onClick={() => { onSelect(before.key) }}>⋯</button>
      )}
      {window.items.map(entry => (
        <button
          key={entry.key}
          type="button"
          className={css.tick}
          data-prompt-tick
          aria-label={label(entry.index, entry.preview)}
          aria-current={entry.key === activeKey ? 'location' : undefined}
          onClick={() => { onSelect(entry.key) }}
        />
      ))}
      {after !== undefined && window.after !== null && (
        <button type="button" className={css.more} aria-label={label(window.after, after.preview)}
          onClick={() => { onSelect(after.key) }}>⋯</button>
      )}
    </nav>
  )
}
