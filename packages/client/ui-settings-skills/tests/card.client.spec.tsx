// @vitest-environment jsdom
/** What one managed-skill card shows and which actions it forwards. */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SkillCard } from '../src/client/SkillCard.tsx'
import type { SkillCardProps } from '../src/client/SkillCard.tsx'
import { en } from '../src/client/locales.ts'
import { summary, t } from './helpers.client.ts'

afterEach(cleanup)

function renderCard(over: Partial<SkillCardProps> = {}) {
  const actions = {
    onToggle: vi.fn(),
    onView: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    onToggleEnabled: vi.fn(),
    onVersions: vi.fn(),
    onBenchmark: vi.fn(),
  }
  const props = {
    skill: summary(),
    open: false,
    t,
    locale: 'en',
    busy: false,
    ...actions,
    ...over,
  } satisfies SkillCardProps
  render(<SkillCard {...props} />)
  return actions
}

describe('SkillCard', () => {
  it('shows name, description, status, and the enablement action while collapsed', () => {
    renderCard({ skill: summary({ name: 'demo', description: 'Does things', enabled: true }) })

    expect(screen.getByText('demo')).toBeTruthy()
    expect(screen.getByText('Does things')).toBeTruthy()
    expect(screen.getByText(en.statusEnabled)).toBeTruthy()
    expect(screen.getByRole('button', { name: en.actionDisable })).toBeTruthy()
    expect(screen.queryByText(en.actionView)).toBeNull()
  })

  it('labels every managed status', () => {
    const statuses = {
      enabled: en.statusEnabled,
      disabled: en.statusDisabled,
      'not-tested': en.statusNotTested,
      'benchmark-outdated': en.statusBenchmarkOutdated,
      warning: en.statusWarning,
      blocked: en.statusBlocked,
    } as const
    for (const [status, label] of Object.entries(statuses)) {
      cleanup()
      renderCard({ skill: summary({ status: status as SkillCardProps['skill']['status'] }) })
      expect(screen.getByText(label)).toBeTruthy()
    }
  })

  it('reveals scope, path, invocation, version, source, and last benchmark when expanded', () => {
    renderCard({
      open: true,
      skill: summary({
        scope: 'project',
        path: '/proj/.dsh/skills/demo',
        invocation: { modelInvocable: true, userInvocable: false },
        version: 'v3',
        versionsCount: 3,
        source: 'project',
        lastBenchmark: {
          runId: 'r1',
          at: '2026-01-02T03:04:05.000Z',
          version: 'v2',
          taskModel: { provider: 'deepseek', model: 'deepseek-chat' },
          evaluatorModel: { provider: 'deepseek', model: 'deepseek-chat' },
          baselineScore: 50,
          skillScore: 60,
          improvementPercent: 20,
          verdict: 'improvement',
          baselineTokens: { input: 1, output: 1, total: 2 },
          skillTokens: { input: 1, output: 1, total: 2 },
          baselineTimeMs: 10,
          skillTimeMs: 9,
          baselineToolCalls: 1,
          skillToolCalls: 1,
        },
      }),
    })

    expect(screen.getByText(en.scopeProject)).toBeTruthy()
    expect(screen.getByText('/proj/.dsh/skills/demo')).toBeTruthy()
    expect(screen.getByText(en.invocationModel)).toBeTruthy()
    expect(screen.getByText('v3')).toBeTruthy()
    expect(screen.getByText('project')).toBeTruthy()
    const benchmarkRow = screen.getByText(en.fieldLastBenchmark).closest('div')!
    expect(benchmarkRow.textContent).toContain(en.benchmarkVerdictImprovement)
    expect(benchmarkRow.textContent).toContain('2026')
    expect(screen.getByText(en.actionView)).toBeTruthy()
    expect(screen.getByText(en.actionEdit)).toBeTruthy()
    expect(screen.getByText(en.actionVersions)).toBeTruthy()
    expect(screen.getByText(en.actionBenchmark)).toBeTruthy()
    expect(screen.getByText(en.actionDelete)).toBeTruthy()
  })

  it('labels every scope and hides path when absent', () => {
    const scopes = {
      user: en.scopeUser,
      project: en.scopeProject,
      agents: en.scopeAgents,
      'built-in': en.scopeBuiltIn,
    } as const
    for (const [scope, label] of Object.entries(scopes)) {
      cleanup()
      renderCard({
        open: true,
        skill: summary({ scope: scope as SkillCardProps['skill']['scope'] }),
      })
      expect(screen.getByText(label)).toBeTruthy()
      expect(screen.queryByText(en.fieldPath)).toBeNull()
    }
  })

  it('labels every invocation policy', () => {
    const policies: Array<[SkillCardProps['skill']['invocation'], string]> = [
      [{ modelInvocable: true, userInvocable: true }, en.invocationBoth],
      [{ modelInvocable: true, userInvocable: false }, en.invocationModel],
      [{ modelInvocable: false, userInvocable: true }, en.invocationUser],
      [{ modelInvocable: false, userInvocable: false }, en.invocationNone],
    ]
    for (const [invocation, label] of policies) {
      cleanup()
      // A project scope keeps the invocation copy from colliding with the
      // scope label ("User" would match both rows).
      renderCard({ open: true, skill: summary({ scope: 'project', invocation }) })
      expect(screen.getByText(label)).toBeTruthy()
    }
  })

  it('says a skill was never benchmarked when it has no benchmark', () => {
    renderCard({ open: true })
    expect(screen.getByText(en.lastBenchmarkNone)).toBeTruthy()
  })

  it('keeps built-in skills read-only: no edit and no delete', () => {
    renderCard({ open: true, skill: summary({ scope: 'built-in' }) })

    expect(screen.getByText(en.scopeBuiltIn)).toBeTruthy()
    expect(screen.queryByText(en.actionEdit)).toBeNull()
    expect(screen.queryByText(en.actionDelete)).toBeNull()
    expect(screen.getByText(en.actionView)).toBeTruthy()
  })

  it('forwards the header toggle and every action', () => {
    const actions = renderCard({ open: true })
    fireEvent.click(screen.getByRole('button', { name: en.actionView }))
    fireEvent.click(screen.getByRole('button', { name: en.actionEdit }))
    fireEvent.click(screen.getByRole('button', { name: en.actionVersions }))
    fireEvent.click(screen.getByRole('button', { name: en.actionBenchmark }))
    fireEvent.click(screen.getByRole('button', { name: en.actionDelete }))
    fireEvent.click(screen.getByRole('button', { name: en.actionDisable }))
    fireEvent.click(screen.getByText('demo-skill'))

    expect(actions.onView).toHaveBeenCalledOnce()
    expect(actions.onEdit).toHaveBeenCalledOnce()
    expect(actions.onVersions).toHaveBeenCalledOnce()
    expect(actions.onBenchmark).toHaveBeenCalledOnce()
    expect(actions.onDelete).toHaveBeenCalledOnce()
    expect(actions.onToggleEnabled).toHaveBeenCalledOnce()
    expect(actions.onToggle).toHaveBeenCalledOnce()
  })

  it('disables the enablement and delete actions while busy', () => {
    renderCard({ open: true, busy: true })

    expect(screen.getByRole('button', { name: en.actionDisable })).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: en.actionDelete })).toHaveProperty('disabled', true)
  })

  it('offers Enable for a disabled skill', () => {
    renderCard({ skill: summary({ enabled: false }) })
    expect(screen.getByRole('button', { name: en.actionEnable })).toBeTruthy()
  })
})
