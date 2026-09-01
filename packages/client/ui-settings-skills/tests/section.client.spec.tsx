// @vitest-environment jsdom
/** The section: session gating, load lifecycle, search, groups, actions, trash, and dialogs. */

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SkillsSettingsSection } from '../src/client/SkillsSettingsSection.tsx'
import type { SkillsSettingsSectionProps } from '../src/client/SkillsSettingsSection.tsx'
import { en } from '../src/client/locales.ts'
import { SkillApiError } from '../src/client/skills-api.ts'
import type { SkillsActions } from '../src/client/skills-api.ts'
import { benchmarkRun, benchmarkRunWithoutResult, detail, fakeActions, summary, t, trashEntry, version } from './helpers.client.ts'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

/** Flush pending microtasks/timers under fake timers without testing-library waits. */
async function settle(): Promise<void> {
  await act(async () => { await vi.advanceTimersByTimeAsync(1) })
}

/** Render the section over a fake action table; returns the actions for assertions. */
function renderSection(over: Partial<SkillsActions> = {}, current: string | null = 'session-1') {
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
  } as unknown as SkillsSettingsSectionProps
  render(<SkillsSettingsSection {...props} />)
  return actions
}

/** The default fake catalog carries one user skill; expand its card. */
async function openFirstCard(actions: SkillsActions) {
  await screen.findByText('demo-skill')
  fireEvent.click(screen.getByText('demo-skill'))
  await waitFor(() => { expect(screen.getByText(en.actionView)).toBeTruthy() })
  return actions
}

