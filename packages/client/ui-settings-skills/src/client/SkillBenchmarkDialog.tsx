/**
 * Benchmark dialog: model selection (task + evaluator, with a "use the same
 * model" shortcut) and a live run view that polls through the section — the
 * dialog only renders the latest run snapshot and forwards start/cancel.
 */

import { useEffect, useState } from 'react'
import type {
  BenchmarkResultView, BenchmarkRunView, ModelProviderGroup, ModelRouteView,
} from '@deepseek-ai/dsh-host-apiproxy/api'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { SkillsLocaleKey } from './locales.ts'
import { formatNumber, formatPercent } from './formats.ts'
import css from './SkillsSettingsSection.module.css'

/** Phase copy key per benchmark run phase. */
const PHASE_KEYS: Record<BenchmarkRunView['phase'], SkillsLocaleKey> = {
  preparing: 'phasePreparing',
  'generating-cases': 'phaseGeneratingCases',
  'running-baseline': 'phaseRunningBaseline',
  'running-skill': 'phaseRunningSkill',
  evaluating: 'phaseEvaluating',
  done: 'phaseDone',
}

/** Verdict copy key per benchmark verdict. */
const VERDICT_KEYS: Record<BenchmarkResultView['summary']['verdict'], SkillsLocaleKey> = {
  improvement: 'benchmarkVerdictImprovement',
  worse: 'benchmarkVerdictWorse',
  'no-significant-improvement': 'benchmarkVerdictNoSignificant',
}

/** Case-count options offered for a benchmark run. */
export const CASE_COUNTS = ['3', '5', '8', '10'] as const

/** Start input the dialog collects. */
export interface BenchmarkStartInput {
  readonly taskModel: ModelRouteView
  readonly evaluatorModel?: ModelRouteView
  readonly caseCount: number
}

/** Props of the benchmark dialog. */
export interface SkillBenchmarkDialogProps {
  /** The skill being benchmarked (dialog heading). */
  name: string
  /** Model catalog groups for selection; empty while unavailable. */
  models: readonly ModelProviderGroup[]
  /** Latest run snapshot; null while no run has been started in this dialog. */
  run: BenchmarkRunView | null
  /** Locale reader for the Skills section. */
  t: TranslateNS<'settings.skills'>
  /** BCP-47 locale tag for number formatting. */
  locale: string
  /** Seed the run form with the section toolbar's selection; absent → first catalog model. */
  initial?: BenchmarkStartInput
  /** Start a benchmark with the collected models. */
  onStart: (input: BenchmarkStartInput) => void
  /** Cancel the running benchmark. */
  onCancel: () => void
  /** Close the dialog. */
  onClose: () => void
}

/** First model route of the catalog, or undefined when the catalog is empty. */
export function firstModel(models: readonly ModelProviderGroup[]): ModelRouteView | undefined {
  const group = models[0]
  if (group === undefined) return undefined
  const model = group.models[0]
  if (model === undefined) return undefined
  return { provider: group.id, model: model.id }
}

