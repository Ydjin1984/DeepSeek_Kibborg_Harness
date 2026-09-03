/**
 * Skills Manager settings section: the searchable managed-skill catalog
 * grouped into filesystem ("My skills") and built-in lists, the trash, and
 * the view/edit/versions/benchmark dialogs. All skill state is local to this
 * mounted section (a reading gesture, not shared state); every mutation goes
 * through the injected wire actions and re-reads the catalog.
 */

import { useCallback, useEffect, useState } from 'react'
import { IconSearchOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  BenchmarkRunView, ManagedSkillSummaryView, ManagedSkillView, ModelProviderGroup, ModelRouteView,
  SkillVersionView, TrashEntryView,
} from '@deepseek-ai/dsh-host-apiproxy/api'
import type { SessionId } from '@deepseek-ai/dsh-client-connection/client'
import type {
  HostObservable, InjectFace, PropsLocale, PropsRuntime,
} from '@deepseek-ai/dsh-client-ui-slots'
import { SkillCard } from './SkillCard.tsx'
import { SkillEditDialog, type SkillSaveOptions } from './SkillEditDialog.tsx'
import { SkillViewDialog } from './SkillViewDialog.tsx'
import { SkillVersionsDialog } from './SkillVersionsDialog.tsx'
import {
  BenchmarkModelControls,
  SkillBenchmarkDialog,
  type BenchmarkStartInput,
} from './SkillBenchmarkDialog.tsx'
import { TrashSection } from './TrashSection.tsx'
import type { SkillsActions, SkillWriteScope } from './skills-api.ts'
import css from './SkillsSettingsSection.module.css'

/** Registration-side business face for the section. */
export interface SkillsSectionInjected {
  /** The wire actions behind every section mutation. */
  actions: SkillsActions
  hooks: {
    /** Active BCP-47 locale tag (drives date/number formatting). */
    locale: HostObservable<string>
  }
}

/** Props the renderer binds for the section. */
export type SkillsSettingsSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'settings.skills'>
  & InjectFace<SkillsSectionInjected>

/** Versions-dialog payload. */
interface VersionsDialogState {
  name: string
  versions: readonly SkillVersionView[]
  activeVersion: string
}

/** Write scope of a managed skill; built-ins are never edited. */
function writeScope(scope: ManagedSkillSummaryView['scope']): SkillWriteScope {
  /* v8 ignore next -- the editor never opens for built-in skills (no Edit action is rendered) */
  if (scope === 'built-in') return 'user'
  return scope
}

