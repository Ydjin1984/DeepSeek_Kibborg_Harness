// @vitest-environment jsdom
/** The four dialogs: view, edit (validate/security/conflict pipeline), versions, benchmark. */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SkillBenchmarkDialog } from '../src/client/SkillBenchmarkDialog.tsx'
import type { SkillBenchmarkDialogProps } from '../src/client/SkillBenchmarkDialog.tsx'
import { SkillEditDialog } from '../src/client/SkillEditDialog.tsx'
import type { SkillEditDialogProps } from '../src/client/SkillEditDialog.tsx'
import { SkillVersionsDialog } from '../src/client/SkillVersionsDialog.tsx'
import type { SkillVersionsDialogProps } from '../src/client/SkillVersionsDialog.tsx'
import { SkillViewDialog } from '../src/client/SkillViewDialog.tsx'
import type { SkillViewDialogProps } from '../src/client/SkillViewDialog.tsx'
import { en } from '../src/client/locales.ts'
import { SkillApiError } from '../src/client/skills-api.ts'
import { benchmarkRun, benchmarkRunWithoutResult, detail, modelGroups, t, version } from './helpers.client.ts'

afterEach(cleanup)

describe('SkillViewDialog', () => {
  function renderView(over: Partial<SkillViewDialogProps> = {}) {
    const onClose = vi.fn()
    const props = { skill: detail(), t, onClose, ...over } satisfies SkillViewDialogProps
    render(<SkillViewDialog {...props} />)
    return onClose
  }

  it('shows the body in rendered mode by default and switches to raw', () => {
    renderView()

    expect(screen.getByText('# Demo skill', { exact: false })).toBeTruthy()
    const rendered = screen.getByText(en.viewRendered)
    expect(rendered.getAttribute('aria-pressed')).toBe('true')

    fireEvent.click(screen.getByText(en.viewRaw))
    expect(screen.getByText(en.viewRaw).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByText('# Demo skill', { exact: false }).closest('code')).toBeTruthy()

    fireEvent.click(screen.getByText(en.viewRendered))
    expect(screen.getByText(en.viewRendered).getAttribute('aria-pressed')).toBe('true')
  })

  it('says so when the skill has no content', () => {
    renderView({ skill: detail({ content: '   ' }) })
    expect(screen.getByText(en.viewContentEmpty)).toBeTruthy()
  })

  it('closes on the close action', () => {
    const onClose = renderView()
    fireEvent.click(screen.getByRole('button', { name: en.actionClose }))
    expect(onClose).toHaveBeenCalledOnce()
  })
})

