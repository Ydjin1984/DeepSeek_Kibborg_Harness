// @vitest-environment jsdom
/**
 * FilesPanelButton: the composer trigger opens the drawer, tree rows show
 * base names (POSIX and Windows) with lazy expand, failures and retries are
 * surfaced, hidden entries stay listed, and internal drags attach files
 * without breaking Chromium's dragover semantics.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  baseNameOf, FilesPanelButton, type FilesInjected, type FileTreeChild,
} from '../src/client/FilesPanelButton.tsx'

afterEach(cleanup)

const t = ((key: string) => key) as FilesPanelButtonProps['t']

type FilesPanelButtonProps = React.ComponentProps<typeof FilesPanelButton>

/** Internal drop wire type; must match FilesPanelButton's DROP_TYPE constant. */
const DROP_TYPE = 'application/x-dsh-file-path'

/** Plain props with stubbed framework hooks over a two-node project. */
function bench(over: Partial<FilesPanelButtonProps> = {}) {
  const injected: FilesInjected = {
    listChildren: over.listChildren
      ?? vi.fn(async () => [
        { name: 'docs', path: '/p/docs', kind: 'directory', hidden: false },
        { name: 'a.md', path: '/p/a.md', kind: 'file', hidden: false, size: 3 },
      ] as FileTreeChild[]),
    readTextFile: over.readTextFile ?? vi.fn(async () => ({ ok: true as const, text: '# Привет\n' })),
    writeTextFile: over.writeTextFile ?? vi.fn(async () => ({ ok: true as const })),
  }
  const defaultInputActions = { addFiles: vi.fn(() => null) }
  const inputActions = (over.inputActions ?? defaultInputActions) as { addFiles: ReturnType<typeof vi.fn> }
  const props = ({
    useSession: (selector: (snap: { removed: boolean }) => unknown) => selector({ removed: false }),
    useSessions: (selector: (list: { current: string; byId: Record<string, { cwd?: string }> }) => unknown) =>
      selector({ current: 's1', byId: { s1: { cwd: '/p' } } }),
    useInput: (selector: (snap: { phase: string }) => unknown) => selector({ phase: 'plain' }),
    inputActions,
    t,
    ...injected,
    ...over,
  }) as unknown as FilesPanelButtonProps
  return { props, injected, inputActions }
}

/** Open the drawer and wait for the session root listing. */
async function openDrawer(props: FilesPanelButtonProps): Promise<void> {
  render(<FilesPanelButton {...props} />)
  fireEvent.click(screen.getByRole('button', { name: 'openButton' }))
  await waitFor(() => { expect(screen.getByRole('complementary', { name: 'drawerTitle' })).toBeTruthy() })
}

interface FakeDataTransfer {
  readonly types: readonly string[]
  getData: (type: string) => string
  dropEffect?: string
}

/** Build a cancelable dragover/drop event carrying a fake DataTransfer. */
function dragEventOf(type: 'dragover' | 'drop', dataTransfer: FakeDataTransfer | null): Event {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'dataTransfer', { value: dataTransfer })
  return event
}

describe('baseNameOf', () => {
  it('returns the last non-empty segment of POSIX and Windows paths', () => {
    expect(baseNameOf('/p/docs')).toBe('docs')
    expect(baseNameOf('/p/docs/')).toBe('docs')
    expect(baseNameOf('D:\\Proj\\app')).toBe('app')
    expect(baseNameOf('D:\\Proj\\app\\src\\')).toBe('src')
    expect(baseNameOf('docs')).toBe('docs')
    expect(baseNameOf('')).toBe('')
    expect(baseNameOf('/')).toBe('/')
  })

  it('keeps a Windows drive root readable', () => {
    expect(baseNameOf('D:\\')).toBe('D:')
    expect(baseNameOf('D:')).toBe('D:')
  })
})

