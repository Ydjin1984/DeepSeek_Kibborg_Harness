/** Shared fixtures and prop builders for the Skills Manager component specs. */

import { vi } from 'vitest'
import type {
  BenchmarkRunView, ManagedSkillSummaryView, ManagedSkillView, ModelProviderGroup,
  SecurityVerdictView, SkillVersionView, TrashEntryView,
} from '@deepseek-ai/dsh-host-apiproxy/api'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { SkillsActions, SkillWriteScope, SaveSkillInput, BenchmarkStartInput, BenchmarkBatchStartInput } from '../src/client/skills-api.ts'
import { en, type SkillsLocaleKey } from '../src/client/locales.ts'

/** Translate against the English dictionary, interpolating {params}. */
export const t = ((key: SkillsLocaleKey, params?: Record<string, unknown>): string => {
  const template = en[key]
  return params === undefined
    ? template
    : template.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match))
}) as TranslateNS<'settings.skills'>

/** One managed skill summary row. */
export function summary(over: Partial<ManagedSkillSummaryView> = {}): ManagedSkillSummaryView {
  return {
    name: 'demo-skill',
    description: 'A demo skill',
    invocation: { modelInvocable: true, userInvocable: true },
    scope: 'user',
    source: 'user',
    enabled: true,
    status: 'enabled',
    version: 'v1',
    versionsCount: 1,
    ...over,
  }
}

/** A full managed skill view (summary + body + versions). */
export function detail(over: Partial<ManagedSkillView> = {}): ManagedSkillView {
  return {
    ...summary(),
    content: '# Demo skill\n\nDoes demo things.',
    versions: [],
    ...over,
  }
}

/** One version-history row. */
export function version(over: Partial<SkillVersionView> = {}): SkillVersionView {
  return {
    id: 'v1',
    createdAt: '2026-01-02T03:04:05.000Z',
    reason: 'Initial',
    source: 'manual',
    ...over,
  }
}

/** One trash entry. */
export function trashEntry(over: Partial<TrashEntryView> = {}): TrashEntryView {
  return { name: 'gone-skill', scope: 'user', path: '/proj/.dsh/skills/gone-skill', ...over }
}