/** The section body; rendered only while a session is current. */
function SkillsSectionBody(
  props: SkillsSettingsSectionProps & { sessionId: SessionId },
) {
  const { t, actions } = props
  const sessionId = props.sessionId
  const locale = props.useLocale(value => value)
  const [list, setList] = useState<readonly ManagedSkillSummaryView[] | null>(null)
  const [trash, setTrash] = useState<readonly TrashEntryView[] | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [request, setRequest] = useState(0)
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [details, setDetails] = useState<ReadonlyMap<string, ManagedSkillView>>(new Map())
  const [busyName, setBusyName] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [viewing, setViewing] = useState<ManagedSkillView | null>(null)
  const [editing, setEditing] = useState<ManagedSkillView | null>(null)
  const [versionsOf, setVersionsOf] = useState<VersionsDialogState | null>(null)
  const [benchmarkOf, setBenchmarkOf] = useState<string | null>(null)
  const [benchmarkRun, setBenchmarkRun] = useState<BenchmarkRunView | null>(null)
  const [models, setModels] = useState<readonly ModelProviderGroup[] | null>(null)
  // Section-level benchmark selection: the toolbar seeds the per-skill dialog
  // and drives the run-all batch.
  const [batchTask, setBatchTask] = useState<ModelRouteView>({ provider: '', model: '' })
  const [batchEvaluator, setBatchEvaluator] = useState<ModelRouteView>({ provider: '', model: '' })
  const [batchUseSame, setBatchUseSame] = useState(true)
  const [batchCases, setBatchCases] = useState('5')
  const [batchRuns, setBatchRuns] = useState<readonly BenchmarkRunView[] | null>(null)

  const load = useCallback(async (sid: SessionId): Promise<void> => {
    const [skills, trashEntries] = await Promise.all([actions.listManaged(sid), actions.trash(sid)])
    setList(skills)
    setTrash(trashEntries)
  }, [actions])

  /** Re-read the catalog; the section's status badges refresh from disk state. */
  const refresh = useCallback(async (): Promise<void> => {
    await load(sessionId)
  }, [load, sessionId])

  // Load the model catalog once at mount: the toolbar's model fields and the
  // per-skill dialog both consume it. A failure surfaces as the action error
  // and the toolbar falls back to the empty state.
  useEffect(() => {
    if (models !== null) return
    void actions.listModels().then(
      (groups) => {
        setModels(groups)
        // v8 ignore next -- the toolbar is not rendered until models arrive, so the selection is always unseeded here.
        if (batchTask.provider === '') {
          const first = groups[0]?.models[0]
          if (groups[0] !== undefined && first !== undefined) {
            setBatchTask({ provider: groups[0].id, model: first.id })
            setBatchEvaluator({ provider: groups[0].id, model: first.id })
          }
        }
      },
      (cause: unknown) => { setActionError(cause instanceof Error ? cause.message : String(cause)) },
    )
  }, [actions, models, batchTask.provider])

  useEffect(() => {
    let current = true
    setLoadFailed(false)
    void load(sessionId).then(
      () => { /* list state committed inside load */ },
      // v8 ignore next -- an unmounted section never flips the failure flag.
      () => { if (current) setLoadFailed(true) },
    )
    return () => { current = false }
  }, [sessionId, load, request])

  // Poll the running benchmark until it settles; a failed poll keeps the last
  // view (the user can cancel or close, and the host may be mid-restart). The
  // catalog is re-read once the run settles so the card status reflects the
  // freshly persisted benchmark.
  useEffect(() => {
    if (benchmarkRun === null || benchmarkRun.status !== 'running') return
    const timer = window.setInterval(() => {
      void actions.benchmarkPoll(benchmarkRun.id).then(
        (run) => {
          setBenchmarkRun(run)
          if (run.status !== 'running') void refresh()
        },
        () => { /* keep the last run view; cancel/close remain available */ },
      )
    }, 2000)
    return () => { window.clearInterval(timer) }
  }, [benchmarkRun, actions, refresh])

  // Poll every running run of the batch; when the last one settles the catalog
  // is re-read so the status badges refresh for every completed skill.
  useEffect(() => {
    if (batchRuns === null || batchRuns.every(run => run.status !== 'running')) return
    const timer = window.setInterval(() => {
      const running = batchRuns.filter(run => run.status === 'running')
      void Promise.all(running.map(run => actions.benchmarkPoll(run.id))).then(
        (updated) => {
          setBatchRuns((previous) => {
            // v8 ignore next -- a batch is never cleared while its poll is in flight.
            if (previous === null) return previous
            const byId = new Map(updated.map(run => [run.id, run]))
            return previous.map(run => byId.get(run.id) ?? run)
          })
          if (updated.every(run => run.status !== 'running')) void refresh()
        },
        () => { /* keep the last run views; the batch can still be cancelled */ },
      )
    }, 2000)
    return () => { window.clearInterval(timer) }
  }, [batchRuns, actions, refresh])

  /** Run one card action, guarding concurrent actions and surfacing failures. */
  const runAction = async <T,>(key: string, fn: () => Promise<T>): Promise<T | undefined> => {
    // v8 ignore next -- all action buttons are disabled while an action is in flight.
    if (busyName !== null) return undefined
    setBusyName(key)
    setActionError(null)
    try {
      return await fn()
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : String(cause))
      return undefined
    } finally {
      setBusyName(null)
    }
  }

  /**
   * Run one version-dialog selection. Unlike card actions, the error is
   * re-thrown after surfacing: the versions dialog awaits the promise and
   * must not paint a success notice for a failed activation or rollback.
   */
  const runVersionSelection = async (key: string, fn: () => Promise<void>): Promise<void> => {
    setActionError(null)
    setBusyName(key)
    try {
      await fn()
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : String(cause))
      throw cause
    } finally {
      setBusyName(null)
    }
  }

  const retry = (): void => {
    setLoadFailed(false)
    setRequest(value => value + 1)
  }

  const ensureDetail = async (name: string): Promise<ManagedSkillView | undefined> => {
    const cached = details.get(name)
    if (cached !== undefined) return cached
    const detail = await actions.read(sessionId, name)
    if (detail !== undefined) {
      setDetails(previous => new Map(previous).set(name, detail))
    }
    return detail
  }

  const toggleEnabled = (skill: ManagedSkillSummaryView): void => {
    void runAction(`toggle:${skill.name}`, async () => {
      await actions.setEnabled(sessionId, skill.name, !skill.enabled)
      await refresh()
    })
  }

  const deleteSkill = (skill: ManagedSkillSummaryView): void => {
    void runAction(`delete:${skill.name}`, async () => {
      await actions.remove(sessionId, skill.name)
      setExpanded(null)
      await refresh()
    })
  }

  const openView = (skill: ManagedSkillSummaryView): void => {
    void runAction(`view:${skill.name}`, async () => {
      const detail = await ensureDetail(skill.name)
      if (detail !== undefined) setViewing(detail)
    })
  }

  const openEdit = (skill: ManagedSkillSummaryView): void => {
    void runAction(`edit:${skill.name}`, async () => {
      const detail = await ensureDetail(skill.name)
      if (detail !== undefined) setEditing(detail)
    })
  }

  const openVersions = (skill: ManagedSkillSummaryView): void => {
    void runAction(`versions:${skill.name}`, async () => {
      const [detail, versions] = await Promise.all([
        ensureDetail(skill.name),
        actions.versions(sessionId, skill.name),
      ])
      if (detail !== undefined) setVersionsOf({ name: skill.name, versions, activeVersion: detail.version })
    })
  }

  const openBenchmark = (skill: ManagedSkillSummaryView): void => {
    setBenchmarkOf(skill.name)
    setBenchmarkRun(null)
  }

  const saveSkill = async (content: string, options: SkillSaveOptions): Promise<void> => {
    const target = editing
    /* v8 ignore next -- the dialog is mounted only while editing is set */
    if (target === null) return
    await actions.save({
      sessionId,
      name: target.name,
      content,
      scope: writeScope(target.scope),
      replace: options.replace,
      force: options.force,
    })
  }

  const onSaved = async (name: string): Promise<void> => {
    setEditing(null)
    setDetails((previous) => {
      const next = new Map(previous)
      next.delete(name)
      return next
    })
    await runAction('refresh', () => refresh())
  }

  const rollbackTo = async (version: string): Promise<void> => {
    const target = versionsOf
    /* v8 ignore next -- the dialog is mounted only while versionsOf is set */
    if (target === null) return
    await runVersionSelection(`rollback:${target.name}`, async () => {
      await actions.rollback(sessionId, target.name, version)
      // A fresh read, not the cache: rollback moved the active version.
      const [detail, versions] = await Promise.all([
        actions.read(sessionId, target.name),
        actions.versions(sessionId, target.name),
      ])
      /* v8 ignore next -- a skill removed between rollback and refresh keeps the last dialog view. */
      if (detail !== undefined) {
        setDetails(previous => new Map(previous).set(target.name, detail))
        setVersionsOf({ name: target.name, versions, activeVersion: detail.version })
      }
    })
  }

  const activateTo = async (version: string): Promise<void> => {
    const target = versionsOf
    /* v8 ignore next -- the dialog is mounted only while versionsOf is set */
    if (target === null) return
    await runVersionSelection(`activate:${target.name}`, async () => {
      await actions.activate(sessionId, target.name, version)
      // A fresh read, not the cache: activation moved the active version.
      const [detail, versions] = await Promise.all([
        actions.read(sessionId, target.name),
        actions.versions(sessionId, target.name),
      ])
      /* v8 ignore next -- a skill removed between activation and refresh keeps the last dialog view. */
      if (detail !== undefined) {
        setDetails(previous => new Map(previous).set(target.name, detail))
        setVersionsOf({ name: target.name, versions, activeVersion: detail.version })
      }
    })
  }

  const startBenchmark = (input: BenchmarkStartInput): void => {
    const target = benchmarkOf
    /* v8 ignore next -- the dialog is mounted only while benchmarkOf is set */
    if (target === null) return
    void runAction('benchmark', async () => {
      const run = await actions.benchmarkStart({ sessionId, name: target, ...input })
      setBenchmarkRun(run)
    })
  }

  const cancelBenchmark = (): void => {
    const run = benchmarkRun
    /* v8 ignore next -- cancel renders only while a run exists */
    if (run === null) return
    void runAction('benchmark', async () => {
      const cancelled = await actions.benchmarkCancel(run.id)
      setBenchmarkRun(cancelled)
    })
  }

  /** Start one sequential benchmark batch over every managed (non-built-in) skill. */
  const runAllBenchmarks = (): void => {
    // v8 ignore next -- the Run-all button is disabled unless managed skills and models exist, so the guard is defensive.
    if (managedNames.length === 0 || models === null) return
    void runAction('benchmark-all', async () => {
      const runs = await actions.benchmarkBatchStart({
        sessionId,
        names: managedNames,
        taskModel: batchTask,
        ...(batchUseSame ? {} : { evaluatorModel: batchEvaluator }),
        // v8 ignore next -- the offered case counts are all positive, so the omission branch is defensive.
        ...(Number(batchCases) > 0 ? { caseCount: Number(batchCases) } : {}),
      })
      setBatchRuns(runs)
    })
  }

  /** Cancel every still-running run of the batch. */
  const cancelBatch = (): void => {
    // v8 ignore start -- the Cancel button renders only while the batch has a running run, so these arms are defensive.
    const running = (batchRuns ?? []).filter(run => run.status === 'running')
    if (running.length === 0) return
    // v8 ignore stop
    void runAction('benchmark-all', async () => {
      const cancelled = await Promise.all(running.map(run => actions.benchmarkCancel(run.id)))
      setBatchRuns((previous) => {
        // v8 ignore next -- a batch is never cleared while its runs are being cancelled.
        if (previous === null) return previous
        // v8 ignore next -- a cancel response always names a batch run, so the keep-arm is defensive.
        return previous.map(run => cancelled.find(candidate => candidate.id === run.id) ?? run)
      })
    })
  }

  const onCreate = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText('/skill-create')
      setNotice(t('createSkillHint'))
    } catch {
      setNotice(t('createSkillCopyFailed'))
    }
  }

  const normalized = query.trim().toLocaleLowerCase()
  const matches = (skill: ManagedSkillSummaryView): boolean => {
    if (normalized.length === 0) return true
    const haystack = [skill.name, skill.description, skill.whenToUse ?? '']
      .map(value => value.toLocaleLowerCase())
    const detail = details.get(skill.name)
    if (detail !== undefined) haystack.push(detail.content.toLocaleLowerCase())
    return haystack.some(value => value.includes(normalized))
  }
  const mySkills = list === null ? [] : list.filter(skill => skill.scope !== 'built-in' && matches(skill))
  const builtIn = list === null ? [] : list.filter(skill => skill.scope === 'built-in' && matches(skill))
  const managedNames = list === null ? [] : list
    .filter(skill => skill.scope !== 'built-in')
    .map(skill => skill.name)
  const filteredCount = mySkills.length + builtIn.length
  const batchRunning = batchRuns !== null && batchRuns.some(run => run.status === 'running')
  const batchTotal = batchRuns?.length ?? 0
  const batchDone = batchRuns?.filter(run => run.status !== 'running').length ?? 0
  const batchCurrent = batchRuns?.find(run => run.status === 'running')?.skillName
  const batchCancelled = batchRuns !== null && batchRuns.some(run => run.status === 'cancelled')
  const batchVerdicts = (batchRuns ?? []).reduce((counts, run) => {
    const verdict = run.result?.summary.verdict
    if (verdict === 'improvement') counts.improved += 1
    else if (verdict === 'worse') counts.worse += 1
    else if (verdict === 'no-significant-improvement') counts.same += 1
    else if (run.status === 'failed') counts.failed += 1
    return counts
  }, { improved: 0, worse: 0, same: 0, failed: 0 })
  const batchSettled = batchRuns !== null && !batchRunning
  // v8 ignore next -- batchRunning implies a running run, so the current-skill fallback is defensive.
  const batchLine = batchRunning
    ? t('benchmarkAllProgress', { skill: batchCurrent ?? '', done: batchDone, total: batchTotal })
    : batchSettled
      ? batchCancelled
        ? t('benchmarkAllCancelled')
        : t('benchmarkAllDone', batchVerdicts)
      : null

  return (
    <div className={css.section}>
      <h2 className={css.heading}>{t('title')}</h2>
      <p className={css.intro}>{t('intro')}</p>
      <div className={css.toolbar}>
        <button type="button" className={css.createButton} onClick={() => { void onCreate() }}>
          {t('createSkill')}
        </button>
        <label className={css.search}>
          <IconSearchOutline16 aria-hidden="true" />
          <input
            type="search"
            value={query}
            placeholder={t('searchPlaceholder')}
            aria-label={t('search')}
            onChange={(event) => { setQuery(event.currentTarget.value) }}
          />
        </label>
      </div>
      {models !== null ? (
        <div className={css.batchBar}>
          <BenchmarkModelControls
            groups={models}
            task={batchTask}
            evaluator={batchEvaluator}
            useSameModel={batchUseSame}
            caseCount={batchCases}
            taskLabel={t('benchmarkAllTaskModel')}
            evaluatorLabel={t('benchmarkAllEvaluatorModel')}
            sameModelLabel={t('benchmarkAllUseSameModel')}
            caseCountLabel={t('benchmarkAllCaseCount')}
            disabled={batchRunning}
            onTaskChange={setBatchTask}
            onEvaluatorChange={setBatchEvaluator}
            onUseSameModelChange={setBatchUseSame}
            onCaseCountChange={setBatchCases}
          />
          <div className={css.batchActions}>
            <button
              type="button"
              className={css.buttonPrimary}
              disabled={batchRunning || managedNames.length === 0
                || batchTask.provider === '' || batchTask.model === ''}
              title={managedNames.length === 0 ? t('benchmarkAllEmpty') : undefined}
              onClick={runAllBenchmarks}
            >
              {t('benchmarkAll')}
            </button>
            {batchRunning
              ? (
                <button type="button" className={css.buttonSecondary} onClick={cancelBatch}>
                  {t('benchmarkCancel')}
                </button>
              )
              : null}
          </div>
        </div>
      ) : null}
      {batchLine !== null ? <p className={css.progress} role="status">{batchLine}</p> : null}
      {notice !== null ? <p className={css.notice} role="status">{notice}</p> : null}
      {actionError !== null ? <p className={css.failure} role="alert">{actionError}</p> : null}
      {loadFailed ? (
        <div className={css.failure}>
          <p role="alert">{t('error')}</p>
          <button type="button" className={css.buttonSecondary} onClick={retry}>{t('retry')}</button>
        </div>
      ) : list === null ? <p className={css.empty}>{t('loading')}</p> : (
        <>
          {list.length === 0 ? <p className={css.empty}>{t('emptySkills')}</p> : null}
          {list.length > 0 && filteredCount === 0 ? <p className={css.empty}>{t('emptySearch')}</p> : null}
          {mySkills.length > 0 ? (
            <section className={css.group} aria-label={t('mySkills')}>
              <h3 className={css.groupTitle}>{t('mySkills')}</h3>
              <ul className={css.cards}>
                {mySkills.map(skill => (
                  <SkillCard
                    key={skill.name}
                    skill={skill}
                    locale={locale}
                    open={expanded === skill.name}
                    busy={busyName !== null}
                    t={t}
                    onToggle={() => { setExpanded(current => current === skill.name ? null : skill.name) }}
                    onView={() => { openView(skill) }}
                    onEdit={() => { openEdit(skill) }}
                    onDelete={() => { deleteSkill(skill) }}
                    onToggleEnabled={() => { toggleEnabled(skill) }}
                    onVersions={() => { openVersions(skill) }}
                    onBenchmark={() => { openBenchmark(skill) }}
                  />
                ))}
              </ul>
            </section>
          ) : null}
          {builtIn.length > 0 ? (
            <section className={css.group} aria-label={t('builtIn')}>
              <h3 className={css.groupTitle}>{t('builtIn')}</h3>
              <ul className={css.cards}>
                {builtIn.map(skill => (
                  <SkillCard
                    key={skill.name}
                    skill={skill}
                    locale={locale}
                    open={expanded === skill.name}
                    busy={busyName !== null}
                    t={t}
                    onToggle={() => { setExpanded(current => current === skill.name ? null : skill.name) }}
                    onView={() => { openView(skill) }}
                    /* v8 ignore start -- built-in cards are read-only: SkillCard renders no lifecycle action that fires these callbacks. */
                    onEdit={() => { openEdit(skill) }}
                    onDelete={() => { deleteSkill(skill) }}
                    onToggleEnabled={() => { toggleEnabled(skill) }}
                    onVersions={() => { openVersions(skill) }}
                    onBenchmark={() => { openBenchmark(skill) }}
                    /* v8 ignore stop */
                  />
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}
      <TrashSection
        entries={trash ?? []}
        t={t}
        busyName={busyName}
        onRestore={(name) => {
          void runAction(`restore:${name}`, async () => {
            await actions.restore(sessionId, name)
            await refresh()
          })
        }}
        onDeletePermanently={(name) => {
          void runAction(`permanent:${name}`, async () => {
            await actions.permanentDelete(sessionId, name)
            await refresh()
          })
        }}
      />
      {viewing !== null ? (
        <SkillViewDialog skill={viewing} t={t} onClose={() => { setViewing(null) }} />
      ) : null}
      {editing !== null ? (
        <SkillEditDialog
          skill={editing}
          t={t}
          validate={content => actions.validate(content)}
          securityCheck={content => actions.securityCheck(content)}
          save={saveSkill}
          onSaved={() => { void onSaved(editing.name) }}
          onClose={() => { setEditing(null) }}
        />
      ) : null}
      {versionsOf !== null ? (
        <SkillVersionsDialog
          name={versionsOf.name}
          versions={versionsOf.versions}
          activeVersion={versionsOf.activeVersion}
          locale={locale}
          t={t}
          activating={busyName === `activate:${versionsOf.name}`}
          rolling={busyName === `rollback:${versionsOf.name}`}
          onActivate={activateTo}
          onRollback={rollbackTo}
          onClose={() => { setVersionsOf(null) }}
        />
      ) : null}
      {benchmarkOf !== null ? (
        <SkillBenchmarkDialog
          name={benchmarkOf}
          models={models ?? []}
          run={benchmarkRun}
          locale={locale}
          t={t}
          initial={{
            taskModel: batchTask,
            ...(batchUseSame ? {} : { evaluatorModel: batchEvaluator }),
            caseCount: Number(batchCases),
          }}
          onStart={startBenchmark}
          onCancel={cancelBenchmark}
          onClose={() => { setBenchmarkOf(null); setBenchmarkRun(null) }}
        />
      ) : null}
    </div>
  )
}

/**
 * Render the Skills Manager section.
 * @param props - composed slot props plus the injected actions.
 * @returns the section element tree.
 */
export function SkillsSettingsSection(props: SkillsSettingsSectionProps) {
  const { t } = props
  const sessionId = props.useSessions(snapshot => snapshot.current)
  return (
    <div className={css.section}>
      <h2 className={css.heading}>{t('title')}</h2>
      <p className={css.intro}>{t('intro')}</p>
      {sessionId === undefined
        ? <p className={css.empty}>{t('noSession')}</p>
        : <SkillsSectionBody {...props} sessionId={sessionId} />}
    </div>
  )
}
