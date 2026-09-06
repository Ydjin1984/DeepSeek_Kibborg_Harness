/**
 * MCP servers settings section: the registry rows the running Host deploys
 * from, each with its live state, plus the add-server form. Every mutation
 * writes through the wire API (`mcp.list`/`mcp.save`/`mcp.remove`) and the
 * list reloads afterwards; state freshness is manual (the section re-reads on
 * open, after every mutation, and on the refresh button), which matches the
 * current absence of a pushed MCP-status event.
 */

import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import type { IApiClient } from '@deepseek-ai/dsh-api-remotes/client'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import styles from './McpSection.module.css'
import type { en } from './locales.ts'

/** Injected dependencies of {@link McpSection} (slot `inject`). */
export interface McpSectionInjected {
  /** Wire face the section reads and mutates the registry through. */
  api: Pick<IApiClient, 'mcp'>
  /** Section copy. */
  t: (key: keyof typeof en) => string
}

/**
 * Props delivered by the slot outlet: the inject face spread flat (the
 * renderer erases the share boundary at the render call).
 */
export type McpSectionProps = Partial<InjectFace<McpSectionInjected>>

type McpSectionFace = InjectFace<McpSectionInjected>

/** One declared server as the list renders it. */
interface ServerRow {
  name: string
  source: 'user' | 'project'
  kind?: 'stdio' | 'streamable-http'
  enabled: boolean
  command?: string
  url?: string
  state: 'disabled' | 'connected' | 'starting' | 'error'
  toolCount: number
  error?: string
}

/** Draft of the add-server form. */
interface Draft {
  name: string
  transport: 'stdio' | 'streamable-http'
  command: string
  args: string
  env: string
  cwd: string
  url: string
  headers: string
}

const emptyDraft: Draft = {
  name: '',
  transport: 'stdio',
  command: '',
  args: '',
  env: '',
  cwd: '',
  url: '',
  headers: '',
}

/** Parse KEY=VALUE lines into a record, skipping blank lines. */
function parseKeyValues(lines: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const raw of lines.split('\n')) {
    const line = raw.trim()
    if (line === '') continue
    const index = line.indexOf('=')
    if (index > 0) out[line.slice(0, index)] = line.slice(index + 1)
  }
  return out
}

/**
 * The MCP servers settings page.
 * @param props - slot props carrying the inject face.
 */