describe('SkillsSettingsSection', () => {
  it('asks for a session before managing skills', async () => {
    renderSection({}, null)

    expect(screen.getByText(en.noSession)).toBeTruthy()
    expect(screen.queryByText(en.mySkills)).toBeNull()
  })

  it('shows a loading line until the catalog arrives', async () => {
    const deferred = Promise.withResolvers<readonly unknown[]>()
    const listManaged = vi.fn(() => deferred.promise) as unknown as SkillsActions['listManaged']
    renderSection({ listManaged })

    expect(screen.getByText(en.loading)).toBeTruthy()
    await act(async () => { deferred.resolve([summary()]) })
    await screen.findByText('demo-skill')
  })

  it('groups filesystem and built-in skills and shows the empty line only when truly empty', async () => {
    const actions = fakeActions({
      listManaged: vi.fn(async () => [
        summary({ name: 'mine', scope: 'user' }),
        summary({ name: 'built', scope: 'built-in' }),
      ]),
    })
    renderSection(actions)

    await screen.findByText('mine')
    expect(screen.getByText(en.mySkills)).toBeTruthy()
    expect(screen.getByText(en.builtIn)).toBeTruthy()
    expect(screen.queryByText(en.emptySkills)).toBeNull()

    cleanup()
    renderSection({ listManaged: vi.fn(async () => []) })
    expect(await screen.findByText(en.emptySkills)).toBeTruthy()
    expect(screen.queryByText(en.mySkills)).toBeNull()
  })

  it('filters in real time over name, description, when-to-use, and read content', async () => {
    const actions = fakeActions({
      listManaged: vi.fn(async () => [
        summary({ name: 'alpha', description: 'first thing', whenToUse: 'when bored' }),
        summary({ name: 'beta', description: 'second thing' }),
      ]),
    })
    renderSection(actions)
    await screen.findByText('alpha')
    const search = screen.getByRole('searchbox', { name: en.search })

    fireEvent.change(search, { target: { value: 'alpha' } })
    expect(screen.queryByText('beta')).toBeNull()
    expect(screen.getByText('alpha')).toBeTruthy()

    fireEvent.change(search, { target: { value: 'when bored' } })
    expect(screen.getByText('alpha')).toBeTruthy()
    expect(screen.queryByText('beta')).toBeNull()

    // Body content joins the search once the details are loaded (via View).
    fireEvent.change(search, { target: { value: '' } })
    fireEvent.click(screen.getByText('alpha'))
    fireEvent.click(screen.getByRole('button', { name: en.actionView }))
    await waitFor(() => { expect(actions.read).toHaveBeenCalled() })
    fireEvent.click(screen.getByRole('button', { name: en.actionClose }))
    fireEvent.change(search, { target: { value: 'demo things' } })
    expect(screen.getByText('alpha')).toBeTruthy()
    expect(screen.queryByText('beta')).toBeNull()

    fireEvent.change(search, { target: { value: 'nothing matches' } })
    expect(screen.queryByText('alpha')).toBeNull()
    expect(screen.getByText(en.emptySearch)).toBeTruthy()
  })

  it('toggles enablement and re-reads the catalog', async () => {
    const actions = renderSection()
    await screen.findByText('demo-skill')
    fireEvent.click(screen.getByRole('button', { name: en.actionDisable }))

    await waitFor(() => {
      expect(actions.setEnabled).toHaveBeenCalledExactlyOnceWith('session-1', 'demo-skill', false)
    })
    await waitFor(() => { expect(actions.listManaged).toHaveBeenCalledTimes(2) })
  })

  it('deletes a skill into the trash and re-reads', async () => {
    const actions = renderSection()
    await openFirstCard(actions)
    fireEvent.click(screen.getByRole('button', { name: en.actionDelete }))

    await waitFor(() => { expect(actions.remove).toHaveBeenCalledExactlyOnceWith('session-1', 'demo-skill') })
    await waitFor(() => { expect(actions.listManaged).toHaveBeenCalledTimes(2) })
  })

  it('opens the viewer after reading the skill', async () => {
    const actions = renderSection()
    const { read } = actions
    await openFirstCard(actions)
    fireEvent.click(screen.getByRole('button', { name: en.actionView }))

    await waitFor(() => { expect(read).toHaveBeenCalledExactlyOnceWith('session-1', 'demo-skill') })
    expect(await screen.findByText(en.viewTitle, { exact: false })).toBeTruthy()
    expect(screen.getByText('# Demo skill', { exact: false })).toBeTruthy()
  })

  it('reuses a cached detail for repeat views', async () => {
    const actions = renderSection()
    const { read } = actions
    await openFirstCard(actions)
    fireEvent.click(screen.getByRole('button', { name: en.actionView }))
    await screen.findByText(en.viewTitle, { exact: false })
    fireEvent.click(screen.getByRole('button', { name: en.actionClose }))
    await waitFor(() => { expect(screen.queryByText(en.viewTitle, { exact: false })).toBeNull() })

    // The card stays expanded after the dialog closes, so View is still visible.
    fireEvent.click(screen.getByRole('button', { name: en.actionView }))
    await screen.findByText(en.viewTitle, { exact: false })
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('does not open the viewer when the skill cannot be read', async () => {
    const actions = renderSection({ read: vi.fn(async () => undefined) })
    await openFirstCard(actions)
    fireEvent.click(screen.getByRole('button', { name: en.actionView }))
    await waitFor(() => { expect(actions.read).toHaveBeenCalled() })
    expect(screen.queryByText(en.viewTitle, { exact: false })).toBeNull()
  })

  it('surfaces a non-Error action failure as text', async () => {
    renderSection({ setEnabled: vi.fn().mockRejectedValue('wire error') })
    await screen.findByText('demo-skill')
    fireEvent.click(screen.getByRole('button', { name: en.actionDisable }))
    expect(await screen.findByText('wire error')).toBeTruthy()
  })

  it('reports model catalog failures when the section loads', async () => {
    renderSection({ listModels: vi.fn().mockRejectedValue(new Error('no models')) })
    expect(await screen.findByText('no models')).toBeTruthy()
    // The benchmark dialog still opens and falls back to the empty catalog.
    fireEvent.click(screen.getByText('demo-skill'))
    fireEvent.click(screen.getByRole('button', { name: en.actionBenchmark }))
    expect(await screen.findByText(en.benchmarkNoModels)).toBeTruthy()
  })

  it('reports a non-Error model catalog failure as text', async () => {
    renderSection({ listModels: vi.fn().mockRejectedValue('catalog gone') })
    expect(await screen.findByText('catalog gone')).toBeTruthy()
  })

  it('loads the model catalog once at mount and reuses it across dialog reopens', async () => {
    const actions = renderSection()
    const { listModels } = actions
    await screen.findByText('demo-skill')
    await waitFor(() => { expect(listModels).toHaveBeenCalledOnce() })
    fireEvent.click(screen.getByText('demo-skill'))
    fireEvent.click(screen.getByRole('button', { name: en.actionBenchmark }))
    await waitFor(() => { expect(screen.getByRole('dialog')).toBeTruthy() })
    fireEvent.click(screen.getByRole('button', { name: en.actionClose }))
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })

    fireEvent.click(screen.getByRole('button', { name: en.actionBenchmark }))
    await waitFor(() => { expect(listModels).toHaveBeenCalledTimes(1) })
  })

  it('keeps the edit and versions dialogs closed when the skill cannot be read', async () => {
    renderSection({ read: vi.fn(async () => undefined) })
    await screen.findByText('demo-skill')
    fireEvent.click(screen.getByText('demo-skill'))

    fireEvent.click(screen.getByRole('button', { name: en.actionEdit }))
    await waitFor(() => { expect(screen.queryByRole('textbox')).toBeNull() })
    fireEvent.click(screen.getByRole('button', { name: en.actionVersions }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('collapses an expanded card when its name is clicked again', async () => {
    renderSection()
    await screen.findByText('demo-skill')
    fireEvent.click(screen.getByText('demo-skill'))
    await waitFor(() => { expect(screen.getByRole('button', { name: en.actionView })).toBeTruthy() })

    fireEvent.click(screen.getByText('demo-skill'))
    await waitFor(() => { expect(screen.queryByRole('button', { name: en.actionView })).toBeNull() })
  })

  it('expands a built-in card and exercises its read-only actions', async () => {
    const actions = renderSection({
      listManaged: vi.fn(async () => [
        summary({ name: 'built', scope: 'built-in' }),
      ]),
    })
    await screen.findByText('built')
    fireEvent.click(screen.getByText('built'))
    await waitFor(() => { expect(screen.getByRole('button', { name: en.actionView })).toBeTruthy() })

    fireEvent.click(screen.getByRole('button', { name: en.actionView }))
    await waitFor(() => { expect(actions.read).toHaveBeenCalledWith('session-1', 'built') })
    fireEvent.click(screen.getAllByRole('button', { name: en.actionClose })[0]!)

    fireEvent.click(screen.getByRole('button', { name: en.actionVersions }))
    await screen.findByRole('dialog', { name: en.versionsTitle })
    fireEvent.click(screen.getAllByRole('button', { name: en.actionClose })[0]!)

    fireEvent.click(screen.getByRole('button', { name: en.actionBenchmark }))
    await waitFor(() => { expect(actions.listModels).toHaveBeenCalled() })
    fireEvent.click(screen.getAllByRole('button', { name: en.actionClose })[0]!)

    fireEvent.click(screen.getByRole('button', { name: en.actionDisable }))
    await waitFor(() => { expect(actions.setEnabled).toHaveBeenCalledWith('session-1', 'built', false) })
    expect(screen.queryByRole('button', { name: en.actionEdit })).toBeNull()
    expect(screen.queryByRole('button', { name: en.actionDelete })).toBeNull()

    // Toggling the header again collapses the built-in card.
    fireEvent.click(screen.getByText('built'))
    await waitFor(() => { expect(screen.queryByRole('button', { name: en.actionView })).toBeNull() })
  })

  it('closes the edit dialog without saving', async () => {
    const actions = renderSection()
    await openFirstCard(actions)
    fireEvent.click(screen.getByRole('button', { name: en.actionEdit }))
    await screen.findByRole('textbox')

    fireEvent.click(screen.getAllByRole('button', { name: en.actionClose })[0]!)
    await waitFor(() => { expect(screen.queryByRole('textbox')).toBeNull() })
    expect(actions.save).not.toHaveBeenCalled()
  })

  it('saves an edit through the section-bound pipeline and refreshes', async () => {
    const actions = renderSection()
    const { save, listManaged } = actions
    await openFirstCard(actions)
    fireEvent.click(screen.getByRole('button', { name: en.actionEdit }))
    await screen.findByRole('textbox')

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'edited body' } })
    fireEvent.click(screen.getByRole('button', { name: en.editSave }))

    await waitFor(() => {
      expect(save).toHaveBeenCalledExactlyOnceWith({
        sessionId: 'session-1',
        name: 'demo-skill',
        content: 'edited body',
        scope: 'user',
        replace: false,
        force: false,
      })
    })
    await waitFor(() => { expect(listManaged).toHaveBeenCalledTimes(2) })
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('opens the versions dialog with the active version', async () => {
    const actions = renderSection()
    const { versions } = actions
    await openFirstCard(actions)
    fireEvent.click(screen.getByRole('button', { name: en.actionVersions }))

    await waitFor(() => { expect(versions).toHaveBeenCalledExactlyOnceWith('session-1', 'demo-skill') })
    expect(await screen.findByRole('dialog', { name: en.versionsTitle })).toBeTruthy()
    expect(screen.getByText(en.versionsActive)).toBeTruthy()
  })

  it('rolls a skill back and refreshes the versions dialog', async () => {
    const actions = renderSection({
      read: vi.fn(async () => detail({ version: 'v2' })),
      versions: vi.fn(async () => [version({ id: 'v2', reason: 'Updated' }), version()]),
      rollback: vi.fn(async () => 'v2'),
    })
    const { rollback, versions } = actions
    await openFirstCard(actions)
    fireEvent.click(screen.getByRole('button', { name: en.actionVersions }))
    fireEvent.click(await screen.findByRole('button', { name: en.versionsRollback }))

    // v2 is active (the read says so), so the one rollback targets v1.
    await waitFor(() => { expect(rollback).toHaveBeenCalledExactlyOnceWith('session-1', 'demo-skill', 'v1') })
    await waitFor(() => { expect(versions).toHaveBeenCalledTimes(2) })
    expect(screen.getAllByText(en.versionsActive)).toHaveLength(1)
  })

  it('opens the benchmark dialog, loads the model catalog, and starts a run', async () => {
    const actions = renderSection()
    const { listModels, benchmarkStart } = actions
    await openFirstCard(actions)
    fireEvent.click(screen.getByRole('button', { name: en.actionBenchmark }))

    await waitFor(() => { expect(listModels).toHaveBeenCalledOnce() })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: en.benchmarkRun })).not.toHaveProperty('disabled', true)
    })

    fireEvent.click(screen.getByLabelText(en.benchmarkUseSameModel))
    fireEvent.click(screen.getByRole('button', { name: en.benchmarkRun }))

    await waitFor(() => {
      expect(benchmarkStart).toHaveBeenCalledExactlyOnceWith({
        sessionId: 'session-1',
        name: 'demo-skill',
        taskModel: { provider: 'deepseek', model: 'deepseek-chat' },
        evaluatorModel: { provider: 'deepseek', model: 'deepseek-chat' },
        caseCount: 5,
      })
    })
    expect(await screen.findByText(en.benchmarkResults)).toBeTruthy()
  })

  it('polls a running benchmark and can cancel it', async () => {
    vi.useFakeTimers()
    const running = benchmarkRun({ status: 'running', phase: 'generating-cases', progress: { case: 1, total: 5 } })
    const actions = renderSection({
      benchmarkStart: vi.fn(async () => running),
      benchmarkPoll: vi.fn(async () => running),
    })
    const benchmarkPoll = actions.benchmarkPoll
    const benchmarkCancel = actions.benchmarkCancel
    await settle()
    fireEvent.click(screen.getByText('demo-skill'))
    fireEvent.click(screen.getByRole('button', { name: en.actionBenchmark }))
    await settle()
    fireEvent.click(screen.getByRole('button', { name: en.benchmarkRun }))
    await settle()

    expect(screen.getByText(en.benchmarkRunning)).toBeTruthy()
    await act(async () => { vi.advanceTimersByTime(2000) })
    await settle()
    expect(benchmarkPoll).toHaveBeenCalledExactlyOnceWith('run-1')

    fireEvent.click(screen.getByRole('button', { name: en.benchmarkCancel }))
    await settle()
    expect(benchmarkCancel).toHaveBeenCalledExactlyOnceWith('run-1')
  })

  it('restores and permanently deletes trash entries with a refresh', async () => {
    const actions = fakeActions({
      trash: vi.fn(async () => [trashEntry()]),
      restore: vi.fn(async () => undefined),
      permanentDelete: vi.fn(async () => undefined),
    })
    const { restore, permanentDelete, listManaged } = actions
    renderSection(actions)
    await screen.findByText('gone-skill')

    fireEvent.click(screen.getByRole('button', { name: en.actionRestore }))
    await waitFor(() => { expect(restore).toHaveBeenCalledExactlyOnceWith('session-1', 'gone-skill') })
    await waitFor(() => { expect(listManaged).toHaveBeenCalledTimes(2) })

    fireEvent.click(screen.getByRole('button', { name: en.actionDeletePermanently }))
    await waitFor(() => {
      expect(permanentDelete).toHaveBeenCalledExactlyOnceWith('session-1', 'gone-skill')
    })
  })

  it('copies the create-skill command and hints at the chat wizard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    renderSection()
    fireEvent.click(await screen.findByRole('button', { name: en.createSkill }))

    await waitFor(() => { expect(writeText).toHaveBeenCalledExactlyOnceWith('/skill-create') })
    expect(screen.getByText(en.createSkillHint)).toBeTruthy()
  })

  it('says so when the clipboard is unavailable', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
      configurable: true,
    })
    renderSection()
    fireEvent.click(await screen.findByRole('button', { name: en.createSkill }))

    expect(await screen.findByText(en.createSkillCopyFailed)).toBeTruthy()
  })

  it('shows a failure with retry when the catalog read fails', async () => {
    const listManaged = vi.fn()
      .mockRejectedValueOnce(new Error('wire down'))
      .mockResolvedValueOnce([summary()])
    renderSection({ listManaged })

    expect(await screen.findByText(en.error)).toBeTruthy()
    expect(screen.queryByText('wire down')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: en.retry }))
    expect(await screen.findByText('demo-skill')).toBeTruthy()
  })

  it('surfaces an action failure without losing the catalog', async () => {
    renderSection({
      setEnabled: vi.fn().mockRejectedValue(new Error('host refused')),
    })
    await screen.findByText('demo-skill')
    fireEvent.click(screen.getByRole('button', { name: en.actionDisable }))

    expect(await screen.findByText('host refused')).toBeTruthy()
    expect(screen.getByText('demo-skill')).toBeTruthy()
  })

  it('keeps the last run view when a poll fails and the user can close', async () => {
    vi.useFakeTimers()
    const actions = renderSection({
      benchmarkStart: vi.fn(async () => benchmarkRun({ status: 'running', progress: { case: 1, total: 5 } })),
      benchmarkPoll: vi.fn().mockRejectedValue(new Error('gone')),
    })
    const { benchmarkPoll } = actions
    await settle()
    fireEvent.click(screen.getByText('demo-skill'))
    fireEvent.click(screen.getByRole('button', { name: en.actionBenchmark }))
    await settle()
    fireEvent.click(screen.getByRole('button', { name: en.benchmarkRun }))
    await settle()
    expect(screen.getByText(en.benchmarkRunning)).toBeTruthy()

    await act(async () => { vi.advanceTimersByTime(2000) })
    await settle()
    expect(benchmarkPoll).toHaveBeenCalledOnce()
    expect(screen.getByText(en.benchmarkRunning)).toBeTruthy()
  })

  it('maps manager conflict failures to the in-dialog replace flow', async () => {
    const actions = renderSection({
      save: vi.fn().mockRejectedValue(new SkillApiError('skill-conflict', 'exists')),
    })
    await openFirstCard(actions)
    fireEvent.click(screen.getByRole('button', { name: en.actionEdit }))
    await screen.findByRole('textbox')
    fireEvent.click(screen.getByRole('button', { name: en.editSave }))

    expect(await screen.findByText(en.editConflict)).toBeTruthy()
  })

  it('disables run-all when only built-in skills exist', async () => {
    renderSection({ listManaged: vi.fn(async () => [summary({ name: 'built', scope: 'built-in' })]) })
    await screen.findByText('built')
    expect(screen.getByRole('button', { name: en.benchmarkAll })).toHaveProperty('disabled', true)
  })

  it('runs all managed benchmarks with the toolbar models and refreshes on settle', async () => {
    vi.useFakeTimers()
    const listManaged = vi.fn<SkillsActions['listManaged']>(async () => [
      summary({ name: 'alpha', status: 'not-tested' }),
      summary({ name: 'beta', status: 'not-tested' }),
      summary({ name: 'built', scope: 'built-in' }),
    ])
    const benchmarkPoll = vi.fn<SkillsActions['benchmarkPoll']>()
    const actions = renderSection({
      listManaged,
      benchmarkBatchStart: vi.fn(async () => [
        benchmarkRun({ id: 'b1', skillName: 'alpha', status: 'running' }),
        benchmarkRun({ id: 'b2', skillName: 'beta', status: 'running' }),
      ]),
      benchmarkPoll,
    })
    const { benchmarkBatchStart } = actions
    await settle()
    fireEvent.click(screen.getByRole('button', { name: en.benchmarkAll }))
    await settle()

    expect(benchmarkBatchStart).toHaveBeenCalledExactlyOnceWith({
      sessionId: 'session-1',
      names: ['alpha', 'beta'],
      taskModel: { provider: 'deepseek', model: 'deepseek-chat' },
      caseCount: 5,
    })
    expect(screen.getByText(t('benchmarkAllProgress', { skill: 'alpha', done: 0, total: 2 }))).toBeTruthy()

    // Round 1: alpha settles while beta still runs (no refresh yet); round 2
    // polls only the running beta and settles the batch (refresh once).
    let pollRound = 0
    benchmarkPoll.mockImplementation(async (runId: string) => {
      if (runId === 'b1') return benchmarkRun({ id: 'b1', skillName: 'alpha', status: 'completed' })
      pollRound += 1
      return benchmarkRun({ id: 'b2', skillName: 'beta', status: pollRound >= 2 ? 'completed' : 'running' })
    })
    const callsBefore = listManaged.mock.calls.length
    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    await settle()
    // Beta still running → the catalog is not re-read mid-batch.
    expect(listManaged.mock.calls.length).toBe(callsBefore)

    await act(async () => { await vi.advanceTimersByTimeAsync(4000) })
    await settle()
    // Both runs settled → the catalog is re-read so the badges refresh.
    expect(listManaged.mock.calls.length).toBeGreaterThan(callsBefore)
    expect(screen.getByText(t('benchmarkAllDone', { improved: 2, worse: 0, same: 0, failed: 0 }))).toBeTruthy()
  })

  it('sends the toolbar-selected evaluator and case count to the batch', async () => {
    const actions = renderSection()
    const { benchmarkBatchStart } = actions
    await screen.findByText('demo-skill')
    fireEvent.click(screen.getByLabelText(en.benchmarkAllUseSameModel))
    fireEvent.change(screen.getByLabelText(en.benchmarkAllCaseCount), { target: { value: '8' } })
    fireEvent.click(screen.getByRole('button', { name: en.benchmarkAll }))

    await waitFor(() => {
      expect(benchmarkBatchStart).toHaveBeenCalledExactlyOnceWith({
        sessionId: 'session-1',
        names: ['demo-skill'],
        taskModel: { provider: 'deepseek', model: 'deepseek-chat' },
        evaluatorModel: { provider: 'deepseek', model: 'deepseek-chat' },
        caseCount: 8,
      })
    })
  })

  it('cancels every running run of a benchmark batch', async () => {
    vi.useFakeTimers()
    const actions = renderSection({
      listManaged: vi.fn(async () => [summary({ name: 'alpha' }), summary({ name: 'beta' })]),
      benchmarkBatchStart: vi.fn(async () => [
        benchmarkRun({ id: 'b1', skillName: 'alpha', status: 'running' }),
        benchmarkRun({ id: 'b2', skillName: 'beta', status: 'running' }),
      ]),
      benchmarkCancel: vi.fn(async (runId: string) => benchmarkRunWithoutResult({ id: runId, status: 'cancelled' })),
    })
    const { benchmarkCancel } = actions
    await settle()
    fireEvent.click(screen.getByRole('button', { name: en.benchmarkAll }))
    await settle()
    fireEvent.click(screen.getByRole('button', { name: en.benchmarkCancel }))
    await settle()

    expect(benchmarkCancel).toHaveBeenCalledWith('b1')
    expect(benchmarkCancel).toHaveBeenCalledWith('b2')
    expect(screen.getByText(en.benchmarkAllCancelled)).toBeTruthy()
  })

  it('refreshes the catalog when a benchmark run settles', async () => {
    vi.useFakeTimers()
    let settled = false
    const listManaged = vi.fn<SkillsActions['listManaged']>(async () => [summary()])
    renderSection({
      listManaged,
      benchmarkStart: vi.fn(async () => benchmarkRun({ status: 'running', progress: { case: 1, total: 5 } })),
      benchmarkPoll: vi.fn(async () => {
        if (settled) return benchmarkRun()
        settled = true
        return benchmarkRun({ status: 'running', progress: { case: 5, total: 5 } })
      }),
    })
    await settle()
    fireEvent.click(screen.getByText('demo-skill'))
    fireEvent.click(screen.getByRole('button', { name: en.actionBenchmark }))
    await settle()
    fireEvent.click(screen.getByRole('button', { name: en.benchmarkRun }))
    await settle()
    const callsBefore = listManaged.mock.calls.length

    await act(async () => { await vi.advanceTimersByTimeAsync(4000) })
    await settle()
    expect(listManaged.mock.calls.length).toBeGreaterThan(callsBefore)
    expect(screen.getByText(en.benchmarkResults)).toBeTruthy()
  })

  it('keeps the batch view when a poll fails and refreshes only once all runs settle', async () => {
    vi.useFakeTimers()
    let pollCalls = 0
    const listManaged = vi.fn<SkillsActions['listManaged']>(async () => [summary({ name: 'alpha' })])
    const benchmarkPoll = vi.fn<SkillsActions['benchmarkPoll']>(async (runId: string) => {
      pollCalls += 1
      if (pollCalls === 1) throw new Error('transient poll failure')
      if (pollCalls === 2) return benchmarkRun({ id: runId, skillName: 'alpha', status: 'running' })
      return benchmarkRun({ id: runId, skillName: 'alpha', status: 'completed' })
    })
    renderSection({
      listManaged,
      benchmarkBatchStart: vi.fn(async () => [
        benchmarkRun({ id: 'b1', skillName: 'alpha', status: 'running' }),
      ]),
      benchmarkPoll,
    })
    await settle()
    fireEvent.click(screen.getByRole('button', { name: en.benchmarkAll }))
    await settle()
    const callsBefore = listManaged.mock.calls.length

    // Poll #1 rejects → the last view is kept; poll #2 reports running → no refresh.
    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    await settle()
    expect(screen.getByText(t('benchmarkAllProgress', { skill: 'alpha', done: 0, total: 1 }))).toBeTruthy()
    expect(listManaged.mock.calls.length).toBe(callsBefore)

    // Poll #3 completes the run → the catalog is re-read.
    await act(async () => { await vi.advanceTimersByTimeAsync(4000) })
    await settle()
    expect(listManaged.mock.calls.length).toBeGreaterThan(callsBefore)
    expect(screen.getByText(t('benchmarkAllDone', { improved: 1, worse: 0, same: 0, failed: 0 }))).toBeTruthy()
  })

  it('summarizes mixed batch outcomes by verdict and failure', async () => {
    vi.useFakeTimers()
    const listManaged = vi.fn<SkillsActions['listManaged']>(async () => [
      summary({ name: 'alpha' }),
      summary({ name: 'beta' }),
      summary({ name: 'gamma' }),
    ])
    const benchmarkPoll = vi.fn<SkillsActions['benchmarkPoll']>(async (runId: string) => {
      if (runId === 'b1') {
        return benchmarkRun({ id: 'b1', skillName: 'alpha', status: 'completed', result: {
          ...benchmarkRun().result!,
          summary: { ...benchmarkRun().result!.summary, verdict: 'worse' },
        } })
      }
      if (runId === 'b2') {
        return benchmarkRunWithoutResult({ id: 'b2', skillName: 'beta', status: 'failed', error: 'boom' })
      }
      return benchmarkRun({ id: 'b3', skillName: 'gamma', status: 'completed', result: {
        ...benchmarkRun().result!,
        summary: { ...benchmarkRun().result!.summary, verdict: 'no-significant-improvement' },
      } })
    })
    renderSection({
      listManaged,
      benchmarkBatchStart: vi.fn(async () => [
        benchmarkRun({ id: 'b1', skillName: 'alpha', status: 'running' }),
        benchmarkRun({ id: 'b2', skillName: 'beta', status: 'running' }),
        benchmarkRun({ id: 'b3', skillName: 'gamma', status: 'running' }),
      ]),
      benchmarkPoll,
    })
    await settle()
    fireEvent.click(screen.getByRole('button', { name: en.benchmarkAll }))
    await settle()

    await act(async () => { await vi.advanceTimersByTimeAsync(4000) })
    await settle()
    expect(screen.getByText(t('benchmarkAllDone', { improved: 0, worse: 1, same: 1, failed: 1 }))).toBeTruthy()
  })

  it('keeps run-all disabled and the toolbar unseeded when the first model group is empty', async () => {
    renderSection({
      listManaged: vi.fn(async () => [summary({ name: 'alpha' })]),
      listModels: vi.fn(async () => [
        { id: 'empty', name: 'Empty', models: [] },
        { id: 'deepseek', name: 'DeepSeek', models: [{ id: 'deepseek-chat', name: 'DeepSeek Chat' }] },
      ]),
    })
    await screen.findByText('alpha')
    await waitFor(() => {
      expect(screen.getByRole('button', { name: en.benchmarkAll })).toHaveProperty('disabled', true)
    })
  })

  it('seeds the per-skill dialog from the toolbar selection', async () => {
    const actions = renderSection()
    const { benchmarkStart } = actions
    await screen.findByText('demo-skill')
    fireEvent.click(screen.getByLabelText(en.benchmarkAllUseSameModel))
    fireEvent.change(screen.getByLabelText(en.benchmarkAllCaseCount), { target: { value: '10' } })
    fireEvent.click(screen.getByText('demo-skill'))
    fireEvent.click(screen.getByRole('button', { name: en.actionBenchmark }))
    fireEvent.click(screen.getByRole('button', { name: en.benchmarkRun }))

    await waitFor(() => {
      expect(benchmarkStart).toHaveBeenCalledExactlyOnceWith({
        sessionId: 'session-1',
        name: 'demo-skill',
        taskModel: { provider: 'deepseek', model: 'deepseek-chat' },
        evaluatorModel: { provider: 'deepseek', model: 'deepseek-chat' },
        caseCount: 10,
      })
    })
  })
})