describe('SkillEditDialog', () => {
  const BODY = detail().content

  function renderEdit(over: Partial<SkillEditDialogProps> = {}) {
    const defaults = {
      validate: vi.fn<SkillEditDialogProps['validate']>().mockResolvedValue({ ok: true }),
      securityCheck: vi.fn<SkillEditDialogProps['securityCheck']>()
        .mockResolvedValue({ status: 'valid', findings: [] }),
      save: vi.fn<SkillEditDialogProps['save']>().mockResolvedValue(undefined),
      onSaved: vi.fn(),
      onClose: vi.fn(),
    }
    const props = {
      skill: detail(),
      t,
      ...defaults,
      ...over,
    } satisfies SkillEditDialogProps
    render(<SkillEditDialog {...props} />)
    return {
      ...defaults,
      ...over,
      textarea: (): HTMLElement => screen.getByRole('textbox'),
    }
  }

  it('saves through the full pipeline: validate, security, then save', async () => {
    const { validate, securityCheck, save, onSaved, textarea } = renderEdit()
    fireEvent.change(textarea(), { target: { value: 'new body' } })
    fireEvent.click(screen.getByRole('button', { name: en.editSave }))

    await vi.waitFor(() => { expect(save).toHaveBeenCalledOnce() })
    expect(validate).toHaveBeenCalledWith('new body')
    expect(securityCheck).toHaveBeenCalledWith('new body')
    expect(save).toHaveBeenCalledWith('new body', { replace: false, force: false })
    expect(onSaved).toHaveBeenCalledOnce()
    expect(screen.getByText(en.editSaved)).toBeTruthy()
  })

  it('refuses to save invalid content and shows the validation reason', async () => {
    const { validate, save } = renderEdit({ validate: vi.fn().mockResolvedValue({ ok: false, reason: 'bad frontmatter' }) })
    fireEvent.click(screen.getByRole('button', { name: en.editSave }))

    await vi.waitFor(() => {
      expect(screen.getByText(en.editValidationFailed.replace('{reason}', 'bad frontmatter'))).toBeTruthy()
    })
    expect(save).not.toHaveBeenCalled()
    expect(validate).toHaveBeenCalled()
  })

  it('shows a bare validation failure when the reason is absent', async () => {
    renderEdit({ validate: vi.fn().mockResolvedValue({ ok: false }) })
    fireEvent.click(screen.getByRole('button', { name: en.editSave }))

    await vi.waitFor(() => {
      expect(screen.getByText(/not a valid skill/)).toBeTruthy()
    })
  })

  it('renders a non-Error save failure as text', async () => {
    renderEdit({ save: vi.fn().mockRejectedValue('plain failure') })
    fireEvent.click(screen.getByRole('button', { name: en.editSave }))

    await vi.waitFor(() => {
      expect(screen.getByText(en.editError.replace('{message}', 'plain failure'))).toBeTruthy()
    })
  })

  it('offers save-anyway past a blocked security verdict', async () => {
    const { save } = renderEdit({
      securityCheck: vi.fn().mockResolvedValue({
        status: 'blocked',
        findings: [{ severity: 'blocked', rule: 'r', message: 'm', evidence: 'e' }],
      }),
    })
    fireEvent.click(screen.getByRole('button', { name: en.editSave }))

    await vi.waitFor(() => { expect(screen.getByText(en.editSecurityBlocked)).toBeTruthy() })
    expect(save).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: en.editSaveAnyway }))

    await vi.waitFor(() => {
      expect(save).toHaveBeenCalledExactlyOnceWith(BODY, { replace: false, force: true })
    })
  })

  it('offers replace past a same-name conflict', async () => {
    renderEdit({
      save: vi.fn().mockRejectedValueOnce(new Error('conflict'))
        .mockResolvedValueOnce(undefined),
    })
    // A non-SkillApiError rejection surfaces the message instead of the panel.
    fireEvent.click(screen.getByRole('button', { name: en.editSave }))
    await vi.waitFor(() => { expect(screen.getByText(en.editError.replace('{message}', 'conflict'))).toBeTruthy() })

    const conflictSave = vi.fn<SkillEditDialogProps['save']>()
    conflictSave.mockRejectedValueOnce(new SkillApiError('skill-conflict', 'already exists'))
    cleanup()
    renderEdit({ save: conflictSave })
    fireEvent.click(screen.getByRole('button', { name: en.editSave }))

    await vi.waitFor(() => { expect(screen.getByText(en.editConflict)).toBeTruthy() })
    fireEvent.click(screen.getByRole('button', { name: en.editReplace }))
    await vi.waitFor(() => {
      expect(conflictSave).toHaveBeenLastCalledWith(BODY, { replace: true, force: false })
    })
  })

  it('reports a failed save and keeps the dialog open', async () => {
    const { onSaved } = renderEdit({ save: vi.fn().mockRejectedValue(new Error('denied')) })
    fireEvent.click(screen.getByRole('button', { name: en.editSave }))

    await vi.waitFor(() => { expect(screen.getByText(en.editError.replace('{message}', 'denied'))).toBeTruthy() })
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('dismisses the conflict panel without saving', async () => {
    const conflictSave = vi.fn<SkillEditDialogProps['save']>()
      .mockRejectedValueOnce(new SkillApiError('skill-conflict', 'already exists'))
    renderEdit({ save: conflictSave })
    fireEvent.click(screen.getByRole('button', { name: en.editSave }))
    await vi.waitFor(() => { expect(screen.getByText(en.editConflict)).toBeTruthy() })

    fireEvent.click(screen.getByRole('button', { name: en.actionCancel }))
    await vi.waitFor(() => { expect(screen.queryByText(en.editConflict)).toBeNull() })
    expect(conflictSave).toHaveBeenCalledOnce()
  })

  it('disables save while saving or when the content is blank', async () => {
    const { textarea } = renderEdit({ save: vi.fn().mockImplementation(() => new Promise(() => {})) })
    fireEvent.change(textarea(), { target: { value: '  ' } })
    expect(screen.getByRole('button', { name: en.editSave })).toHaveProperty('disabled', true)

    fireEvent.change(textarea(), { target: { value: 'body' } })
    fireEvent.click(screen.getByRole('button', { name: en.editSave }))
    expect(screen.getByRole('button', { name: en.editSaving })).toHaveProperty('disabled', true)
  })

  it('cancels without saving', () => {
    const { onClose } = renderEdit()
    fireEvent.click(screen.getByRole('button', { name: en.actionCancel }))
    expect(onClose).toHaveBeenCalledOnce()
  })
})