describe('FilesPanelButton tree', () => {
  it('opens the drawer and loads the session project root', async () => {
    const { props, injected } = bench()
    await openDrawer(props)
    await waitFor(() => { expect(injected.listChildren).toHaveBeenCalledWith('/p', expect.any(AbortSignal)) })
    // The root folder row shows its base name, not the absolute path.
    expect(screen.getByRole('button', { name: 'p' })).toBeTruthy()
    expect(screen.queryByText('/p')).toBeNull()
  })

  it('shows Windows paths by folder base name only', async () => {
    const { props, injected } = bench({
      useSessions: (selector: (list: { current: string; byId: Record<string, { cwd?: string }> }) => unknown) =>
        selector({ current: 's1', byId: { s1: { cwd: 'D:\\Proj\\app' } } }),
      listChildren: vi.fn(async () => [
        { name: 'src', path: 'D:\\Proj\\app\\src', kind: 'directory', hidden: false },
        { name: 'main.ts', path: 'D:\\Proj\\app\\main.ts', kind: 'file', hidden: false },
      ] as FileTreeChild[]),
    })
    await openDrawer(props)
    await waitFor(() => { expect(injected.listChildren).toHaveBeenCalledWith('D:\\Proj\\app', expect.any(AbortSignal)) })
    // Root row carries the project base name.
    expect(screen.getByRole('button', { name: 'app' })).toBeTruthy()
    // Expanding shows child rows by base name; absolute paths never render.
    fireEvent.click(screen.getByRole('button', { name: 'app' }))
    await waitFor(() => {
      expect(screen.getByRole('treeitem', { name: 'src' })).toBeTruthy()
      expect(screen.getByRole('treeitem', { name: 'main.ts' })).toBeTruthy()
    })
    expect(screen.queryByText('D:\\Proj\\app\\src')).toBeNull()
    expect(screen.queryByText('D:\\Proj\\app')).toBeNull()
  })

  it('expands folders lazily and opens a Markdown file on double-click', async () => {
    const { props, injected } = bench({
      listChildren: vi.fn(async (path: string) =>
        path === '/p/docs'
          ? [{ name: 'nested.md', path: '/p/docs/nested.md', kind: 'file', hidden: false }] as FileTreeChild[]
          : [
            { name: 'docs', path: '/p/docs', kind: 'directory', hidden: false },
            { name: 'a.md', path: '/p/a.md', kind: 'file', hidden: false, size: 3 },
          ] as FileTreeChild[]),
    })
    await openDrawer(props)
    await waitFor(() => { expect(injected.listChildren).toHaveBeenCalledWith('/p', expect.any(AbortSignal)) })
    // Expand the root folder row; its toggle button is named by the folder.
    fireEvent.click(screen.getByRole('button', { name: 'p' }))
    await waitFor(() => { expect(screen.getByText('a.md')).toBeTruthy() })
    // Expand the nested docs folder and read its file.
    fireEvent.click(screen.getByRole('button', { name: 'docs' }))
    await waitFor(() => { expect(injected.listChildren).toHaveBeenCalledWith('/p/docs', expect.any(AbortSignal)) })
    expect(await screen.findByText('nested.md')).toBeTruthy()
    fireEvent.dblClick(screen.getByText('a.md'))
    await waitFor(() => {
      expect(injected.readTextFile).toHaveBeenCalledWith('/p/a.md')
      expect(screen.getByText('Привет')).toBeTruthy()
    })
  })

  it('does not re-list an already loaded folder when clicked again', async () => {
    const { props, injected } = bench()
    await openDrawer(props)
    await waitFor(() => { expect(injected.listChildren).toHaveBeenCalledWith('/p', expect.any(AbortSignal)) })
    const root = screen.getByRole('button', { name: 'p' })
    fireEvent.click(root) // expand
    await waitFor(() => { expect(screen.getByText('a.md')).toBeTruthy() })
    fireEvent.click(screen.getByRole('button', { name: 'p' })) // collapse
    fireEvent.click(screen.getByRole('button', { name: 'p' })) // expand again
    await waitFor(() => { expect(screen.getByText('a.md')).toBeTruthy() })
    expect(injected.listChildren).toHaveBeenCalledTimes(1)
  })

  it('disables a folder row while its listing is in flight', async () => {
    const { props, injected } = bench({
      listChildren: vi.fn((path: string) =>
        path === '/p'
          ? Promise.resolve([{ name: 'docs', path: '/p/docs', kind: 'directory', hidden: false }] as FileTreeChild[])
          : new Promise<readonly FileTreeChild[]>(() => { /* never settles while pending */ })),
    })
    await openDrawer(props)
    await waitFor(() => { expect(injected.listChildren).toHaveBeenCalledWith('/p', expect.any(AbortSignal)) })
    const root = screen.getByRole('button', { name: 'p' }) as HTMLButtonElement
    await waitFor(() => { expect(root.disabled).toBe(false) })
    fireEvent.click(root)
    const docs = await screen.findByRole('button', { name: 'docs' })
    await waitFor(() => { expect((docs as HTMLButtonElement).disabled).toBe(false) })
    fireEvent.click(docs)
    await waitFor(() => { expect((docs as HTMLButtonElement).disabled).toBe(true) })
    // The root and the folder were listed exactly once each.
    expect(injected.listChildren).toHaveBeenCalledTimes(2)
  })

  it('lists an empty project root with the empty hint', async () => {
    const { props } = bench({ listChildren: vi.fn(async () => []) })
    await openDrawer(props)
    expect(await screen.findByText('drawerEmpty')).toBeTruthy()
  })

  it('lists hidden entries among the visible ones', async () => {
    const { props } = bench({
      listChildren: vi.fn(async () => [
        { name: '.git', path: '/p/.git', kind: 'directory', hidden: true },
        { name: '.gitignore', path: '/p/.gitignore', kind: 'file', hidden: true },
        { name: 'a.md', path: '/p/a.md', kind: 'file', hidden: false },
      ] as FileTreeChild[]),
    })
    await openDrawer(props)
    fireEvent.click(screen.getByRole('button', { name: 'p' }))
    await waitFor(() => {
      expect(screen.getByRole('treeitem', { name: '.git' })).toBeTruthy()
      expect(screen.getByRole('treeitem', { name: '.gitignore' })).toBeTruthy()
      expect(screen.getByRole('treeitem', { name: 'a.md' })).toBeTruthy()
    })
  })

  it('shows a failure row and retries the folder listing', async () => {
    const { props, injected } = bench({
      listChildren: vi.fn(async () => { throw new Error('boom') }),
    })
    await openDrawer(props)
    expect(await screen.findByText('loadFailed')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'retry' }))
    await waitFor(() => { expect(injected.listChildren).toHaveBeenCalledTimes(2) })
  })

  it('can recover from a failed listing via retry', async () => {
    const { props } = bench({
      listChildren: vi.fn()
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValue([{ name: 'a.md', path: '/p/a.md', kind: 'file', hidden: false }] as FileTreeChild[]),
    })
    await openDrawer(props)
    expect(await screen.findByText('loadFailed')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'retry' }))
    await waitFor(() => { expect(screen.queryByText('loadFailed')).toBeNull() })
    // The recovered root expands normally.
    fireEvent.click(screen.getByRole('button', { name: 'p' }))
    expect(await screen.findByText('a.md')).toBeTruthy()
  })
})