/** A model catalog with two groups. */
export function modelGroups(): readonly ModelProviderGroup[] {
  return [
    {
      id: 'deepseek',
      name: 'DeepSeek',
      models: [
        { id: 'deepseek-chat', name: 'DeepSeek Chat' },
        { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner' },
      ],
    },
    {
      id: 'anthropic',
      name: 'Anthropic',
      models: [{ id: 'claude-sonnet', name: 'Claude Sonnet' }],
    },
  ]
}

/** A completed benchmark run with a result. */
export function benchmarkRun(over: Partial<BenchmarkRunView> = {}): BenchmarkRunView {
  return {
    id: 'run-1',
    skillName: 'demo-skill',
    status: 'completed',
    phase: 'done',
    progress: { case: 3, total: 3 },
    createdAt: 1,
    result: {
      summary: {
        runId: 'run-1',
        at: '2026-01-02T03:04:05.000Z',
        version: 'v1',
        taskModel: { provider: 'deepseek', model: 'deepseek-chat' },
        evaluatorModel: { provider: 'deepseek', model: 'deepseek-chat' },
        baselineScore: 60,
        skillScore: 75,
        improvementPercent: 25,
        verdict: 'improvement',
        baselineTokens: { input: 100, output: 10, total: 110 },
        skillTokens: { input: 120, output: 12, total: 132 },
        baselineTimeMs: 1000,
        skillTimeMs: 900,
        baselineToolCalls: 3,
        skillToolCalls: 4,
      },
      cases: [
        {
          caseId: 'c1',
          title: 'First case',
          baselineScore: 50,
          skillScore: 70,
          improvementPercent: 40,
          baselineTokens: { input: 10, output: 1, total: 11 },
          skillTokens: { input: 12, output: 1, total: 13 },
          baselineTimeMs: 100,
          skillTimeMs: 90,
          baselineToolCalls: 1,
          skillToolCalls: 1,
          baselineError: false,
          skillError: false,
          baselineOutput: 'a',
          skillOutput: 'b',
          baselineComment: '',
          skillComment: '',
        },
      ],
      criteria: ['quality'],
      reasons: ['better'],
    },
    ...over,
  }
}

/** A benchmark run with the result omitted (failed, cancelled, or bare completion). */
export function benchmarkRunWithoutResult(over: Partial<BenchmarkRunView> = {}): BenchmarkRunView {
  const run = { ...benchmarkRun(), ...over }
  delete run.result
  return run
}

/** A benign security verdict. */
export const cleanVerdict: SecurityVerdictView = { status: 'valid', findings: [] }

/** Build a fake action table; every method is a vi.fn with a benign default. */
export function fakeActions(over: Partial<SkillsActions> = {}): SkillsActions {
  const save = vi.fn<SkillsActions['save']>()
  const listManaged = vi.fn<SkillsActions['listManaged']>()
  const trash = vi.fn<SkillsActions['trash']>()
  const read = vi.fn<SkillsActions['read']>()
  const remove = vi.fn<SkillsActions['remove']>()
  const restore = vi.fn<SkillsActions['restore']>()
  const permanentDelete = vi.fn<SkillsActions['permanentDelete']>()
  const setEnabled = vi.fn<SkillsActions['setEnabled']>()
  const versions = vi.fn<SkillsActions['versions']>()
  const rollback = vi.fn<SkillsActions['rollback']>()
  const activate = vi.fn<SkillsActions['activate']>()
  const validate = vi.fn<SkillsActions['validate']>()
  const securityCheck = vi.fn<SkillsActions['securityCheck']>()
  const benchmarkStart = vi.fn<SkillsActions['benchmarkStart']>()
  const benchmarkPoll = vi.fn<SkillsActions['benchmarkPoll']>()
  const benchmarkCancel = vi.fn<SkillsActions['benchmarkCancel']>()
  const benchmarkBatchStart = vi.fn<SkillsActions['benchmarkBatchStart']>()
  const listModels = vi.fn<SkillsActions['listModels']>()

  listManaged.mockResolvedValue([summary()])
  trash.mockResolvedValue([])
  read.mockResolvedValue(detail())
  save.mockResolvedValue({
    name: 'demo-skill',
    scope: 'user',
    path: '/proj/.dsh/skills/demo-skill/SKILL.md',
    created: false,
    version: 'v2',
    security: cleanVerdict,
  })
  remove.mockResolvedValue(undefined)
  restore.mockResolvedValue(undefined)
  permanentDelete.mockResolvedValue(undefined)
  setEnabled.mockResolvedValue(undefined)
  versions.mockResolvedValue([version()])
  rollback.mockResolvedValue('v1')
  activate.mockResolvedValue('v1')
  validate.mockResolvedValue({ ok: true })
  securityCheck.mockResolvedValue(cleanVerdict)
  benchmarkStart.mockResolvedValue(benchmarkRun())
  benchmarkPoll.mockResolvedValue(benchmarkRun())
  benchmarkCancel.mockResolvedValue(benchmarkRunWithoutResult({ status: 'cancelled' }))
  benchmarkBatchStart.mockResolvedValue([benchmarkRun()])
  listModels.mockResolvedValue(modelGroups())

  const actions: SkillsActions = {
    listManaged, trash, read, save, remove, restore, permanentDelete, setEnabled,
    versions, rollback, activate, validate, securityCheck, benchmarkStart, benchmarkPoll,
    benchmarkCancel, benchmarkBatchStart, listModels,
    ...over,
  }
  return actions
}

export type {
  SkillsActions, SkillWriteScope, SaveSkillInput, BenchmarkStartInput, BenchmarkBatchStartInput,
}
