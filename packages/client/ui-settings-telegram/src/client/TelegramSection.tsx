/**
 * The Telegram settings section: edits the `telegram` settings namespace
 * (bot token, chat id) and drives the bridge connectivity test. The token is
 * a write-only secret — the mirror never returns it to the browser, so the
 * field starts blank and reports only whether one is configured; a blank
 * token field leaves the stored token untouched.
 */
import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import type { IApiClient } from '@deepseek-ai/dsh-api-remotes/client'
import type { SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import css from './TelegramSection.module.css'
import type { TelegramSettingsKey } from './locales.ts'

/** User-editable telegram settings section (bot token is redacted on read). */
export interface TelegramUserSettings {
  botToken?: string
  chatId?: string
}

/** Translate function signature the section uses. */
export type TelegramSectionTranslate = (key: TelegramSettingsKey) => string

/** What the section needs: the wire API, its settings scope, and copy. */
export interface TelegramSectionInjected {
  api: IApiClient['telegram']
  scope: SettingsScope<TelegramUserSettings>
  t: TelegramSectionTranslate
}

export type TelegramSectionProps = Partial<InjectFace<TelegramSectionInjected>>

/** Status line shown under the controls after an action. */
type Notice = { kind: 'ok' | 'error'; text: string }

/** Replace `{message}` placeholders in a translated template. */
function fill(template: string, params: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) => params[name] ?? match)
}

/**
 * Render the Telegram mirror settings form.
 * @param props - the wire api, the settings scope, and translated copy.
 * @returns the form, or nothing until the settings scope is served.
 */
export function TelegramSection(props: TelegramSectionProps) {
  const { api, scope, t } = props as TelegramSectionInjected
  const [chatId, setChatId] = useState('')
  const [tokenDraft, setTokenDraft] = useState('')
  const [configured, setConfigured] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)

  useEffect(() => {
    let live = true
    const refreshConfigured = async (): Promise<void> => {
      const response = await api.status({})
      if (!live) return
      if (response.result.ok) setConfigured(response.result.value.configured)
    }
    const unsubscribe = scope.subscribe(() => {
      const value = scope.getSnapshot().value
      if (live && value !== undefined) setChatId(value.chatId ?? '')
    })
    const value = scope.getSnapshot().value
    if (value !== undefined) setChatId(value.chatId ?? '')
    void refreshConfigured()
    return () => {
      live = false
      unsubscribe()
    }
    // The scope identity and api are stable for the section's lifetime.
  }, [])

  const refreshConfigured = async (): Promise<boolean> => {
    const response = await api.status({})
    if (!response.result.ok) return false
    setConfigured(response.result.value.configured)
    return response.result.value.configured
  }

  const save = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    setBusy(true)
    setNotice(null)
    try {
      if (tokenDraft.trim() !== '') await scope.set('botToken', tokenDraft.trim())
      await scope.set('chatId', chatId.trim())
      setTokenDraft('')
      await refreshConfigured()
      setNotice({ kind: 'ok', text: t('saved') })
    } catch {
      setNotice({ kind: 'error', text: t('saveFailed') })
    } finally {
      setBusy(false)
    }
  }

  const clearToken = async (): Promise<void> => {
    setBusy(true)
    try {
      await scope.unset('botToken')
      await refreshConfigured()
    } catch {
      setNotice({ kind: 'error', text: t('saveFailed') })
    } finally {
      setBusy(false)
    }
  }

  const test = async (): Promise<void> => {
    setBusy(true)
    setNotice(null)
    try {
      const response = await api.test({})
      if (response.result.ok) {
        setNotice({
          kind: response.result.value.ok ? 'ok' : 'error',
          text: response.result.value.ok
            ? t('testOk')
            : fill(t('testFailed'), { message: response.result.value.description ?? 'unknown' }),
        })
      } else {
        setNotice({ kind: 'error', text: fill(t('testFailed'), { message: response.result.error.message }) })
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className={css.section} onSubmit={event => void save(event)}>
      <p className={css.description}>{t('description')}</p>

      <div className={css.field}>
        <div className={css.head}>
          <label className={css.label} htmlFor="telegram-bot-token">{t('botTokenLabel')}</label>
          <span className={configured ? css.badge : css.badgeMuted}>
            {configured ? t('configured') : t('notConfigured')}
          </span>
        </div>
        <input
          id="telegram-bot-token"
          className={css.input}
          type="password"
          autoComplete="off"
          value={tokenDraft}
          disabled={busy}
          placeholder={configured ? '••••••••' : ''}
          onChange={event => setTokenDraft(event.target.value)}
        />
        <div className={css.hintRow}>
          <p className={css.hint}>{t('botTokenHint')}</p>
          {configured && (
            <button type="button" className={css.linkButton} disabled={busy} onClick={() => void clearToken()}>
              {t('clearToken')}
            </button>
          )}
        </div>
      </div>

      <div className={css.field}>
        <label className={css.label} htmlFor="telegram-chat-id">{t('chatIdLabel')}</label>
        <input
          id="telegram-chat-id"
          className={css.input}
          type="text"
          autoComplete="off"
          value={chatId}
          disabled={busy}
          onChange={event => setChatId(event.target.value)}
        />
        <p className={css.hint}>{t('chatIdHint')}</p>
        <p className={css.hint}>{t('chatIdHelp')}</p>
      </div>

      {notice !== null && <p className={notice.kind === 'ok' ? css.noticeOk : css.noticeError}>{notice.text}</p>}

      <div className={css.actions}>
        <button type="submit" className={css.button} disabled={busy}>{t('save')}</button>
        <button type="button" className={css.button} disabled={busy} onClick={() => void test()}>
          {t('test')}
        </button>
      </div>
    </form>
  )
}