describe('FilesPanelButton file opening errors', () => {
  it('reports a non-text file', async () => {
    const { props } = bench({
      readTextFile: vi.fn(async () => ({ ok: false as const, code: 'file-not-text', message: '' })),
    })
    await openDrawer(props)
    fireEvent.click(screen.getByRole('button', { name: 'p' }))
    fireEvent.dblClick(await screen.findByText('a.md'))
    expect(await screen.findByText('dropNotText')).toBeTruthy()
  })

  it('reports an oversized file', async () => {
    const { props } = bench({
      readTextFile: vi.fn(async () => ({ ok: false as const, code: 'file-too-large', message: '' })),
    })
    await openDrawer(props)
    fireEvent.click(screen.getByRole('button', { name: 'p' }))
    fireEvent.dblClick(await screen.findByText('a.md'))
    expect(await screen.findByText('dropTooLarge')).toBeTruthy()
  })

  it('reports a generic open failure with the wire message', async () => {
    const { props } = bench({
      readTextFile: vi.fn(async () => ({ ok: false as const, code: 'boom', message: 'kaput' })),
    })
    await openDrawer(props)
    fireEvent.click(screen.getByRole('button', { name: 'p' }))
    fireEvent.dblClick(await screen.findByText('a.md'))
    expect(await screen.findByText('openFailed')).toBeTruthy()
  })
})

