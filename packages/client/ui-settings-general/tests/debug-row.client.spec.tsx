// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createSnapshotStore, type SessionListState, type WorkspaceListState } from '@deepseek-ai/dsh-client-runtime/client'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { DebugRow } from '../src/client/DebugRow.tsx'
import type { DebugRowProps } from '../src/client/DebugRow.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const t: DebugRowProps['t'] = key => (en as Record<string, string>)[key] ?? key

function emptySessions() {
  const store = createSnapshotStore<SessionListState>(
    { ids: [], byId: {}, current: undefined, phase: 'ready', subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined })
  return bindSnapshotSelector(store)
}
function emptyWorkspaces() {
  const store = createSnapshotStore<WorkspaceListState>({
    items: [], archivedSessionIds: [], state: 'idle', phase: 'ready', error: null,
    baselinesReady: true, recentWorkspaceId: undefined,
  })
  return bindSnapshotSelector(store)
}

function mount(enabled = false) {
  const store = createSnapshotStore(enabled)
  const setEnabled = vi.fn()
  const props: DebugRowProps = {
    useSessions: emptySessions(),
    useWorkspaces: emptyWorkspaces(),
    useEnabled: bindSnapshotSelector(store),
    t,
    setEnabled,
  }
  render(<DebugRow {...props} />)
  return { store, setEnabled }
}

const pressed = (name: string): string | null =>
  screen.getByRole('button', { name }).getAttribute('aria-pressed')

describe('DebugRow', () => {
  it('renders the title and selects Off by default', () => {
    mount(false)
    expect(screen.getByText(en['debug.title'])).toBeTruthy()
    expect(pressed(en['debug.off'])).toBe('true')
    expect(pressed(en['debug.on'])).toBe('false')
  })

  it('click drives setEnabled; selection follows the store, not the click echo', () => {
    const b = mount(false)
    fireEvent.click(screen.getByRole('button', { name: en['debug.on'] }))
    expect(b.setEnabled).toHaveBeenCalledWith(true)
    expect(pressed(en['debug.off'])).toBe('true')
    act(() => { b.store.set(true) })
    expect(pressed(en['debug.on'])).toBe('true')
    expect(pressed(en['debug.off'])).toBe('false')
  })
})
