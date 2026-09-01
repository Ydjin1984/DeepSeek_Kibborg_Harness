/**
 * PaperclipButton: the composer's attach-files control, registered into the
 * `conversation.input.left` tool row beside the command-menu `+` button. One
 * click opens a format-unrestricted file picker; every picked file becomes a
 * file draft in the session input (any format — the host materializes the
 * bytes into the model context on submit and the model reads them by name).
 */

import { useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { Toast, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './PaperclipButton.module.css'

/** Full props of the paperclip: the standard session kit plus the conversation locale seat. */
export type PaperclipButtonProps =
  PropsRuntime<'conversation.input.left'>
  & PropsLocale<'conversation'>

/**
 * Render the composer's file-attach button.
 * @param props - the standard kit (input state + actions) and the locale seat.
 * @returns the paperclip button with its hidden picker, or nothing while no
 * input machine is mounted (the slot only renders with a session).
 */
export function PaperclipButton({
  useSession, useInput, inputActions, t,
}: PaperclipButtonProps) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const rootRef = useRef<HTMLSpanElement | null>(null)
  const removed = useSession(s => s.removed)
  const phase = useInput(s => s.phase)
  const [toast, setToast] = useState<{ seq: number; text: string } | null>(null)
  const toastSeq = useRef(0)
  const busy = phase === 'adjudicating' || phase === 'submitting'
  const label = t('file.attach')

  const onChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const picked = Array.from(event.currentTarget.files ?? [])
    // Reset the input so re-picking the same file fires change again.
    event.currentTarget.value = ''
    if (picked.length === 0) return
    const rejected = inputActions.addFiles(picked)
    if (rejected != null) {
      toastSeq.current += 1
      setToast({ seq: toastSeq.current, text: rejected })
    }
  }

  return (
    <span ref={rootRef} className={css.root}>
      <Tooltip label={label} side="top" delayMs={500}>
        <button
          type="button"
          className={css.trigger}
          aria-label={label}
          disabled={removed || busy}
          onClick={() => { inputRef.current?.click() }}
        >
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
            <path
              d="M9.5 3v6.5a2.5 2.5 0 0 1-5 0V4.5a1 1 0 0 1 2 0v5a.5.5 0 0 0 1 0V3a2 2 0 0 0-4 0v6.5a3.5 3.5 0 0 0 7 0V3"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </Tooltip>
      <input
        ref={inputRef}
        type="file"
        multiple
        className={css.fileInput}
        tabIndex={-1}
        aria-hidden
        onChange={onChange}
      />
      {toast !== null && (
        <Toast
          key={toast.seq}
          text={toast.text}
          anchor={rootRef.current?.closest<HTMLElement>('[data-composer-card]') ?? null}
          onDone={() => { setToast(null) }}
        />
      )}
    </span>
  )
}