describe('FilesPanelButton drag and drop', () => {
  it('accepts internal drags on dragover without reading the payload', async () => {
    const { props } = bench()
    render(<FilesPanelButton {...props} />)
    const getData = vi.fn(() => '')
    const event = dragEventOf('dragover', { types: [DROP_TYPE], getData })
    act(() => { document.dispatchEvent(event) })
    expect(event.defaultPrevented).toBe(true)
    // Chromium returns an empty string from getData before drop; parsing here
    // would reject every internal drag, so dragover must only inspect types.
    expect(getData).not.toHaveBeenCalled()
  })

  it('ignores foreign drags on dragover', async () => {
    const { props } = bench()
    render(<FilesPanelButton {...props} />)
    const event = dragEventOf('dragover', { types: ['Files'], getData: vi.fn(() => '') })
    act(() => { document.dispatchEvent(event) })
    expect(event.defaultPrevented).toBe(false)
  })

  it('attaches an internal file drop as a draft', async () => {
    const { props, injected, inputActions } = bench()
    render(<FilesPanelButton {...props} />)
    const event = dragEventOf('drop', {
      types: [DROP_TYPE],
      getData: (type: string) => type === DROP_TYPE ? JSON.stringify({ path: '/p/a.md', name: 'a.md' }) : '',
    })
    await act(async () => { document.dispatchEvent(event) })
    expect(event.defaultPrevented).toBe(true)
    await waitFor(() => { expect(injected.readTextFile).toHaveBeenCalledWith('/p/a.md') })
    await waitFor(() => {
      expect(inputActions.addFiles).toHaveBeenCalledWith([expect.any(File)])
      expect((inputActions.addFiles.mock.calls[0]?.[0] as File[])[0]?.name).toBe('a.md')
    })
  })

  it('ignores a malformed internal payload on drop', async () => {
    const { props, inputActions } = bench()
    render(<FilesPanelButton {...props} />)
    const event = dragEventOf('drop', { types: [DROP_TYPE], getData: () => 'not-json' })
    act(() => { document.dispatchEvent(event) })
    expect(event.defaultPrevented).toBe(false)
    expect(inputActions.addFiles).not.toHaveBeenCalled()
  })

  it('surfaces a drop whose file is not readable text', async () => {
    const { props } = bench({
      readTextFile: vi.fn(async () => ({ ok: false as const, code: 'file-not-text', message: '' })),
    })
    await openDrawer(props)
    const event = dragEventOf('drop', {
      types: [DROP_TYPE],
      getData: () => JSON.stringify({ path: '/p/a.md', name: 'a.md' }),
    })
    await act(async () => { document.dispatchEvent(event) })
    expect(await screen.findByText('dropNotText')).toBeTruthy()
  })

  it('surfaces a composer rejection of the attached draft', async () => {
    const { props } = bench({
      inputActions: { addFiles: vi.fn(() => 'too-many') },
    } as unknown as Partial<FilesPanelButtonProps>)
    await openDrawer(props)
    const event = dragEventOf('drop', {
      types: [DROP_TYPE],
      getData: () => JSON.stringify({ path: '/p/a.md', name: 'a.md' }),
    })
    await act(async () => { document.dispatchEvent(event) })
    expect(await screen.findByText('too-many')).toBeTruthy()
  })
})