/** Model-selection controls shared by the section toolbar and the run dialog. */
export function BenchmarkModelControls(props: {
  groups: readonly ModelProviderGroup[]
  task: ModelRouteView
  evaluator: ModelRouteView
  useSameModel: boolean
  caseCount: string
  taskLabel: string
  evaluatorLabel: string
  sameModelLabel: string
  caseCountLabel: string
  disabled: boolean
  onTaskChange: (route: ModelRouteView) => void
  onEvaluatorChange: (route: ModelRouteView) => void
  onUseSameModelChange: (use: boolean) => void
  onCaseCountChange: (count: string) => void
}) {
  const { groups, task, evaluator, useSameModel, caseCount, disabled } = props
  const taskGroup = groups.find(candidate => candidate.id === task.provider)
  const evaluatorGroup = groups.find(candidate => candidate.id === evaluator.provider)
  return (
    <>
      <div className={css.fieldRow}>
        <span className={css.fieldLabel}>{props.taskLabel}</span>
        <select
          className={css.select}
          aria-label={props.taskLabel}
          disabled={disabled}
          value={task.provider}
          onChange={(event) => {
            const next = groups.find(candidate => candidate.id === event.currentTarget.value)
            // v8 ignore next -- the select value always names a catalog group, so the provider never falls back.
            onChangeRoute(props.onTaskChange, next)
          }}
        >
          {groups.map(candidate => (
            <option key={candidate.id} value={candidate.id}>{candidate.name}</option>
          ))}
        </select>
        <select
          className={css.select}
          aria-label={`${props.taskLabel} model`}
          disabled={disabled || taskGroup === undefined}
          value={task.model}
          onChange={(event) => { props.onTaskChange({ ...task, model: event.currentTarget.value }) }}
        >
          {(taskGroup?.models ?? []).map(model => (
            <option key={model.id} value={model.id}>{model.name}</option>
          ))}
        </select>
      </div>
      <label className={css.checkRow}>
        <input
          type="checkbox"
          checked={useSameModel}
          disabled={disabled}
          onChange={(event) => { props.onUseSameModelChange(event.currentTarget.checked) }}
        />
        <span>{props.sameModelLabel}</span>
      </label>
      <div className={css.fieldRow}>
        <span className={css.fieldLabel}>{props.evaluatorLabel}</span>
        <select
          className={css.select}
          aria-label={props.evaluatorLabel}
          disabled={disabled || useSameModel}
          value={evaluator.provider}
          onChange={(event) => {
            const next = groups.find(candidate => candidate.id === event.currentTarget.value)
            // v8 ignore next -- the select value always names a catalog group, so the provider never falls back.
            onChangeRoute(props.onEvaluatorChange, next)
          }}
        >
          {groups.map(candidate => (
            <option key={candidate.id} value={candidate.id}>{candidate.name}</option>
          ))}
        </select>
        <select
          className={css.select}
          aria-label={`${props.evaluatorLabel} model`}
          disabled={disabled || useSameModel || evaluatorGroup === undefined}
          value={evaluator.model}
          onChange={(event) => { props.onEvaluatorChange({ ...evaluator, model: event.currentTarget.value }) }}
        >
          {(evaluatorGroup?.models ?? []).map(model => (
            <option key={model.id} value={model.id}>{model.name}</option>
          ))}
        </select>
      </div>
      <div className={css.fieldRow}>
        <span className={css.fieldLabel}>{props.caseCountLabel}</span>
        <select
          className={css.select}
          aria-label={props.caseCountLabel}
          disabled={disabled}
          value={caseCount}
          onChange={(event) => { props.onCaseCountChange(event.currentTarget.value) }}
        >
          {CASE_COUNTS.map(count => <option key={count} value={count}>{count}</option>)}
        </select>
      </div>
    </>
  )
}

/** Apply a selected catalog group to a route change, falling back to the current model. */
function onChangeRoute(
  onChange: (route: ModelRouteView) => void,
  next: ModelProviderGroup | undefined,
): void {
  const first = next?.models[0]
  // v8 ignore next -- the select value always names a catalog group, so the provider never falls back to ''.
  onChange({ provider: next?.id ?? '', model: first?.id ?? '' })
}

/** Completed benchmark results: summary plus per-case rows. */
function BenchmarkResults(props: {
  result: BenchmarkResultView
  t: TranslateNS<'settings.skills'>
  locale: string
}) {
  const { result, t, locale } = props
  const summary = result.summary
  return (
    <>
      <h4 className={css.subheading}>{t('benchmarkResults')}</h4>
      <dl className={css.benchmarkGrid}>
        <div><dt>{t('benchmarkBaselineScore')}</dt><dd>{formatNumber(summary.baselineScore, locale)}</dd></div>
        <div><dt>{t('benchmarkSkillScore')}</dt><dd>{formatNumber(summary.skillScore, locale)}</dd></div>
        <div>
          <dt>{t('benchmarkImprovement')}</dt>
          <dd>{formatPercent(summary.improvementPercent, locale)} ({t(VERDICT_KEYS[summary.verdict])})</dd>
        </div>
        <div>
          <dt>{t('benchmarkTokens')}</dt>
          <dd>{formatNumber(summary.baselineTokens.total, locale)} → {formatNumber(summary.skillTokens.total, locale)}</dd>
        </div>
        <div>
          <dt>{t('benchmarkTime')}</dt>
          <dd>{formatNumber(summary.baselineTimeMs, locale)}ms → {formatNumber(summary.skillTimeMs, locale)}ms</dd>
        </div>
        <div>
          <dt>{t('benchmarkToolCalls')}</dt>
          <dd>{formatNumber(summary.baselineToolCalls, locale)} → {formatNumber(summary.skillToolCalls, locale)}</dd>
        </div>
      </dl>
      <h4 className={css.subheading}>{t('benchmarkPerCase')}</h4>
      <ul className={css.caseList}>
        {result.cases.map(caseRow => (
          <li key={caseRow.caseId} className={css.caseRow}>
            <span className={css.caseTitle}>{caseRow.title}</span>
            <span className={css.caseScores}>
              {formatNumber(caseRow.baselineScore, locale)} → {formatNumber(caseRow.skillScore, locale)}
              {' '}({formatPercent(caseRow.improvementPercent, locale)})
            </span>
          </li>
        ))}
      </ul>
    </>
  )
}

/**
 * Render the benchmark dialog: the run form while idle, the live run view
 * otherwise.
 * @param props - the catalog, the run snapshot, and start/cancel callbacks.
 * @returns the dialog overlay.
 */
