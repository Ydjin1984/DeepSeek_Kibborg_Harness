/**
 * Claude Code technology settings section: shows the ported ECC skill library
 * (.dsh/skills cc-* and cc-role-* plus the claude-code umbrella skill), lets
 * the user enable/disable the recommended set, every category, or the whole
 * library through the skill-manager wire actions, and explains the chat
 * invocation. Skill enable state is local to this mounted section; every
 * mutation goes through the injected wire actions and re-reads the catalog.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import clsx from 'clsx'
import type { ManagedSkillSummaryView } from '@deepseek-ai/dsh-host-apiproxy/api'
import type { SessionId } from '@deepseek-ai/dsh-client-connection/client'
import type {
  InjectFace, PropsLocale, PropsRuntime,
} from '@deepseek-ai/dsh-client-ui-slots'
import type { ClaudeCodeLocaleKey } from './locales.ts'
import type { CcActions } from './claude-code-api.ts'
import {
  ALL_LIBRARY_SKILLS, CATEGORIES, RECOMMENDED, UMBRELLA_SKILL,
  type CcCategory, type CcCategoryId,
} from './groups.data.ts'
import css from './ClaudeCodeSection.module.css'

/** Registration-side business face for the section. */
export interface ClaudeCodeSectionInjected {
  /** The wire actions behind every section mutation. */
  actions: CcActions
}

/** Props the renderer binds for the section. */
export type ClaudeCodeSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'settings.claudeCode'>
  & InjectFace<ClaudeCodeSectionInjected>

/** Category id → locale key of its display name (kept explicit and type-safe). */
const CAT_NAME_KEY: Record<CcCategoryId, ClaudeCodeLocaleKey> = {
  testing: 'catTesting',
  review: 'catReview',
  architecture: 'catArchitecture',
  security: 'catSecurity',
  agentic: 'catAgentic',
  frontend: 'catFrontend',
  backend: 'catBackend',
  languages: 'catLanguages',
  docs: 'catDocs',
  research: 'catResearch',
  roles: 'catRoles',
  other: 'catOther',
}

/** Category id → locale key of its description. */
const CAT_DESC_KEY: Record<CcCategoryId, ClaudeCodeLocaleKey> = {
  testing: 'catTestingDesc',
  review: 'catReviewDesc',
  architecture: 'catArchitectureDesc',
  security: 'catSecurityDesc',
  agentic: 'catAgenticDesc',
  frontend: 'catFrontendDesc',
  backend: 'catBackendDesc',
  languages: 'catLanguagesDesc',
  docs: 'catDocsDesc',
  research: 'catResearchDesc',
  roles: 'catRolesDesc',
  other: 'catOtherDesc',
}

/** Library names the section manages (umbrella excluded from bulk toggles). */
const LIBRARY = new Set(ALL_LIBRARY_SKILLS)

/** One bulk operation the section runs: a label plus the target names. */
type BulkOp =
  | { kind: 'core' }
  | { kind: 'all' }
  | { kind: 'none' }
  | { kind: 'category'; id: CcCategoryId }