describe('FilesPanelButton trigger gating', () => {
  it('disables the trigger while the session is being removed', async () => {
    const { props } = bench({
      useSession: (selector: (snap: { removed: boolean }) => unknown) => selector({ removed: true }),
    })
    render(<FilesPanelButton {...props} />)
    expect(screen.getByRole('button', { name: 'openButton' }).disabled).toBe(true)
  })

  it('disables the trigger while a message is submitting', async () => {
    const { props } = bench({
      useInput: (selector: (snap: { phase: string }) => unknown) => selector({ phase: 'submitting' }),
    })
    render(<FilesPanelButton {...props} />)
    expect(screen.getByRole('button', { name: 'openButton' }).disabled).toBe(true)
  })

  it('disables the trigger when the session has no project folder', async () => {
    const { props } = bench({
      useSessions: (selector: (list: { current: string; byId: Record<string, { cwd?: string }> }) => unknown) =>
        selector({ current: 's1', byId: { s1: {} } }),
    })
    render(<FilesPanelButton {...props} />)
    expect(screen.getByRole('button', { name: 'openButton' }).disabled).toBe(true)
  })

  it('disables the trigger when no session is current', async () => {
    const { props } = bench({
      useSessions: (selector: (list: { current: string; byId: Record<string, { cwd?: string }> }) => unknown) =>
        selector({ current: undefined as unknown as string, byId: {} }),
    })
    render(<FilesPanelButton {...props} />)
    expect(screen.getByRole('button', { name: 'openButton' }).disabled).toBe(true)
  })
})

describe('FilesPanelButton drawer close', () => {
  it('closes the drawer through its close button', async () => {
    const { props } = bench()
    await openDrawer(props)
    fireEvent.click(screen.getByRole('button', { name: 'drawerClose' }))
    expect(screen.queryByRole('complementary', { name: 'drawerTitle' })).toBeNull()
  })

  it('closes the drawer when its backdrop is clicked', async () => {
    const { props } = bench()
    await openDrawer(props)
    fireEvent.click(screen.getByRole('presentation'))
    expect(screen.queryByRole('complementary', { name: 'drawerTitle' })).toBeNull()
  })

  it('closes the Markdown dialog through its close button', async () => {
    const { props } = bench()
    await openDrawer(props)
    fireEvent.click(screen.getByRole('button', { name: 'p' }))
    fireEvent.dblClick(await screen.findByText('a.md'))
    expect(await screen.findByRole('dialog')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'markdownClose' }))
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
  })
})

describe('FilesPanelButton drag source', () => {
  it('carries the project path on drag start', async () => {
    const { props } = bench()
    await openDrawer(props)
    fireEvent.click(screen.getByRole('button', { name: 'p' }))
    const row = await screen.findByRole('treeitem', { name: 'a.md' })
    const dataTransfer = { setData: vi.fn(), effectAllowed: 'none' }
    fireEvent.dragStart(row, { dataTransfer })
    expect(dataTransfer.setData).toHaveBeenCalledWith(DROP_TYPE, JSON.stringify({ path: '/p/a.md', name: 'a.md' }))
    expect(dataTransfer.setData).toHaveBeenCalledWith('text/plain', '/p/a.md')
    expect(dataTransfer.effectAllowed).toBe('copy')
  })
})

