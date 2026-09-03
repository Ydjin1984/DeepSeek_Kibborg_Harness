/**
 * Workspace file panel button + drawer, browser half.
 *
 * One occupant of the `conversation.input.left` tool row (list seat) opens a
 * right-side drawer over the current session's project folder: a lazily
 * loaded file tree (host.listChildren), draggable file rows whose drop onto
 * the composer attaches the file as a draft (host.readTextFile bytes plus the
 * original project path, so the host cites that path instead of copying under
 * `.dsh/attachments/`), and a double-click Markdown
 * viewer/editor dialog (host.readTextFile / host.writeTextFile). Everything
 * rides the occupant's own session scope, so the input kit (inputActions,
 * useInput) and the injected host verbs share one session identity.
 *
 * Tree rows mirror the VSCode explorer: rows carry the entry base name (never
 * the absolute path), a twist chevron, and folder/file glyphs; a folder row
 * spans its whole width so one click expands or collapses it.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { IconTriangleRightFill14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { MarkdownDialog } from './MarkdownDialog.tsx'
import type { FilesLocaleKey } from './locales.ts'
import { FileGlyph, FolderGlyph } from './TreeIcons.tsx'
import css from './FilesPanel.module.css'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The workspace file panel's copy. */
    files: FilesLocaleKey
  }
}

export type { FilesLocaleKey }

/**
 * Non-enumerable `File` property this panel stamps so conversation's
 * `encodeFile` cites the original project path. Must stay equal to
 * `COMPOSER_FILE_SOURCE_PATH` in `@deepseek-ai/dsh-client-ui-conversation`.
 */
export const COMPOSER_FILE_SOURCE_PATH = 'dshSourcePath'

/** One child row of the project file tree. */
export interface FileTreeChild {
  readonly name: string
  readonly path: string
  readonly kind: 'directory' | 'file'
  readonly hidden: boolean
  readonly size?: number
}

/** One hosted text-file operation outcome (errors keep their wire codes). */
export type ReadTextOutcome =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly code: string; readonly message: string }

/** One hosted text-file write outcome. */
export type WriteTextOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string }

/** Injected host verbs, closure-bound to the occupant's session. */
export interface FilesInjected {
  /** List one project folder level (absolute path inside the session project). Rejects when the host cannot read it. */
  listChildren: (path: string, signal: AbortSignal) => Promise<readonly FileTreeChild[]>
  /** Read one project file as UTF-8 text. */
  readTextFile: (path: string) => Promise<ReadTextOutcome>
  /** Replace one project file's UTF-8 content. */
  writeTextFile: (path: string, text: string) => Promise<WriteTextOutcome>
}

/** Full props: the standard session kit (input actions + session store) plus the host verbs and locale. */
export type FilesPanelButtonProps =
  PropsRuntime<'conversation.input.left'>
  & FilesInjected
  & PropsLocale<'files'>

/** Internal drop payload carried by dragged file rows. */
interface DropPayload {
  readonly path: string
  readonly name: string
}

const DROP_TYPE = 'application/x-dsh-file-path'

/** A lightweight MIME projection so dropped files read as text on submit. */
function mimeFor(name: string): string {
  const lower = name.toLowerCase()
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return 'text/markdown'
  if (lower.endsWith('.json')) return 'application/json'
  if (lower.endsWith('.yml') || lower.endsWith('.yaml')) return 'text/yaml'
  return 'text/plain'
}

/** One expandable directory node plus its lazily loaded children. */
interface DirNode {
  readonly path: string
  /** Present once the listing succeeded; absent while not yet loaded or after a failure. */
  readonly children?: readonly FileTreeChild[]
  /** Listing failed: children could not be read (kept so the row offers a retry). */
  readonly failed?: boolean
  /** Listing in flight: the row disables itself to keep requests single. */
  readonly pending?: boolean
}

/**
 * Base display name of an absolute POSIX or Windows path: the last non-empty
 * path segment (`/p/docs` and `D:\proj\docs` both render as `docs`; a drive
 * root like `D:\` renders as `D:`).
 * @param path - absolute directory or file path.
 * @returns the last path segment, or the trimmed path when it has none.
 */