/** The section body; rendered only while a session is current. */
function ClaudeCodeBody(
  props: ClaudeCodeSectionProps & { sessionId: SessionId },
) {
  const { t, actions } = props
  const sessionId = props.sessionId
  const [skills, setSkills] = useState<readonly ManagedSkillSummaryView[] | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [op, setOp] = useState<BulkOp | null>(null)
  const [notice, setNotice] = useState<'done' | 'fail' | null>(null)

  const load = useCallback(async (sid: SessionId): Promise<void> => {
    const all = await actions.listManaged(sid)
    setSkills(all)
  }, [actions])

  /** Re-read the catalog after a mutation so counts reflect disk state. */
  const refresh = useCallback(async (): Promise<void> => {
    await load(sessionId)
  }, [load, sessionId])

  useEffect(() => {
    let current = true
    setLoadFailed(false)
    void load(sessionId).then(
      () => { /* list state committed inside load */ },
      /* v8 ignore next -- an unmounted section never flips the failure flag. */
      () => { if (current) setLoadFailed(true) },
    )
    return () => { current = false }
  }, [sessionId, load])

  // enabled lookup only over library skills the manager reports.
  const enabled = useMemo(() => {
    const map = new Map<string, boolean>()
    for (const skill of skills ?? []) {
      if (LIBRARY.has(skill.name)) map.set(skill.name, skill.enabled)
    }
    return map
  }, [skills])

  /** Run one bulk toggle: sequential setEnabled over the target names. */
  const runBulk = useCallback(async (target: BulkOp, enable: boolean): Promise<void> => {
    if (op !== null) return
    const names = target.kind === 'core'
      ? RECOMMENDED.filter(n => n !== UMBRELLA_SKILL)
      : target.kind === 'all' || target.kind === 'none'
        ? ALL_LIBRARY_SKILLS
        : CATEGORIES.find(c => c.id === target.id)?.skills ?? []
    if (names.length === 0) return
    setOp(target)
    setNotice(null)
    let failed = 0
    for (const name of names) {
      try {
        await actions.setEnabled(sessionId, name, enable)
      } catch {
        failed += 1
      }
    }
    try {
      await refresh()
    } catch {
      failed += 1
    }
    setOp(null)
    setNotice(failed === 0 ? 'done' : 'fail')
  }, [actions, op, refresh, sessionId])

  const countEnabled = (names: readonly string[]): number =>
    names.reduce((n, name) => n + (enabled.get(name) === true ? 1 : 0), 0)

  const umbrellaEnabled = enabled.get(UMBRELLA_SKILL) === true
  const bulkDisabled = op !== null

  const renderCategoryRow = (category: CcCategory): ReactNode => {
    const total = category.skills.length
    const on = countEnabled(category.skills)
    const busy = op?.kind === 'category' && op.id === category.id
    const checked = on === total && total > 0
    const indeterminate = on > 0 && on < total
    const toggle = (): void => {
      void runBulk({ kind: 'category', id: category.id }, on < total)
    }
    return (
      <label key={category.id} className={clsx(css.category, busy && css.busy)}>
        <input
          type="checkbox"
          className={css.checkbox}
          aria-label={t(CAT_NAME_KEY[category.id])}
          checked={checked}
          ref={(node) => { if (node) node.indeterminate = indeterminate }}
          disabled={bulkDisabled}
          onChange={toggle}
        />
        <span className={css.categoryText}>
          <span className={css.categoryName}>{t(CAT_NAME_KEY[category.id])}</span>
          <span className={css.categoryDesc}>{t(CAT_DESC_KEY[category.id])}</span>
        </span>
        <span className={css.count}>{t('countOf', { enabled: on, total })}</span>
      </label>
    )
  }

  const coreOn = countEnabled(RECOMMENDED.filter(n => n !== UMBRELLA_SKILL))
  const coreTotal = RECOMMENDED.length - 1

  return (
    <div className={css.section}>
      <h2 className={css.heading}>{t('title')}</h2>
      <p className={css.intro}>{t('intro')}</p>
      <div className={css.how}>
        <strong>{t('howTitle')}</strong>
        <span>{t('howBody')}</span>
      </div>

      {loadFailed
        ? (
          <div className={css.errorRow}>
            <span>{t('error')}</span>
            <button
              type="button"
              className={css.button}
              disabled={bulkDisabled}
              onClick={() => { setLoadFailed(false); void load(sessionId) }}
            >
              {t('retry')}
            </button>
          </div>
        )
        : skills === null
          ? <p className={css.muted}>{t('loading')}</p>
          : (
            <>
              <div className={css.coreRow}>
                <span className={css.coreText}>
                  {t('coreLine', { enabled: coreOn, total: coreTotal })}
                </span>
                <button
                  type="button"
                  className={css.buttonPrimary}
                  disabled={bulkDisabled}
                  onClick={() => { void runBulk({ kind: 'core' }, true) }}
                >
                  {t('enableCore')}
                </button>
                <button
                  type="button"
                  className={css.button}
                  disabled={bulkDisabled}
                  onClick={() => { void runBulk({ kind: 'all' }, true) }}
                >
                  {t('enableAll')}
                </button>
                <button
                  type="button"
                  className={css.button}
                  disabled={bulkDisabled}
                  onClick={() => { void runBulk({ kind: 'none' }, false) }}
                >
                  {t('disableAll')}
                </button>
              </div>
              {op !== null && <p className={css.muted}>{t('working')}</p>}
              {notice === 'done' && <p className={css.done}>{t('done')}</p>}
              {notice === 'fail' && <p className={css.error}>{t('fail')}</p>}

              <div className={css.umbrella}>
                <span className={clsx(css.dot, umbrellaEnabled && css.dotOn)} />
                <span className={css.categoryName}>{t('umbrellaLine')}</span>
              </div>
              <p className={css.umbrellaHint}>{t('umbrellaHint')}</p>

              <div className={css.categories}>
                {CATEGORIES.map(renderCategoryRow)}
              </div>
            </>
          )}
    </div>
  )
}

/** Settings entry: requires a current session (skills are project-scoped). */
export function ClaudeCodeSection(props: ClaudeCodeSectionProps): ReactNode {
  const { t } = props
  const sessionId = props.useSessions(snapshot => snapshot.current)
  if (sessionId === undefined) {
    return (
      <div className={css.section}>
        <h2 className={css.heading}>{t('title')}</h2>
        <p className={css.muted}>{t('noSession')}</p>
      </div>
    )
  }
  return <ClaudeCodeBody {...props} sessionId={sessionId} />
}
