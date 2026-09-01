/**
 * One managed-skill card: header with name/description/status/enablement,
 * expanding into the lifecycle details (scope, path, invocation, version,
 * last benchmark) and the action row (view/edit/versions/benchmark/delete).
 * Built-in skills are read-only: they render no edit or delete action.
 */

import type {
  BenchmarkSummaryView, ManagedSkillStatus, ManagedSkillSummaryView,
} from '@deepseek-ai/dsh-host-apiproxy/api'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { SkillsLocaleKey } from './locales.ts'
import { formatDateTime } from './formats.ts'
import css from './SkillsSettingsSection.module.css'

/** Locale key per managed status. */
const STATUS_KEYS: Record<ManagedSkillStatus, SkillsLocaleKey> = {
  enabled: 'statusEnabled',
  disabled: 'statusDisabled',
  'not-tested': 'statusNotTested',
  'benchmark-outdated': 'statusBenchmarkOutdated',
  warning: 'statusWarning',
  blocked: 'statusBlocked',
}

/** Locale key per managed scope. */
const SCOPE_KEYS: Record<ManagedSkillSummaryView['scope'], SkillsLocaleKey> = {
  user: 'scopeUser',
  project: 'scopeProject',
  agents: 'scopeAgents',
  'built-in': 'scopeBuiltIn',
}

/** Benchmark verdict copy key. */
const VERDICT_KEYS: Record<BenchmarkSummaryView['verdict'], SkillsLocaleKey> = {
  improvement: 'benchmarkVerdictImprovement',
  worse: 'benchmarkVerdictWorse',
  'no-significant-improvement': 'benchmarkVerdictNoSignificant',
}

/** Props of one managed-skill card. */
export interface SkillCardProps {
  /** The managed skill summary to render. */
  skill: ManagedSkillSummaryView
  /** Whether the lifecycle details are expanded. */
  open: boolean
  /** Locale reader for the Skills section. */
  t: TranslateNS<'settings.skills'>
  /** BCP-47 locale tag for date formatting. */
  locale: string
  /** Toggle the lifecycle details. */
  onToggle: () => void
  /** Open the read-only viewer. */
  onView: () => void
  /** Open the editor. */
  onEdit: () => void
  /** Move the skill to the trash. */
  onDelete: () => void
  /** Flip the enabled flag. */
  onToggleEnabled: () => void
  /** Open the version history. */
  onVersions: () => void
  /** Open the benchmark dialog. */
  onBenchmark: () => void
  /** Whether this card's actions are in flight (enable/delete). */
  busy: boolean
}

/** Invocation-policy copy key for a skill's invocation flags. */
function invocationKey(skill: ManagedSkillSummaryView): SkillsLocaleKey {
  const { modelInvocable, userInvocable } = skill.invocation
  if (modelInvocable && userInvocable) return 'invocationBoth'
  if (modelInvocable) return 'invocationModel'
  if (userInvocable) return 'invocationUser'
  return 'invocationNone'
}

/** Last-benchmark line, or the "never benchmarked" fallback. */
function benchmarkLine(benchmark: BenchmarkSummaryView | undefined, t: SkillCardProps['t'], locale: string): string {
  if (benchmark === undefined) return t('lastBenchmarkNone')
  return t('lastBenchmarkLine', {
    verdict: t(VERDICT_KEYS[benchmark.verdict]),
    at: formatDateTime(benchmark.at, locale),
  })
}

/**
 * Render one managed-skill card.
 * @param props - the skill row plus its action callbacks.
 * @returns the card element.
 */
export function SkillCard(props: SkillCardProps) {
  const { skill, open, t, busy, locale } = props
  const readOnly = skill.scope === 'built-in'
  return (
    <li className={css.card} data-skill={skill.name} data-open={open ? 'true' : undefined}>
      <div className={css.cardHeader}>
        <button
          type="button"
          className={css.cardMain}
          aria-expanded={open}
          onClick={props.onToggle}
        >
          <strong className={css.cardTitle}>{skill.name}</strong>
          <span className={css.cardDescription}>{skill.description}</span>
        </button>
        <span className={css.statusBadge} data-status={skill.status}>{t(STATUS_KEYS[skill.status])}</span>
        <button
          type="button"
          className={css.toggleButton}
          disabled={busy}
          aria-label={skill.enabled ? t('actionDisable') : t('actionEnable')}
          onClick={props.onToggleEnabled}
        >
          {skill.enabled ? t('actionDisable') : t('actionEnable')}
        </button>
      </div>
      {open
        ? (
          <>
            <dl className={css.details}>
              <div><dt>{t('fieldScope')}</dt><dd>{t(SCOPE_KEYS[skill.scope])}</dd></div>
              <div><dt>{t('fieldStatus')}</dt><dd>{t(STATUS_KEYS[skill.status])}</dd></div>
              <div><dt>{t('fieldInvocation')}</dt><dd>{t(invocationKey(skill))}</dd></div>
              <div><dt>{t('fieldVersion')}</dt><dd>{skill.version}</dd></div>
              {skill.path !== undefined
                ? <div><dt>{t('fieldPath')}</dt><dd className={css.mono}>{skill.path}</dd></div>
                : null}
              <div><dt>{t('fieldSource')}</dt><dd>{skill.source}</dd></div>
              <div><dt>{t('fieldLastBenchmark')}</dt><dd>{benchmarkLine(skill.lastBenchmark, t, locale)}</dd></div>
            </dl>
            <div className={css.actions}>
              <button type="button" className={css.actionButton} onClick={props.onView}>{t('actionView')}</button>
              {!readOnly
                ? <button type="button" className={css.actionButton} onClick={props.onEdit}>{t('actionEdit')}</button>
                : null}
              <button type="button" className={css.actionButton} onClick={props.onVersions}>{t('actionVersions')}</button>
              <button type="button" className={css.actionButton} onClick={props.onBenchmark}>{t('actionBenchmark')}</button>
              {!readOnly
                ? (
                  <button type="button" className={css.actionDanger} disabled={busy} onClick={props.onDelete}>
                    {t('actionDelete')}
                  </button>
                )
                : null}
            </div>
          </>
        )
        : null}
    </li>
  )
}