export function McpSection(props: McpSectionProps) {
  const { t, api } = props as McpSectionFace
  const [servers, setServers] = useState<ServerRow[]>([])
  const [loadError, setLoadError] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [actionError, setActionError] = useState<string | undefined>()

  const refresh = async (): Promise<void> => {
    setBusy(true)
    try {
      const response = await api.mcp.list({})
      if (!response.result.ok) {
        setLoadError(response.result.error.message)
        return
      }
      setServers(response.result.value.servers)
      setLoadError(undefined)
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    // Mount-only: the section is the navigation's content pane and remounts on
    // every open, which is the refresh cadence the wire API supports.
    void refresh()
  }, [])

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    setActionError(undefined)
    const name = draft.name.trim()
    if (name === '') {
      setActionError(t('validationFailed'))
      return
    }
    const entry: Record<string, unknown> = {}
    if (draft.transport === 'stdio') {
      if (draft.command.trim() === '') {
        setActionError(t('validationFailed'))
        return
      }
      entry.command = draft.command.trim()
      const args = draft.args.split('\n').map(line => line.trim()).filter(line => line !== '')
      if (args.length > 0) entry.args = args
      const env = parseKeyValues(draft.env)
      if (Object.keys(env).length > 0) entry.env = env
      if (draft.cwd.trim() !== '') entry.cwd = draft.cwd.trim()
    } else {
      if (draft.url.trim() === '') {
        setActionError(t('validationFailed'))
        return
      }
      entry.url = draft.url.trim()
      const headers = parseKeyValues(draft.headers)
      if (Object.keys(headers).length > 0) entry.headers = headers
    }
    setBusy(true)
    try {
      const response = await api.mcp.save({ name, entry })
      if (!response.result.ok) {
        setActionError(`${t('validationFailed')} ${response.result.error.message}`)
        return
      }
      setAdding(false)
      setDraft(emptyDraft)
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  const remove = async (name: string): Promise<void> => {
    setBusy(true)
    try {
      const response = await api.mcp.remove({ name })
      if (!response.result.ok) {
        setActionError(response.result.error.message)
        return
      }
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  const stateLabel = (row: ServerRow): string => {
    switch (row.state) {
      case 'connected': return t('stateConnected')
      case 'starting': return t('stateStarting')
      case 'error': return t('stateError')
      case 'disabled': return t('stateDisabled')
    }
  }

  return (
    <div className={styles.page}>
      <p className={styles.description}>{t('description')}</p>
      {loadError !== undefined && <p className={styles.errorText}>{t('loadFailed')} {loadError}</p>}
      {actionError !== undefined && <p className={styles.errorText}>{actionError}</p>}

      <div className={styles.toolbar}>
        <Button variant="primary" size="sm" disabled={busy} onClick={() => { setActionError(undefined); setAdding(true) }}>
          {t('addServer')}
        </Button>
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => { void refresh() }}>
          {t('refresh')}
        </Button>
      </div>

      {adding && (
        <form className={styles.form} onSubmit={(event) => { void submit(event) }}>
          <label className={styles.field}>
            <span>{t('serverName')}</span>
            <input
              value={draft.name}
              placeholder={t('serverNamePlaceholder')}
              onChange={(event) => { setDraft({ ...draft, name: event.target.value }) }}
            />
          </label>
          <label className={styles.field}>
            <span>{t('transport')}</span>
            <select
              value={draft.transport}
              onChange={(event) => { setDraft({
                ...draft,
                transport: event.target.value === 'stdio' ? 'stdio' : 'streamable-http',
              }) }}
            >
              <option value="stdio">{t('transportStdio')}</option>
              <option value="streamable-http">{t('transportHttp')}</option>
            </select>
          </label>
          {draft.transport === 'stdio' ? (
            <>
              <label className={styles.field}>
                <span>{t('command')}</span>
                <input
                  value={draft.command}
                  placeholder={t('commandPlaceholder')}
                  onChange={(event) => { setDraft({ ...draft, command: event.target.value }) }}
                />
              </label>
              <label className={styles.field}>
                <span>{t('args')}</span>
                <textarea
                  rows={3}
                  value={draft.args}
                  onChange={(event) => { setDraft({ ...draft, args: event.target.value }) }}
                />
              </label>
              <label className={styles.field}>
                <span>{t('env')}</span>
                <textarea
                  rows={3}
                  value={draft.env}
                  onChange={(event) => { setDraft({ ...draft, env: event.target.value }) }}
                />
              </label>
              <label className={styles.field}>
                <span>{t('cwd')}</span>
                <input
                  value={draft.cwd}
                  onChange={(event) => { setDraft({ ...draft, cwd: event.target.value }) }}
                />
              </label>
            </>
          ) : (
            <>
              <label className={styles.field}>
                <span>{t('url')}</span>
                <input
                  value={draft.url}
                  placeholder={t('urlPlaceholder')}
                  onChange={(event) => { setDraft({ ...draft, url: event.target.value }) }}
                />
              </label>
              <label className={styles.field}>
                <span>{t('headers')}</span>
                <textarea
                  rows={3}
                  value={draft.headers}
                  onChange={(event) => { setDraft({ ...draft, headers: event.target.value }) }}
                />
              </label>
            </>
          )}
          <div className={styles.actions}>
            <Button type="submit" variant="primary" size="sm" disabled={busy}>{t('save')}</Button>
            <Button variant="ghost" size="sm" onClick={() => { setAdding(false); setActionError(undefined) }}>
              {t('cancel')}
            </Button>
          </div>
        </form>
      )}

      <ul className={styles.list}>
        {servers.map(server => (
          <li key={`${server.source}:${server.name}`} className={styles.row}>
            <div className={styles.rowMain}>
              <div className={styles.rowTitle}>
                <span className={styles.name}>{server.name}</span>
                <span className={styles.badge}>{server.source === 'project' ? t('projectBadge') : t('userBadge')}</span>
                <span className={styles.badge}>{server.kind === 'stdio' ? t('stdioLabel') : t('httpLabel')}</span>
                <span className={`${styles.state} ${styles[`state${server.state}`] ?? ''}`}>
                  {stateLabel(server)}
                  {server.state === 'connected' && server.toolCount > 0 ? ` · ${server.toolCount} ${t('tools')}` : ''}
                </span>
              </div>
              <div className={styles.rowMeta}>
                {server.command ?? server.url ?? ''}
                {server.error !== undefined ? ` — ${server.error}` : ''}
              </div>
            </div>
            {server.source === 'user' && (
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => { void remove(server.name) }}
              >
                {t('remove')}
              </Button>
            )}
          </li>
        ))}
      </ul>
      {servers.length === 0 && !loadError && (
        <p className={styles.empty}>{t('empty')}</p>
      )}
      {servers.some(server => server.source === 'project') && (
        <p className={styles.hint}>{t('projectReadOnly')}</p>
      )}
    </div>
  )
}
