/**
 * The composer's Telegram mirror toggle. One click attaches the current
 * session's mirror (the session's events then flow into the configured chat);
 * the active state highlights the button. While the bridge is unconfigured
 * the control is disabled with an explanatory title.
 */
import { useEffect, useState } from 'react'
import clsx from 'clsx'
import type { IApiClient } from '@deepseek-ai/dsh-api-remotes/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './TelegramMirrorButton.module.css'

/** Wire face the toggle drives. */
export interface TelegramMirrorInjected {
  api: IApiClient['telegram']
}

/** Mirror toggle state derived from the wire. */
type MirrorState = 'loading' | 'off' | 'on' | 'unconfigured'

type TelegramMirrorFace = TelegramMirrorInjected & PropsLocale<'telegram.mirror'>

/** Full props of the toggle: the composer session kit plus the injected wire face. */
export type TelegramMirrorButtonProps =
  PropsRuntime<'conversation.input.left'>
  & PropsLocale<'telegram.mirror'>
  & Partial<InjectFace<TelegramMirrorInjected>>

/**
 * Render the Telegram mirror toggle.
 * @param props - the composer session kit, the injected wire face, and copy.
 * @returns the toggle button.
 */
export function TelegramMirrorButton(props: TelegramMirrorButtonProps) {
  const { api, t } = props as TelegramMirrorFace
  const sessionId = props.useSession(s => s.sessionId)
  const removed = props.useSession(s => s.removed)
  const [state, setState] = useState<MirrorState>('loading')

  useEffect(() => {
    let live = true
    const probe = async (): Promise<void> => {
      const response = await api.status({ sessionId })
      if (!live) return
      if (!response.result.ok) {
        setState('unconfigured')
        return
      }
      if (!response.result.value.configured) {
        setState('unconfigured')
        return
      }
      setState(response.result.value.attached ? 'on' : 'off')
    }
    void probe()
    return () => {
      live = false
    }
    // The api face and session id are stable for the mounted entry.
  }, [])

  const disabled = removed || state === 'loading' || state === 'unconfigured'
  const title = state === 'on' ? t('titleActive') : (state === 'unconfigured' ? t('notConfiguredTitle') : t('title'))

  const toggle = async (): Promise<void> => {
    if (state === 'on') {
      await api.detach({ sessionId })
      setState('off')
      return
    }
    if (state === 'off') {
      const response = await api.attach({ sessionId })
      if (!response.result.ok) {
        setState(response.result.error.code === 'telegram-not-configured' ? 'unconfigured' : 'off')
        return
      }
      setState('on')
    }
  }

  return (
    <button
      type="button"
      className={clsx(css.button, state === 'on' && css.active)}
      title={title}
      aria-label={title}
      aria-pressed={state === 'on'}
      disabled={disabled}
      onClick={() => void toggle()}
    >
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden focusable="false">
        <path
          d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"
          fill="currentColor"
        />
      </svg>
    </button>
  )
}