describe('FilesPanelButton drop edges', () => {
  it('projects a MIME type per dropped file name', async () => {
    const { props, inputActions } = bench()
    render(<FilesPanelButton {...props} />)
    const cases: ReadonlyArray<readonly [string, string]> = [
      ['a.md', 'text/markdown'],
      ['b.markdown', 'text/markdown'],
      ['c.json', 'application/json'],
      ['d.yml', 'text/yaml'],
      ['e.yaml', 'text/yaml'],
      ['f.txt', 'text/plain'],
    ]
    for (const [name] of cases) {
      const event = dragEventOf('drop', {
        types: [DROP_TYPE],
        getData: () => JSON.stringify({ path: `/p/${name}`, name }),
      })
      await act(async () => { document.dispatchEvent(event) })
    }
    await waitFor(() => { expect(inputActions.addFiles).toHaveBeenCalledTimes(cases.length) })
    const files = inputActions.addFiles.mock.calls.map(call => (call[0] as File[])[0])
    expect(files.map(file => `${file?.name}:${file?.type}`)).toEqual(cases.map(([name, type]) => `${name}:${type}`))
  })

  it('ignores drops without a data transfer', async () => {
    const { props, inputActions } = bench()
    render(<FilesPanelButton {...props} />)
    const event = dragEventOf('drop', null)
    act(() => { document.dispatchEvent(event) })
    expect(event.defaultPrevented).toBe(false)
    expect(inputActions.addFiles).not.toHaveBeenCalled()
  })

  it('ignores dragover events without a data transfer', async () => {
    const { props } = bench()
    render(<FilesPanelButton {...props} />)
    const event = dragEventOf('dragover', null)
    act(() => { document.dispatchEvent(event) })
    expect(event.defaultPrevented).toBe(false)
  })

  it('ignores foreign file drops', async () => {
    const { props, inputActions } = bench()
    render(<FilesPanelButton {...props} />)
    const event = dragEventOf('drop', { types: ['Files'], getData: vi.fn(() => '') })
    act(() => { document.dispatchEvent(event) })
    expect(event.defaultPrevented).toBe(false)
    expect(inputActions.addFiles).not.toHaveBeenCalled()
  })
})

describe('FilesPanelButton notices', () => {
  it('auto-dismisses a toast and clears the previous timer on repeat', async () => {
    vi.useFakeTimers()
    try {
      const { props } = bench({
        inputActions: { addFiles: vi.fn(() => 'denied') },
      } as unknown as Partial<FilesPanelButtonProps>)
      render(<FilesPanelButton {...props} />)
      fireEvent.click(screen.getByRole('button', { name: 'openButton' }))
      const drop = (): Event => dragEventOf('drop', {
        types: [DROP_TYPE],
        getData: () => JSON.stringify({ path: '/p/a.md', name: 'a.md' }),
      })
      await act(async () => { document.dispatchEvent(drop()) })
      expect(screen.getByText('denied')).toBeTruthy()
      // A second notice replaces the first and clears its pending timer.
      await act(async () => { document.dispatchEvent(drop()) })
      expect(screen.getByText('denied')).toBeTruthy()
      act(() => { vi.advanceTimersByTime(5001) })
      expect(screen.queryByText('denied')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('FilesPanelButton save flows', () => {
  async function openEditedDialog(): Promise<void> {
    fireEvent.click(screen.getByRole('button', { name: 'p' }))
    fireEvent.dblClick(await screen.findByText('a.md'))
    fireEvent.click(await screen.findByRole('tab', { name: 'markdownEdit' }))
  }

  it('saves an edited file through the dialog', async () => {
    const { props, injected } = bench()
    await openDrawer(props)
    await openEditedDialog()
    fireEvent.click(screen.getByRole('button', { name: 'markdownSave' }))
    await waitFor(() => { expect(injected.writeTextFile).toHaveBeenCalledWith('/p/a.md', '# Привет\n') })
    expect(await screen.findByText('markdownSaved')).toBeTruthy()
  })

  it('surfaces a failed save in the dialog', async () => {
    const { props } = bench({
      writeTextFile: vi.fn(async () => ({ ok: false as const, message: 'nope' })),
    })
    await openDrawer(props)
    await openEditedDialog()
    fireEvent.click(screen.getByRole('button', { name: 'markdownSave' }))
    expect(await screen.findByText('markdownSaveFailed')).toBeTruthy()
  })

  it('does not reopen the dialog when a save settles after close', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const { props } = bench({
      writeTextFile: vi.fn(async () => { await gate; return { ok: true as const } }),
    })
    await openDrawer(props)
    await openEditedDialog()
    fireEvent.click(screen.getByRole('button', { name: 'markdownSave' }))
    fireEvent.click(screen.getByRole('button', { name: 'markdownClose' }))
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
    await act(async () => { release() })
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
