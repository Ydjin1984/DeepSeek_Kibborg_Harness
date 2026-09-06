// @vitest-environment jsdom
/** The section: session gating, load lifecycle, category rows, and bulk toggles. */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ClaudeCodeSection } from '../src/client/ClaudeCodeSection.tsx'
import type { ClaudeCodeSectionProps } from '../src/client/ClaudeCodeSection.tsx'
import { en } from '../src/client/locales.ts'
import type { CcActions } from '../src/client/claude-code-api.ts'
import { ALL_LIBRARY_SKILLS, CATEGORIES, RECOMMENDED, UMBRELLA_SKILL } from '../src/client/groups.data.ts'
import { fakeActions, summary, t } from './helpers.client.ts'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

/** Render the section over a fake action table; returns the actions for assertions. */
function renderSection(over: Partial<CcActions> = {}, current: string | null = 'session-1') {
  const actions = fakeActions(over)
  const props = {
    t,
    actions,
    useSessions: (selector: (snapshot: unknown) => unknown) => selector({
      current: current ?? undefined,
      ids: [],
      byId: {},
      phase: 'ready',
      subagentsByParent: {},
      jobsBySession: {},
    }),
    useLocale: (selector: (value: string) => unknown) => selector('en'),
    close: () => {},
  } as unknown as ClaudeCodeSectionProps
  render(<ClaudeCodeSection {...props} />)
  return actions
}

/** Library skills as enabled=false summaries (scope project). */
function disabledLibrary(): ReturnType<typeof summary>[] {
  return ALL_LIBRARY_SKILLS.map(name => summary({ name, enabled: false, status: 'disabled' }))
}

describe('ClaudeCodeSection', () => {
  it('asks for a session before managing the library', async () => {
    renderSection({}, null)

    expect(screen.getByText(en.noSession)).toBeTruthy()
    expect(screen.queryByText(en.catTesting)).toBeNull()
  })

  it('loads the catalog and renders the umbrella line and category rows', async () => {
    renderSection({ listManaged: vi.fn(async () => disabledLibrary()) })

    expect(screen.getByText(en.loading)).toBeTruthy()
    expect(await screen.findByText(en.catTesting)).toBeTruthy()
    expect(screen.getByText(en.catRoles)).toBeTruthy()
    expect(screen.getByText(en.umbrellaLine)).toBeTruthy()
    expect(screen.getByRole('checkbox', { name: en.catTesting })).toBeTruthy()
    expect(screen.getAllByRole('checkbox')).toHaveLength(CATEGORIES.length)
  })

  it('toggles one category: enables every member skill and refreshes', async () => {
    const listManaged = vi.fn(async () => disabledLibrary())
    const setEnabled = vi.fn(async () => undefined)
    renderSection({ listManaged, setEnabled })
    await screen.findByText(en.catTesting)

    const rolesCategory = CATEGORIES.find(c => c.id === 'roles')!
    fireEvent.click(screen.getByRole('checkbox', { name: en.catRoles }))

    await act(async () => { await Promise.resolve() })
    await screen.findByText(en.done)
    expect(setEnabled).toHaveBeenCalledTimes(rolesCategory.skills.length)
    expect(setEnabled).toHaveBeenCalledWith('session-1', 'cc-role-architect', true)
    expect(listManaged).toHaveBeenCalledTimes(2)
  })

  it('enables the recommended set only (umbrella excluded from the bulk call)', async () => {
    const setEnabled = vi.fn(async () => undefined)
    renderSection({ setEnabled, listManaged: vi.fn(async () => disabledLibrary()) })
    await screen.findByText(en.catTesting)

    fireEvent.click(screen.getByRole('button', { name: en.enableCore }))

    await act(async () => { await Promise.resolve() })
    await screen.findByText(en.done)
    const expected = RECOMMENDED.filter(name => name !== UMBRELLA_SKILL)
    expect(setEnabled).toHaveBeenCalledTimes(expected.length)
    expect(setEnabled).not.toHaveBeenCalledWith('session-1', UMBRELLA_SKILL, true)
    expect(setEnabled).toHaveBeenCalledWith('session-1', expected[0]!, true)
  })

  it('disables the whole library with the disable-all button', async () => {
    const setEnabled = vi.fn(async () => undefined)
    renderSection({ setEnabled, listManaged: vi.fn(async () => disabledLibrary()) })
    await screen.findByText(en.catTesting)

    fireEvent.click(screen.getByRole('button', { name: en.disableAll }))

    await act(async () => { await Promise.resolve() })
    await screen.findByText(en.done)
    expect(setEnabled).toHaveBeenCalledTimes(ALL_LIBRARY_SKILLS.length)
    expect(setEnabled).toHaveBeenCalledWith('session-1', ALL_LIBRARY_SKILLS[0]!, false)
    expect(setEnabled).not.toHaveBeenCalledWith('session-1', UMBRELLA_SKILL, false)
  })

  it('reports a partial failure when a toggle rejects', async () => {
    const setEnabled = vi.fn(async () => undefined)
      .mockRejectedValueOnce(new Error('boom'))
    renderSection({ setEnabled, listManaged: vi.fn(async () => disabledLibrary()) })
    await screen.findByText(en.catTesting)

    fireEvent.click(screen.getByRole('checkbox', { name: en.catRoles }))

    expect(await screen.findByText(en.fail)).toBeTruthy()
  })

  it('shows the error row and retries when the catalog load fails', async () => {
    const listManaged = vi.fn<CcActions['listManaged']>(async () => {
      throw new Error('offline')
    })
    renderSection({ listManaged })

    expect(await screen.findByText(en.error)).toBeTruthy()
    expect(screen.getByRole('button', { name: en.retry })).toBeTruthy()

    listManaged.mockResolvedValueOnce(disabledLibrary())
    fireEvent.click(screen.getByRole('button', { name: en.retry }))
    expect(await screen.findByText(en.catTesting)).toBeTruthy()
  })
})