describe('SkillVersionsDialog', () => {
  function renderVersions(over: Partial<SkillVersionsDialogProps> = {}) {
    const defaults = {
      onRollback: vi.fn<SkillVersionsDialogProps['onRollback']>().mockResolvedValue(undefined),
      onClose: vi.fn(),
    }
    const props = {
      name: 'demo-skill',
      versions: [version({ id: 'v2', reason: 'Updated', source: 'manual' }), version()],
      activeVersion: 'v1',
      t,
      locale: 'en',
      rolling: false,
      ...defaults,
      ...over,
    } satisfies SkillVersionsDialogProps
    render(<SkillVersionsDialog {...props} />)
    return { ...defaults, ...over }
  }

  it('lists versions with the active one tagged and rollback for the rest', () => {
    renderVersions()

    expect(screen.getByText('v1')).toBeTruthy()
    expect(screen.getByText('v2')).toBeTruthy()
    expect(screen.getAllByText(en.versionsActive)).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: en.versionsRollback })).toHaveLength(1)
    expect(screen.getByText('Updated', { exact: false })).toBeTruthy()
  })

  it('rolls back to the chosen version', async () => {
    const { onRollback } = renderVersions()
    fireEvent.click(screen.getByRole('button', { name: en.versionsRollback }))
    await vi.waitFor(() => { expect(onRollback).toHaveBeenCalledExactlyOnceWith('v2') })
    await vi.waitFor(() => {
      expect(screen.getByText(en.versionsRolledBack.replace('{version}', 'v2'))).toBeTruthy()
    })
  })

  it('reports a rollback failure inline', async () => {
    const { onRollback } = renderVersions({ onRollback: vi.fn().mockRejectedValue(new Error('version gone')) })
    fireEvent.click(screen.getByRole('button', { name: en.versionsRollback }))
    await vi.waitFor(() => {
      expect(screen.getByText(en.versionsError.replace('{message}', 'version gone'))).toBeTruthy()
    })
    expect(onRollback).toHaveBeenCalledOnce()
  })

  it('renders a non-Error rollback failure as text', async () => {
    renderVersions({ onRollback: vi.fn().mockRejectedValue('gone') })
    fireEvent.click(screen.getByRole('button', { name: en.versionsRollback }))
    await vi.waitFor(() => {
      expect(screen.getByText(en.versionsError.replace('{message}', 'gone'))).toBeTruthy()
    })
  })

  it('disables rollback while one is in flight', () => {
    renderVersions({ rolling: true })
    expect(screen.getByRole('button', { name: en.versionsRolling })).toHaveProperty('disabled', true)
  })

  it('says so when there are no versions', () => {
    renderVersions({ versions: [] })
    expect(screen.getByText(en.versionsEmpty)).toBeTruthy()
  })

  it('closes on the close action', () => {
    const { onClose } = renderVersions()
    fireEvent.click(screen.getAllByRole('button', { name: en.actionClose })[0]!)
    expect(onClose).toHaveBeenCalledOnce()
  })
})