export function baseNameOf(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '')
  if (trimmed === '') return path
  const index = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  return index >= 0 ? trimmed.slice(index + 1) : trimmed
}

/** Left padding of a row at a given depth (the twist column is inside each row). */
function indentOf(depth: number): number {
  return 8 + depth * 16
}

/**
 * Join CSS module class names, dropping unbound keys. CSS modules are typed
 * through an index signature, so every named class is `string | undefined`
 * under noUncheckedIndexedAccess; this keeps row composition type-safe.
 * @param classes - candidate class names.
 * @returns the space-joined classes.
 */
function joinCss(...classes: Array<string | undefined>): string {
  return classes.filter((value): value is string => value !== undefined).join(' ')
}

/**
 * Render the file-panel trigger, the drawer, and the Markdown dialog.
 * @param props - standard input kit, session-routed host verbs, and locale.
 * @returns the tool-row button and its overlays.
 */
export function FilesPanelButton(props: FilesPanelButtonProps) {
  const {
    t, useSession, useSessions, useInput, inputActions,
    listChildren, readTextFile, writeTextFile,
  } = props
  const [open, setOpen] = useState(false)
  const [dirs, setDirs] = useState<ReadonlyMap<string, DirNode>>(new Map())
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const [root, setRoot] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ seq: number; text: string } | null>(null)
  const noticeSeq = useRef(0)
  const [markdownFile, setMarkdownFile] = useState<{ path: string; name: string; text: string } | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const removed = useSession(s => s.removed)
  const phase = useInput(s => s.phase)
  const busy = phase === 'adjudicating' || phase === 'submitting'
  const label = t('openButton')

  // The drawer root is the current session's project folder (the occupant
  // only exists inside that session's composer, so current == its session).
  const sessionCwd = useSessions((s) => {
    const current = s.current
    return current !== undefined ? s.byId[current]?.cwd : undefined
  })

  const showNotice = useCallback((text: string): void => {
    noticeSeq.current += 1
    setNotice({ seq: noticeSeq.current, text })
    if (toastTimer.current !== null) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => { setNotice(null) }, 5000)
  }, [])

  const showError = useCallback((error: { ok: false; code: string; message: string }, labelKey: FilesLocaleKey): void => {
    if (error.code === 'file-not-text') { showNotice(t('dropNotText')); return }
    if (error.code === 'file-too-large') { showNotice(t('dropTooLarge')); return }
    showNotice(t(labelKey, { message: error.message }))
  }, [showNotice, t])

  // Refresh the root when the session project changes.
  useEffect(() => {
    setDirs(new Map())
    setExpanded(new Set())
    setRoot(sessionCwd ?? null)
  }, [sessionCwd])

  // Load one folder level. Rows disable themselves while pending, so a second
  // request for the same folder cannot start from the UI; only the "already
  // loaded" guard is reachable here (collapse/expand of a known folder).
  const ensureChildren = useCallback(async (path: string): Promise<void> => {
    const current = dirs.get(path)
    if (current?.children !== undefined) return
    setDirs((previous) => {
      const next = new Map(previous)
      next.set(path, { path, pending: true })
      return next
    })
    try {
      const outcome = await listChildren(path, new AbortController().signal)
      setDirs((previous) => {
        const next = new Map(previous)
        next.set(path, { path, children: outcome })
        return next
      })
    } catch {
      setDirs((previous) => {
        const next = new Map(previous)
        next.set(path, { path, failed: true })
        return next
      })
    }
  }, [dirs, listChildren])

  // Load the root level once the drawer first opens. The guard is "never
  // started", not "loaded": a failed root must not re-fire from the effect
  // (that would loop); it stays put until the user retries from its row.
  const rootNode = root === null ? undefined : dirs.get(root)
  const rootInitiated = rootNode !== undefined
  useEffect(() => {
    if (!open || root === null || rootInitiated) return
    void ensureChildren(root)
  }, [open, root, rootInitiated, ensureChildren])

  const toggleDir = (path: string): void => {
    setExpanded((previous) => {
      const next = new Set(previous)
      if (next.has(path)) { next.delete(path); return next }
      next.add(path)
      return next
    })
  }

  // One click on a folder row loads its children first (VSCode lazy expand),
  // then flips the twist state; collapsed folders with children just collapse.
  const activateDir = (path: string): void => {
    void ensureChildren(path).then(() => { toggleDir(path) })
  }

  const openFile = async (entry: FileTreeChild): Promise<void> => {
    const outcome = await readTextFile(entry.path)
    if (!outcome.ok) { showError(outcome, 'openFailed'); return }
    setMarkdownFile({ path: entry.path, name: entry.name, text: outcome.text })
  }

  // Drag source: file rows carry the project path for the composer drop.
  const onDragStart = (event: React.DragEvent<HTMLElement>, entry: FileTreeChild): void => {
    const payload: DropPayload = { path: entry.path, name: entry.name }
    event.dataTransfer.setData(DROP_TYPE, JSON.stringify(payload))
    event.dataTransfer.setData('text/plain', entry.path)
    event.dataTransfer.effectAllowed = 'copy'
  }

  // Drop sink: a document-level listener turns an internal file-row drop into
  // an attached file draft (bytes read through the host, then the standard
  // inputActions.addFiles path the paperclip and OS drops use).
  // The dragover probe only inspects `types`: Chromium/Safari return an empty
  // string from getData() before the drop, so parsing there would reject every
  // internal drag; the payload is parsed once, on drop.
  const readDropPayload = (dataTransfer: DataTransfer | null): DropPayload | null => {
    if (dataTransfer === null || !dataTransfer.types.includes(DROP_TYPE)) return null
    const raw = dataTransfer.getData(DROP_TYPE)
    try {
      const parsed = JSON.parse(raw) as Partial<DropPayload>
      if (typeof parsed.path === 'string' && typeof parsed.name === 'string') {
        return { path: parsed.path, name: parsed.name }
      }
    } catch {
      // Malformed payloads are ignored; native OS drops continue untouched.
    }
    return null
  }
  useEffect(() => {
    const onDragOver = (event: globalThis.DragEvent): void => {
      const dataTransfer = event.dataTransfer
      if (dataTransfer === null || !dataTransfer.types.includes(DROP_TYPE)) return
      event.preventDefault()
      dataTransfer.dropEffect = 'copy'
    }
    const onDrop = (event: globalThis.DragEvent): void => {
      const payload = readDropPayload(event.dataTransfer)
      if (payload === null) return
      event.preventDefault()
      void readTextFile(payload.path).then((outcome) => {
        if (!outcome.ok) { showError(outcome, 'dropFailed'); return }
        const file = new File([outcome.text], payload.name, { type: mimeFor(payload.name) })
        Object.defineProperty(file, COMPOSER_FILE_SOURCE_PATH, { value: payload.path, enumerable: false })
        const rejected = inputActions.addFiles([file])
        if (rejected != null) showNotice(rejected)
      })
    }
    document.addEventListener('dragover', onDragOver)
    document.addEventListener('drop', onDrop)
    return () => {
      document.removeEventListener('dragover', onDragOver)
      document.removeEventListener('drop', onDrop)
    }
  }, [inputActions, readTextFile, showError, showNotice])

  // Persist the dialog's draft. The path is bound by the caller, so a save
  // that settles after the dialog closed cannot resurrect it (the functional
  // update keeps the nulled/other-file state as-is).
  const saveMarkdown = async (path: string, text: string): Promise<void> => {
    const outcome = await writeTextFile(path, text)
    if (!outcome.ok) throw new Error(outcome.message)
    setMarkdownFile(previous => (previous?.path === path ? { ...previous, text } : previous))
  }

  const rows: React.ReactNode[] = []
  const renderDir = (path: string, depth: number, hidden = false): void => {
    const node = dirs.get(path)
    const name = baseNameOf(path)
    const dirOpen = node?.children !== undefined && expanded.has(path)
    const pending = node?.pending === true
    const rowClass = joinCss(css.row, hidden ? css.muted : undefined)
    rows.push(
      <div
        key={path}
        className={rowClass}
        style={{ paddingLeft: `${indentOf(depth)}px` }}
        role="treeitem"
        aria-expanded={node?.children === undefined ? undefined : expanded.has(path)}
        aria-busy={pending || undefined}
        aria-label={name}
        title={path}
      >
        <button
          type="button"
          className={css.dirToggle}
          disabled={pending}
          aria-label={name}
          onClick={() => { activateDir(path) }}
        >
          {pending
            ? <span className={css.spinner} role="status" />
            : <IconTriangleRightFill14 size={12} className={joinCss(css.twist, dirOpen ? css.twistOpen : undefined)} />}
          <FolderGlyph open={dirOpen} />
          <span className={css.label}>{name}</span>
        </button>
      </div>,
    )
    if (node?.failed === true) {
      rows.push(
        <div
          key={`${path}:failed`}
          className={css.rowError}
          role="alert"
          style={{ paddingLeft: `${indentOf(depth) + 40}px` }}
        >
          <span>{t('loadFailed')}</span>
          <button type="button" className={css.retry} onClick={() => { void ensureChildren(path) }}>
            {t('retry')}
          </button>
        </div>,
      )
      return
    }
    if (node?.children !== undefined && expanded.has(path)) {
      for (const child of node.children) {
        if (child.kind === 'directory') renderDir(child.path, depth + 1, child.hidden)
      }
      for (const child of node.children) {
        if (child.kind === 'directory') continue
        rows.push(
          <div
            key={child.path}
            role="treeitem"
            className={joinCss(css.row, child.hidden ? css.muted : undefined)}
            style={{ paddingLeft: `${indentOf(depth + 1)}px` }}
            draggable
            onDragStart={(event) => { onDragStart(event, child) }}
            onDoubleClick={() => { void openFile(child) }}
            aria-label={child.name}
            title={child.path}
          >
            <span className={css.twistSlot} aria-hidden />
            <FileGlyph name={child.name} />
            <span className={css.label}>{child.name}</span>
          </div>,
        )
      }
    }
  }
  if (root !== null) renderDir(root, 0)
  const emptyRoot = rootNode?.children !== undefined && rootNode.children.length === 0

  return (
    <>
      <button
        type="button"
        className={css.trigger}
        aria-label={label}
        aria-expanded={open}
        disabled={removed || busy || sessionCwd === undefined}
        onClick={() => { setOpen(previous => !previous) }}
      >
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
          <path d="M2 4.5h4l1.2 1.5h6.8v6.5a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
      </button>
      {open && root !== null ? (
        <div className={css.drawerLayer} role="presentation" onClick={() => { setOpen(false) }}>
          <aside
            className={css.drawer}
            role="complementary"
            aria-label={t('drawerTitle')}
            onClick={(event) => { event.stopPropagation() }}
          >
            <div className={css.drawerHeader}>
              <div className={css.drawerTitle}>{t('drawerTitle')}</div>
              <button
                type="button"
                className={css.drawerClose}
                aria-label={t('drawerClose')}
                onClick={() => { setOpen(false) }}
              >
                ✕
              </button>
            </div>
            <div className={css.drawerBody} role="tree" aria-label={t('drawerTitle')}>
              {rows}
              {emptyRoot ? <div className={css.empty}>{t('drawerEmpty')}</div> : null}
              {rootNode === undefined || rootNode.pending === true
                ? <div className={css.empty}><span className={css.spinner} role="status" /></div>
                : null}
            </div>
            {notice !== null ? <div className={css.notice} role="status">{notice.text}</div> : null}
          </aside>
        </div>
      ) : null}
      {markdownFile !== null ? (
        <MarkdownDialog
          name={markdownFile.name}
          initialText={markdownFile.text}
          t={t}
          onSave={text => saveMarkdown(markdownFile.path, text)}
          onClose={() => { setMarkdownFile(null) }}
        />
      ) : null}
    </>
  )
}