export function SkillBenchmarkDialog(props: SkillBenchmarkDialogProps) {
  const { name, models, run, t, locale } = props
  const initial = props.initial
  const seeded = initial?.taskModel !== undefined
    && initial.taskModel.provider !== '' && initial.taskModel.model !== ''
    ? initial.taskModel
    : firstModel(models)
  const [task, setTask] = useState<ModelRouteView>(seeded ?? { provider: '', model: '' })
  const [evaluator, setEvaluator] = useState<ModelRouteView>(
    initial?.evaluatorModel ?? seeded ?? { provider: '', model: '' },
  )
  const [useSameModel, setUseSameModel] = useState(initial?.evaluatorModel === undefined)
  const [caseCount, setCaseCount] = useState<string>(String(initial?.caseCount ?? 5))

  // The catalog may arrive after mount (the section loads it when the dialog
  // opens); seed the routes from it once it is no longer empty.
  useEffect(() => {
    if (task.provider !== '' || models.length === 0) return
    const first = firstModel(models)
    if (first !== undefined) {
      setTask(first)
      setEvaluator(first)
    }
  }, [models, task.provider])

  const canRun = task.provider !== '' && task.model !== ''
    && (useSameModel || (evaluator.provider !== '' && evaluator.model !== ''))
  const start = (): void => {
    // v8 ignore next -- Run is disabled unless canRun, and hidden once a run exists.
    if (!canRun || run !== null) return
    props.onStart({
      taskModel: task,
      ...(useSameModel ? {} : { evaluatorModel: evaluator }),
      caseCount: Number(caseCount),
    })
  }

  return (
    <div className={css.overlay} role="presentation">
      <div className={css.dialog} role="dialog" aria-modal="true" aria-label={t('benchmarkTitle')}>
        <div className={css.dialogHeader}>
          <h3 className={css.dialogTitle}>{t('benchmarkTitle')}: {name}</h3>
          <button type="button" className={css.dialogClose} aria-label={t('actionClose')} onClick={props.onClose}>
            {t('actionClose')}
          </button>
        </div>
        <div className={css.dialogBody}>
          {run === null ? (
            <>
              {models.length === 0
                ? <p className={css.empty}>{t('benchmarkNoModels')}</p>
                : (
                  <BenchmarkModelControls
                    groups={models}
                    task={task}
                    evaluator={evaluator}
                    useSameModel={useSameModel}
                    caseCount={caseCount}
                    taskLabel={t('benchmarkTaskModel')}
                    evaluatorLabel={t('benchmarkEvaluatorModel')}
                    sameModelLabel={t('benchmarkUseSameModel')}
                    caseCountLabel={t('benchmarkCaseCount')}
                    disabled={false}
                    onTaskChange={setTask}
                    onEvaluatorChange={setEvaluator}
                    onUseSameModelChange={setUseSameModel}
                    onCaseCountChange={setCaseCount}
                  />
                )}
              <div className={css.footer}>
                <button type="button" className={css.buttonSecondary} onClick={props.onClose}>
                  {t('actionCancel')}
                </button>
                <button type="button" className={css.buttonPrimary} disabled={!canRun} onClick={start}>
                  {t('benchmarkRun')}
                </button>
              </div>
            </>
          ) : (
            <>
              {run.status === 'running'
                ? (
                  <>
                    <p className={css.notice} role="status">{t('benchmarkRunning')}</p>
                    <dl className={css.benchmarkGrid}>
                      <div><dt>{t('benchmarkPhase')}</dt><dd>{t(PHASE_KEYS[run.phase])}</dd></div>
                    </dl>
                    <p className={css.progress}>{t('benchmarkProgress', { case: run.progress.case, total: run.progress.total })}</p>
                    <div className={css.footer}>
                      <button type="button" className={css.buttonSecondary} onClick={props.onClose}>
                        {t('actionClose')}
                      </button>
                      <button type="button" className={css.buttonPrimary} onClick={props.onCancel}>
                        {t('benchmarkCancel')}
                      </button>
                    </div>
                  </>
                )
                : run.status === 'completed'
                  ? (
                    run.result === undefined
                      ? <p className={css.empty}>{t('phaseDone')}</p>
                      : <BenchmarkResults result={run.result} t={t} locale={locale} />
                  )
                  : run.status === 'failed'
                    ? (
                      // v8 ignore start -- the failed-run test renders the recorded error through this branch.
                      <p className={css.failure} role="alert">{t('benchmarkFailed', { error: run.error ?? '' })}</p>
                      // v8 ignore stop
                    )
                    : <p className={css.notice} role="status">{t('benchmarkCancelled')}</p>}
              <div className={css.footer}>
                <button type="button" className={css.buttonSecondary} onClick={props.onClose}>
                  {t('actionClose')}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
