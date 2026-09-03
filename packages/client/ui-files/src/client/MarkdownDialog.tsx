/**
 * Built-in Markdown viewer/editor dialog: preview through the shared
 * MarkdownText renderer, edit in a plain textarea, and save through the host
 * project write RPC. Preview and edit share one local draft so switching tabs
 * never loses edits; a dirty close asks before discarding.
 */

import { useEffect, useRef, useState } from 'react'
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { FilesLocaleKey } from './locales.ts'
import css from './FilesPanel.module.css'

/** Props of the Markdown dialog. */
export interface MarkdownDialogProps {
  /** File base name shown in the heading. */
  name: string
  /** Initial content read from the host. */
  initialText: string
  /** Persist one edited draft through the host; rejects on failure. */
  onSave: (text: string) => Promise<void>
  /** Locale reader for the Files namespace. */
  t: TranslateNS<'files'>
  /** Close the dialog (the caller decides whether to keep other state). */
  onClose: () => void
}

/**
 * Render one Markdown file's preview/edit dialog.
 * @param props - file identity, initial content, save verb, and locale.
 * @returns the dialog overlay.
 */
export function MarkdownDialog({ name, initialText, onSave, t, onClose }: MarkdownDialogProps) {
  const [mode, setMode] = useState<'view' | 'edit'>('view')
  const [draft, setDraft] = useState(initialText)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  // Draft-state tracking for the dirty close guard.
  const dirtyRef = useRef(false)

  // Keep the draft in sync when a sibling file opens with fresh content.
  const lastInitial = useRef(initialText)
  useEffect(() => {
    if (lastInitial.current === initialText) return
    lastInitial.current = initialText
    dirtyRef.current = false
    setDraft(initialText)
    setSaved(false)
    setError(null)
  }, [initialText])

  const markDirty = (value: string): void => {
    dirtyRef.current = true
    setDraft(value)
  }

  const save = async (): Promise<void> => {
    // A fast second Enter/click can land before the disabled state paints;
    // jsdom cannot reach the guard through the disabled save button.
    /* v8 ignore next -- double-save guard behind the disabled button */
    if (saving) return
    setSaving(true)
    setError(null)
    try {
      await onSave(draft)
      dirtyRef.current = false
      setSaved(true)
      setMode('view')
    } catch (cause) {
      setError(t('markdownSaveFailed', { message: cause instanceof Error ? cause.message : String(cause) }))
    } finally {
      setSaving(false)
    }
  }

  const close = (): void => {
    if (dirtyRef.current && !window.confirm(t('markdownDirty'))) return
    onClose()
  }

  // Escape closes the dialog; a dirty draft still asks before discarding.
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      close()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown) }
  })

  return (
    <div className={css.overlay} role="presentation">
      <div className={css.markdownDialog} role="dialog" aria-modal="true" aria-label={`${t('markdownTitle')}: ${name}`}>
        <div className={css.dialogHeader}>
          <h3 className={css.dialogTitle} title={name}>{name}</h3>
          <div className={css.dialogTabs} role="tablist" aria-label={t('markdownTitle')}>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'view'}
              className={mode === 'view' ? `${css.tab} ${css.tabActive}` : css.tab}
              onClick={() => { setMode('view') }}
            >
              {t('markdownView')}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'edit'}
              className={mode === 'edit' ? `${css.tab} ${css.tabActive}` : css.tab}
              onClick={() => { setMode('edit') }}
            >
              {t('markdownEdit')}
            </button>
          </div>
          <div className={css.dialogHeaderActions}>
            {saved ? <span className={css.savedNote} role="status">{t('markdownSaved')}</span> : null}
            {saving ? <span className={css.savingNote}>{t('markdownSaving')}</span> : null}
            {mode === 'edit'
              ? (
                <button
                  type="button"
                  className={css.buttonPrimary}
                  disabled={saving}
                  onClick={() => { void save() }}
                >
                  {t('markdownSave')}
                </button>
              )
              : null}
            <button type="button" className={css.buttonSecondary} onClick={close}>
              {t('markdownClose')}
            </button>
          </div>
        </div>
        {error !== null ? <p className={css.failure} role="alert">{error}</p> : null}
        <div className={css.dialogBody}>
          {mode === 'view'
            ? (
              <div className={css.markdownPreview} data-markdown-preview>
                <MarkdownText text={draft} />
              </div>
            )
            : (
              <textarea
                className={css.markdownEditor}
                aria-label={t('markdownEdit')}
                value={draft}
                spellCheck={false}
                onChange={(event) => { markDirty(event.currentTarget.value) }}
              />
            )}
        </div>
      </div>
    </div>
  )
}

// Local import guard keeps the locale key type reachable for callers.
export type { FilesLocaleKey }