describe('SkillBenchmarkDialog', () => {
  function renderBenchmark(over: Partial<SkillBenchmarkDialogProps> = {}) {
    const onStart = vi.fn()
    const onCancel = vi.fn()
    const onClose = vi.fn()
    const props = {
      name: 'demo-skill',
      models: modelGroups(),
      run: null,
      t,
      locale: 'en',
      onStart,
      onCancel,
      onClose,
      ...over,
    } satisfies SkillBenchmarkDialogProps
    render(<SkillBenchmarkDialog {...props} />)
    return { onStart, onCancel, onClose }
  }

  it('collects the task model, evaluator model, and case count on start', async () => {
    const { onStart } = renderBenchmark()
    fireEvent.change(screen.getByLabelText(en.benchmarkTaskModel), { target: { value: 'anthropic' } })
    fireEvent.change(screen.getByLabelText('Task model model'), { target: { value: 'claude-sonnet' } })
    fireEvent.change(screen.getByLabelText(en.benchmarkCaseCount), { target: { value: '8' } })
    fireEvent.click(screen.getByRole('button', { name: en.benchmarkRun }))

    expect(onStart).toHaveBeenCalledExactlyOnceWith({
      taskModel: { provider: 'anthropic', model: 'claude-sonnet' },
      caseCount: 8,
    })
  })

  it('sends the evaluator model when "use the same model" is off', () => {
    const { onStart } = renderBenchmark()
    fireEvent.click(screen.getByLabelText(en.benchmarkUseSameModel))
    fireEvent.click(screen.getByRole('button', { name: en.benchmarkRun }))

    expect(onStart).toHaveBeenCalledExactlyOnceWith({
      taskModel: { provider: 'deepseek', model: 'deepseek-chat' },
      evaluatorModel: { provider: 'deepseek', model: 'deepseek-chat' },
      caseCount: 5,
    })
  })

  it('collects a separately chosen evaluator provider and model', () => {
    const { onStart } = renderBenchmark()
    fireEvent.click(screen.getByLabelText(en.benchmarkUseSameModel))
    fireEvent.change(screen.getByLabelText(en.benchmarkEvaluatorModel), { target: { value: 'anthropic' } })
    fireEvent.change(screen.getByLabelText('Evaluator model model'), { target: { value: 'claude-sonnet' } })
    fireEvent.click(screen.getByRole('button', { name: en.benchmarkRun }))

    expect(onStart).toHaveBeenCalledExactlyOnceWith({
      taskModel: { provider: 'deepseek', model: 'deepseek-chat' },
      evaluatorModel: { provider: 'anthropic', model: 'claude-sonnet' },
      caseCount: 5,
    })
  })

  it('seeds the run form from an initial selection', () => {
    const { onStart } = renderBenchmark({
      initial: {
        taskModel: { provider: 'anthropic', model: 'claude-sonnet' },
        evaluatorModel: { provider: 'deepseek', model: 'deepseek-reasoner' },
        caseCount: 8,
      },
    })
    fireEvent.click(screen.getByRole('button', { name: en.benchmarkRun }))

    expect(onStart).toHaveBeenCalledExactlyOnceWith({
      taskModel: { provider: 'anthropic', model: 'claude-sonnet' },
      evaluatorModel: { provider: 'deepseek', model: 'deepseek-reasoner' },
      caseCount: 8,
    })
  })

  it('reseeds the routes when the catalog arrives after mount', () => {
    const onStart = vi.fn()
    const onClose = vi.fn()
    const base = {
      name: 'demo-skill',
      run: null,
      t,
      locale: 'en',
      onStart,
      onCancel: vi.fn(),
      onClose,
    } satisfies Omit<SkillBenchmarkDialogProps, 'models'>
    const { rerender } = render(<SkillBenchmarkDialog {...base} models={[]} />)
    expect(screen.getByText(en.benchmarkNoModels)).toBeTruthy()
    rerender(<SkillBenchmarkDialog {...base} models={modelGroups()} />)

    fireEvent.click(screen.getByRole('button', { name: en.benchmarkRun }))
    expect(onStart).toHaveBeenCalledExactlyOnceWith({
      taskModel: { provider: 'deepseek', model: 'deepseek-chat' },
      caseCount: 5,
    })
  })

  it('keeps the same-model shortcut when the initial selection omits the evaluator', () => {
    const { onStart } = renderBenchmark({
      initial: { taskModel: { provider: 'deepseek', model: 'deepseek-chat' }, caseCount: 3 },
    })
    fireEvent.click(screen.getByRole('button', { name: en.benchmarkRun }))

    expect(onStart).toHaveBeenCalledExactlyOnceWith({
      taskModel: { provider: 'deepseek', model: 'deepseek-chat' },
      caseCount: 3,
    })
  })

  it('disables the evaluator select while using the same model', () => {
    renderBenchmark()
    expect(screen.getByLabelText(`${en.benchmarkEvaluatorModel} model`)).toHaveProperty('disabled', true)
    fireEvent.click(screen.getByLabelText(en.benchmarkUseSameModel))
    expect(screen.getByLabelText(`${en.benchmarkEvaluatorModel} model`)).toHaveProperty('disabled', false)
  })

  it('disables Run when no models are available', () => {
    renderBenchmark({ models: [] })
    expect(screen.getByText(en.benchmarkNoModels)).toBeTruthy()
    expect(screen.getByRole('button', { name: en.benchmarkRun })).toHaveProperty('disabled', true)
  })

  it('keeps the routes unseeded when every model group is empty', () => {
    renderBenchmark({ models: [{ id: 'empty', name: 'Empty', models: [] }] })
    expect(screen.getByRole('button', { name: en.benchmarkRun })).toHaveProperty('disabled', true)
  })

  it('falls back to an empty model when a group has no models', () => {
    const { onStart } = renderBenchmark({
      models: [
        { id: 'deepseek', name: 'DeepSeek', models: [] },
        { id: 'anthropic', name: 'Anthropic', models: [{ id: 'claude-sonnet', name: 'Claude Sonnet' }] },
      ],
    })
    fireEvent.click(screen.getByRole('button', { name: en.benchmarkRun }))
    expect(onStart).not.toHaveBeenCalled()
  })

  it('resets the model when switching to a group without models', () => {
    const { onStart } = renderBenchmark({
      models: [
        { id: 'deepseek', name: 'DeepSeek', models: [{ id: 'chat', name: 'Chat' }] },
        { id: 'empty', name: 'Empty', models: [] },
      ],
    })
    fireEvent.change(screen.getByLabelText(en.benchmarkTaskModel), { target: { value: 'empty' } })
    fireEvent.click(screen.getByRole('button', { name: en.benchmarkRun }))
    expect(onStart).not.toHaveBeenCalled()
  })

  it('reports a failed run with its error message', () => {
    renderBenchmark({ run: benchmarkRunWithoutResult({ status: 'failed', error: 'model timeout' }) })
    expect(screen.getByText(en.benchmarkFailed.replace('{error}', 'model timeout'))).toBeTruthy()
  })

  it('shows the cancelled notice for a cancelled run', () => {
    renderBenchmark({ run: benchmarkRunWithoutResult({ status: 'cancelled' }) })
    expect(screen.getByText(en.benchmarkCancelled)).toBeTruthy()
  })

  it('shows the running view with progress and forwards cancel', async () => {
    const { onCancel } = renderBenchmark({
      run: benchmarkRun({ status: 'running', phase: 'running-baseline', progress: { case: 2, total: 5 } }),
    })

    expect(screen.getByText(en.benchmarkRunning)).toBeTruthy()
    expect(screen.getByText(en.phaseRunningBaseline)).toBeTruthy()
    expect(screen.getByText(en.benchmarkProgress.replace('{case}', '2').replace('{total}', '5'))).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.benchmarkCancel }))
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('renders the completed results with summary and per-case rows', () => {
    renderBenchmark({ run: benchmarkRun() })

    expect(screen.getByText(en.benchmarkResults)).toBeTruthy()
    expect(screen.getByText('+25%', { exact: false })).toBeTruthy()
    expect(screen.getByText(en.benchmarkVerdictImprovement, { exact: false })).toBeTruthy()
    expect(screen.getByText(en.benchmarkPerCase)).toBeTruthy()
    expect(screen.getByText('First case')).toBeTruthy()
    expect(screen.getByText('+40%', { exact: false })).toBeTruthy()
  })

  it('renders a bare completion when a completed run carries no result', () => {
    renderBenchmark({ run: benchmarkRunWithoutResult() })
    expect(screen.getByText(en.phaseDone)).toBeTruthy()
  })

  it('reports a failed run with its error', () => {
    renderBenchmark({ run: benchmarkRun({ status: 'failed', error: 'no provider' }) })
    expect(screen.getByText(en.benchmarkFailed.replace('{error}', 'no provider'))).toBeTruthy()
  })

  it('reports a cancelled run', () => {
    renderBenchmark({ run: benchmarkRunWithoutResult({ status: 'cancelled' }) })
    expect(screen.getByText(en.benchmarkCancelled)).toBeTruthy()
  })

  it('closes from the idle and the running view', () => {
    const idle = renderBenchmark()
    fireEvent.click(screen.getByRole('button', { name: en.actionCancel }))
    expect(idle.onClose).toHaveBeenCalledOnce()

    cleanup()
    const running = renderBenchmark({ run: benchmarkRun({ status: 'running', progress: { case: 1, total: 3 } }) })
    fireEvent.click(screen.getAllByRole('button', { name: en.actionClose })[0]!)
    expect(running.onClose).toHaveBeenCalledOnce()
  })
})
