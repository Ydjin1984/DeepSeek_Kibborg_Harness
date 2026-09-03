/**
 * Skill lifecycle manager: filesystem CRUD, trash, version history, rollback,
 * enable/disable, validation, and security classification for locally managed
 * skills. All storage operations run on the host through Node filesystem I/O
 * against the same roots the `dsh-skill-filesystem` provider discovers, so a
 * managed skill is immediately visible to discovery and `skill(name)`.
 * @module @deepseek-ai/dsh-skill-manager/manager
 */

import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { Service } from '@deepseek-ai/cordis'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { isSkillName, type SkillDefinition, type SkillInvocationPolicy, type SkillSource } from '@deepseek-ai/dsh-skill'
import { findProjectRoot, parseSkillSource, type ParsedSkill } from '@deepseek-ai/dsh-skill-filesystem'
import { runAutoImprove, runBenchmark } from './benchmark.ts'
import { securityCheck } from './security.ts'
import type {
  AutoImproveRequest,
  AutoImproveRun,
  BenchmarkBatchInput,
  BenchmarkRequest,
  BenchmarkRun,
  BenchmarkSummary,
  ManagedInvocation,
  ManagedSkill,
  ManagedSkillSummary,
  ModelRoute,
  SaveSkillInput,
  SaveSkillResult,
  SecurityVerdict,
  SkillScope,
  SkillStatus,
  SkillVersion,
  ValidationResult,
  VersionSource,
} from './types.ts'

export const SKILL_MANAGER_META_FILE = 'SKILL.manager.json'
export const SKILL_DISABLED_MARKER = '.disabled'
export const SKILL_TRASH_DIR = '.system/trash'

/** Stable error codes raised by the skill manager. */
export type SkillManagerErrorCode =
  | 'skill-invalid'
  | 'skill-conflict'
  | 'skill-not-found'
  | 'skill-blocked'
  | 'skill-builtin-protected'
  | 'skill-not-managed'
  | 'skill-in-trash'
  | 'version-not-found'
  | 'benchmark-not-found'

/** Typed skill manager failure carrying a stable machine-routable code. */
export class SkillManagerError extends Error {
  readonly code: SkillManagerErrorCode

  constructor(code: SkillManagerErrorCode, message: string) {
    super(message)
    this.name = 'SkillManagerError'
    this.code = code
  }
}

/** On-disk version record inside `SKILL.manager.json`. */
interface StoredVersion {
  readonly id: string
  readonly createdAt: string
  readonly reason: string
  readonly source: VersionSource
}

/** On-disk manager metadata file shape. */
interface SkillMetaFile {
  readonly schemaVersion: 1
  readonly createdAt: string
  readonly updatedAt: string
  readonly activeVersion: string
  readonly versions: StoredVersion[]
  readonly benchmarks: Record<string, BenchmarkSummary>
}

/** One discovered local skill entry on disk. */
interface LocalSkillEntry {
  readonly name: string
  readonly description: string
  readonly localizedDescription?: ParsedSkill['localizedDescription']
  readonly whenToUse?: string
  readonly invocation: SkillInvocationPolicy
  readonly metadata?: Record<string, unknown>
  readonly content: string
  readonly scope: SkillScope
  readonly source: SkillSource
  readonly directory: string
  readonly path: string
  readonly enabled: boolean
}

/** One managed storage root by scope. */
export interface SkillRootInfo {
  readonly scope: SkillScope
  readonly path: string
  readonly source: SkillSource
}

/** Skill manager configuration. */
export interface SkillManagerConfig {
  /** DeepSeek Harness config root; defaults to `$DSH_HOME` or `~/.dsh`. */
  dshHome?: string
  /** Shared agent config root; defaults to `$DSH_AGENTS_HOME` or `~/.agents`. */
  agentsHome?: string
}

interface RegistrySkill {
  name: string
  description: string
  localizedDescription?: SkillDefinition['localizedDescription']
  whenToUse?: string
  invocation: SkillInvocationPolicy
  source: SkillSource
}

/**
 * Owns the managed skill lifecycle. This service reads and writes local skill
 * files directly; the `ctx.skills` registry remains the read surface for
 * invocation, and the filesystem provider's watcher invalidates its catalog on
 * the mutations this service performs.
 */
export class SkillManager extends Service {
  static inject = ['skills']

  private readonly dshHome: string

  constructor(ctx: Context, config: SkillManagerConfig = {}) {
    super(ctx, 'skillManager')
    this.dshHome = resolveDshHome(config.dshHome)
  }

  /**
   * Resolve the managed roots for a workspace, in provider priority order.
   * @param cwd - workspace directory.
   * @returns the three managed roots with their scope labels.
   */
  async roots(cwd: string): Promise<SkillRootInfo[]> {
    const projectRoot = await findProjectRoot(cwd, undefined)
    return [
      { scope: 'project', path: join(projectRoot, '.dsh/skills'), source: 'project-dsh' },
      { scope: 'agents', path: join(projectRoot, '.agents/skills'), source: 'project-agents' },
      { scope: 'user', path: join(this.dshHome, 'skills'), source: 'user-dsh' },
    ]
  }

  /**
   * List the full managed catalog: local filesystem skills from every root
   * plus built-in registry contributions that have no managed file.
   * @param cwd - workspace directory.
   * @returns managed summaries in name order.
   */
  async list(cwd: string): Promise<ManagedSkillSummary[]> {
    const roots = await this.roots(cwd)
    const summaries: ManagedSkillSummary[] = []
    const seen = new Set<string>()
    for (const root of roots) {
      for (const entry of await this.discoverRoot(root)) {
        seen.add(entry.name)
        summaries.push(await this.toSummary(entry))
      }
    }
    const builtins = await this.builtins(cwd)
    for (const builtin of builtins) {
      // v8 ignore next -- builtins() already excludes names owned by managed files.
      if (seen.has(builtin.name)) continue
      summaries.push({
        name: builtin.name,
        description: builtin.description,
        /* v8 ignore next -- runtime registry summaries do not carry localized descriptions. */
        ...builtin.localizedDescription !== undefined ? { localizedDescription: builtin.localizedDescription } : {},
        ...builtin.whenToUse !== undefined ? { whenToUse: builtin.whenToUse } : {},
        invocation: toManagedInvocation(builtin.invocation),
        scope: 'built-in',
        source: builtin.source,
        enabled: true,
        status: 'enabled',
        version: '-',
        versionsCount: 0,
      })
    }
    return summaries.sort((a, b) => compareCodePoints(a.name, b.name))
  }

  /**
   * Read one managed skill with its full body and version history.
   * @param name - kebab-case skill name.
   * @param cwd - workspace directory.
   * @returns the full managed skill, or `undefined` when absent.
   */
  async read(name: string, cwd: string): Promise<ManagedSkill | undefined> {
    const entry = await this.findLocal(name, cwd)
    if (entry !== undefined) {
      const summary = await this.toSummary(entry)
      const meta = await this.readMeta(entry.directory)
      const versions = meta === undefined ? [] : this.versionsFromMeta(meta)
      return {
        ...summary,
        content: entry.content,
        versions,
        ...entry.metadata !== undefined ? { metadata: entry.metadata } : {},
      }
    }
    const builtin = (await this.builtins(cwd)).find(skill => skill.name === name)
    if (builtin === undefined) return undefined
    const definition = await this.ctx.skills.get(name, { cwd })
    /* v8 ignore next -- a listed built-in can vanish between list and load only through a concurrent change. */
    if (definition === undefined) return undefined
    return {
      name: builtin.name,
      description: builtin.description,
      /* v8 ignore next -- runtime registry summaries do not carry localized descriptions. */
      ...builtin.localizedDescription !== undefined ? { localizedDescription: builtin.localizedDescription } : {},
      ...builtin.whenToUse !== undefined ? { whenToUse: builtin.whenToUse } : {},
      invocation: toManagedInvocation(builtin.invocation),
      scope: 'built-in',
      source: builtin.source,
      enabled: true,
      status: 'enabled',
      version: '-',
      versionsCount: 0,
      content: definition.content,
      versions: [],
    }
  }

  /**
   * Validate raw SKILL.md content with the shared filesystem parser.
   * @param content - complete SKILL.md text.
   * @returns ok, or the exact reason the shared parser rejects it.
   */
  validate(content: string): ValidationResult {
    const result = parseSkillSource(content)
    if (result.ok) return { ok: true }
    return { ok: false, reason: result.reason }
  }

  /**
   * Run the static security validator over raw SKILL.md content.
   * @param content - complete SKILL.md text.
   * @returns the security verdict and findings.
   */
  securityCheck(content: string): SecurityVerdict {
    return securityCheck(content)
  }

  /**
   * Create or update one skill. Creation rejects an existing same-name skill
   * unless `replace` is set; updates snapshot the previous active body as a
   * version before publishing the new one. A `blocked` security verdict
   * rejects the save unless `force` is set.
   * @param input - validated save request.
   * @returns the published path, version, and security verdict.
   */
  async save(input: SaveSkillInput): Promise<SaveSkillResult> {
    const name = input.name.trim()
    if (!isSkillName(name)) throw new SkillManagerError('skill-invalid', `invalid skill name "${name}"`)
    const content = input.content.trim()
    if (content.length === 0) throw new SkillManagerError('skill-invalid', 'skill content is empty')
    const parsed = parseSkillSource(content)
    if (!parsed.ok) throw new SkillManagerError('skill-invalid', parsed.reason)
    // The published body's frontmatter name must match the managed name:
    // renaming through the body would silently desync the on-disk path, the
    // catalog, and future remove/restore calls (delete and recreate is the
    // supported rename path).
    if (parsed.skill.name !== name) {
      throw new SkillManagerError(
        'skill-invalid',
        `frontmatter name "${parsed.skill.name}" does not match skill name "${name}" — renaming is not supported; delete and recreate instead`,
      )
    }
    const verdict = securityCheck(content)
    if (verdict.status === 'blocked' && input.force !== true) {
      throw new SkillManagerError('skill-blocked', securityBlockedMessage(verdict))
    }
    const root = await this.rootFor(input.scope, input.cwd)
    const directory = join(root.path, name)
    const path = join(directory, 'SKILL.md')
    const existing = await pathExists(path)
    if (existing && input.replace !== true) {
      // Creation conflicts with an existing occupant; the caller must
      // explicitly replace (conflict resolution) — never a silent overwrite.
      throw new SkillManagerError('skill-conflict', `skill "${name}" already exists in ${input.scope} scope`)
    }
    const existingMeta = await this.readMeta(directory)
    const now = new Date().toISOString()
    const created = !existing
    const version = existing && existingMeta !== undefined ? nextVersionId(existingMeta) : 'v1'
    const meta: SkillMetaFile = existingMeta ?? freshMeta(version)
    await mkdir(join(directory, '.versions', version), { recursive: true })
    await writeFile(join(directory, '.versions', version, 'SKILL.md'), `${content}\n`, 'utf8')
    await mkdir(directory, { recursive: true })
    await writeFile(path, `${content}\n`, 'utf8')
    const updated: SkillMetaFile = {
      ...meta,
      activeVersion: version,
      updatedAt: now,
      versions: existing
        ? [...meta.versions, { id: version, createdAt: now, reason: input.reason ?? 'Updated', source: input.source ?? 'manual' }]
        : meta.versions,
    }
    await this.writeMeta(directory, updated)
    return {
      name,
      scope: input.scope,
      path,
      created,
      version,
      security: verdict,
    }
  }

  /**
   * Move one managed skill into the trash instead of deleting it.
   * @param name - skill name.
   * @param cwd - workspace directory.
   */
  async remove(name: string, cwd: string): Promise<void> {
    const entry = await this.findLocal(name, cwd)
    if (entry === undefined) {
      if (await this.inTrash(name, cwd)) {
        throw new SkillManagerError('skill-in-trash', `skill "${name}" is already in the trash`)
      }
      const builtin = (await this.builtins(cwd)).some(skill => skill.name === name)
      if (builtin) throw new SkillManagerError('skill-builtin-protected', `built-in skill "${name}" cannot be deleted`)
      throw new SkillManagerError('skill-not-found', `skill "${name}" is not managed`)
    }
    const root = await this.rootFor(entry.scope, cwd)
    const trashRoot = join(root.path, SKILL_TRASH_DIR)
    await mkdir(trashRoot, { recursive: true })
    // A flat `*.md` skill lives directly in the skills root, so its directory
    // is the root itself; only the file (under its on-disk name) may move to
    // the trash, never the whole root — that would drag every sibling away.
    const flatMarkdown = entry.directory === root.path
    const onDiskName = flatMarkdown ? basename(entry.path) : entry.name
    let target = join(trashRoot, onDiskName)
    if (await pathExists(target)) {
      target = join(trashRoot, flatMarkdown
        ? `${onDiskName.slice(0, -3)}-${Date.now()}.md`
        : `${onDiskName}-${Date.now()}`)
    }
    await rename(flatMarkdown ? entry.path : entry.directory, target)
  }

  /**
   * Restore one trashed skill back to its original scope path.
   * @param name - skill name.
   * @param cwd - workspace directory.
   */
  async restore(name: string, cwd: string): Promise<void> {
    const trash = await this.trashEntries(cwd)
    const entry = trash.find(item => item.name === name)
    if (entry === undefined) throw new SkillManagerError('skill-not-found', `trashed skill "${name}" not found`)
    const root = await this.rootFor(entry.scope, cwd)
    // A flat markdown file is restored under its original on-disk name (with
    // `.md`); directory skills restore under their public name.
    const target = entry.path.endsWith('.md')
      ? join(root.path, basename(entry.path))
      : join(root.path, entry.name)
    if (await pathExists(target)) {
      throw new SkillManagerError('skill-conflict', `skill "${name}" already exists in ${entry.scope} scope`)
    }
    await rename(entry.path, target)
  }

  /**
   * Permanently delete one trashed skill.
   * @param name - skill name.
   * @param cwd - workspace directory.
   */
  async permanentDelete(name: string, cwd: string): Promise<void> {
    const trash = await this.trashEntries(cwd)
    const entry = trash.find(item => item.name === name)
    if (entry === undefined) throw new SkillManagerError('skill-not-found', `trashed skill "${name}" not found`)
    await rm(entry.path, { recursive: true, force: true })
  }

  /**
   * List trashed skills with their original scope and current trash path.
   * @param cwd - workspace directory.
   * @returns trashed skill entries.
   */
  async trash(cwd: string): Promise<Array<{ name: string; scope: SkillScope; path: string }>> {
    return (await this.trashEntries(cwd)).map(entry => ({ name: entry.name, scope: entry.scope, path: entry.path }))
  }

  /**
   * Enable or disable one managed skill. Disabling writes the `.disabled`
   * marker that the filesystem provider honors; enabling removes it. Neither
   * touches the skill body or its invocation frontmatter.
   * @param name - skill name.
   * @param enabled - desired state.
   * @param cwd - workspace directory.
   */
  async setEnabled(name: string, enabled: boolean, cwd: string): Promise<void> {
    const entry = await this.findLocal(name, cwd)
    if (entry === undefined) {
      const builtin = (await this.builtins(cwd)).some(skill => skill.name === name)
      if (builtin) throw new SkillManagerError('skill-builtin-protected', `built-in skill "${name}" cannot be disabled`)
      throw new SkillManagerError('skill-not-found', `skill "${name}" is not managed`)
    }
    const marker = join(entry.directory, SKILL_DISABLED_MARKER)
    if (enabled) {
      await rm(marker, { force: true })
    } else {
      await writeFile(marker, '', 'utf8')
    }
  }

  /**
   * List the version history of one managed skill, newest first.
   * @param name - skill name.
   * @param cwd - workspace directory.
   * @returns version records with per-version benchmark summaries.
   */
  async versions(name: string, cwd: string): Promise<SkillVersion[]> {
    const entry = await this.findLocal(name, cwd)
    if (entry === undefined) {
      const builtin = (await this.builtins(cwd)).some(skill => skill.name === name)
      if (builtin) throw new SkillManagerError('skill-builtin-protected', `built-in skill "${name}" has no version history`)
      throw new SkillManagerError('skill-not-found', `skill "${name}" is not managed`)
    }
    const meta = await this.readMeta(entry.directory)
    if (meta === undefined) return []
    return this.versionsFromMeta(meta)
  }

  /**
   * Roll back one managed skill to an earlier version. Rollback publishes a
   * new version whose body is the target version's body, so history is never
   * destroyed.
   * @param name - skill name.
   * @param targetVersion - version id to restore (`v1`, `v2`, …).
   * @param cwd - workspace directory.
   * @param reason - optional rollback reason recorded in the new version event.
   * @returns the new active version id.
   */
  async rollback(name: string, targetVersion: string, cwd: string, reason?: string): Promise<string> {
    const entry = await this.findLocal(name, cwd)
    if (entry === undefined) throw new SkillManagerError('skill-not-found', `skill "${name}" is not managed`)
    const meta = await this.readMeta(entry.directory)
    if (meta === undefined) throw new SkillManagerError('version-not-found', `skill "${name}" has no version history`)
    const target = meta.versions.find(version => version.id === targetVersion)
    if (target === undefined) throw new SkillManagerError('version-not-found', `version "${targetVersion}" not found for skill "${name}"`)
    const body = await this.readVersionBody(entry, meta, targetVersion)
    const nextVersion = nextVersionId(meta)
    await mkdir(join(entry.directory, '.versions', nextVersion), { recursive: true })
    await writeFile(join(entry.directory, '.versions', nextVersion, 'SKILL.md'), `${body}\n`, 'utf8')
    await writeFile(entry.path, `${body}\n`, 'utf8')
    const updated: SkillMetaFile = {
      ...meta,
      activeVersion: nextVersion,
      updatedAt: new Date().toISOString(),
      versions: [...meta.versions, {
        id: nextVersion,
        createdAt: new Date().toISOString(),
        reason: reason ?? `Rollback to ${targetVersion}`,
        source: 'rollback',
      }],
    }
    await this.writeMeta(entry.directory, updated)
    return nextVersion
  }

  /**
   * Attach a completed benchmark summary to the skill version it tested.
   * @param name - skill name.
   * @param cwd - workspace directory.
   * @param version - tested version id.
   * @param summary - benchmark outcome to persist.
   */
  async attachBenchmark(name: string, cwd: string, version: string, summary: BenchmarkSummary): Promise<void> {
    const entry = await this.findLocal(name, cwd)
    if (entry === undefined) throw new SkillManagerError('skill-not-found', `skill "${name}" is not managed`)
    const meta = await this.readMeta(entry.directory) ?? freshMeta('v1')
    const updated: SkillMetaFile = {
      ...meta,
      updatedAt: new Date().toISOString(),
      benchmarks: { ...meta.benchmarks, [version]: summary },
    }
    await this.writeMeta(entry.directory, updated)
  }

  /**
   * Publish a new version without activating it. Used by Auto Improve to test
   * candidates before deciding which version becomes active.
   * @param input - save request; the security verdict blocks publication unless `force`.
   * @returns the published version id.
   */
  async publishVersion(input: SaveSkillInput): Promise<string> {
    const name = input.name.trim()
    const content = input.content.trim()
    const parsed = parseSkillSource(content)
    if (!parsed.ok) throw new SkillManagerError('skill-invalid', parsed.reason)
    // Same frontmatter-name guard as save: a candidate body must keep the name
    // it is published under.
    if (parsed.skill.name !== name) {
      throw new SkillManagerError(
        'skill-invalid',
        `frontmatter name "${parsed.skill.name}" does not match skill name "${name}" — renaming is not supported; delete and recreate instead`,
      )
    }
    const verdict = securityCheck(content)
    if (verdict.status === 'blocked' && input.force !== true) {
      throw new SkillManagerError('skill-blocked', securityBlockedMessage(verdict))
    }
    const entry = await this.findLocal(name, input.cwd)
    if (entry === undefined) throw new SkillManagerError('skill-not-found', `skill "${name}" is not managed`)
    const meta = await this.readMeta(entry.directory) ?? freshMeta('v1')
    const version = nextVersionId(meta)
    await mkdir(join(entry.directory, '.versions', version), { recursive: true })
    await writeFile(join(entry.directory, '.versions', version, 'SKILL.md'), `${content}\n`, 'utf8')
    const updated: SkillMetaFile = {
      ...meta,
      updatedAt: new Date().toISOString(),
      versions: [...meta.versions, {
        id: version,
        createdAt: new Date().toISOString(),
        reason: input.reason ?? 'Version',
        source: input.source ?? 'auto-improve',
      }],
    }
    await this.writeMeta(entry.directory, updated)
    return version
  }

  /**
   * Make an existing version the active one by restoring its body into
   * SKILL.md. Unlike rollback, activation does not create a new version event —
   * it selects among already-published versions (the benchmark best-version
   * rule).
   * @param name - skill name.
   * @param version - version id to activate.
   * @param cwd - workspace directory.
   * @returns the activated version id.
   */
  async activateVersion(name: string, version: string, cwd: string): Promise<string> {
    const entry = await this.findLocal(name, cwd)
    if (entry === undefined) throw new SkillManagerError('skill-not-found', `skill "${name}" is not managed`)
    const meta = await this.readMeta(entry.directory)
    if (meta === undefined) throw new SkillManagerError('version-not-found', `skill "${name}" has no version history`)
    if (!meta.versions.some(candidate => candidate.id === version)) {
      throw new SkillManagerError('version-not-found', `version "${version}" not found for skill "${name}"`)
    }
    const body = await this.readVersionBody(entry, meta, version)
    await writeFile(entry.path, `${body}\n`, 'utf8')
    const updated: SkillMetaFile = {
      ...meta,
      activeVersion: version,
      updatedAt: new Date().toISOString(),
    }
    await this.writeMeta(entry.directory, updated)
    return version
  }

  /** Read a version's body from its version snapshot (or the active file for the active version). */
  private async readVersionBody(entry: LocalSkillEntry, meta: SkillMetaFile, version: string): Promise<string> {
    const body = version === meta.activeVersion
      ? await readText(entry.path)
      : await readText(join(entry.directory, '.versions', version, 'SKILL.md'))
    /* v8 ignore next -- a version snapshot is written by the manager; absence means external corruption. */
    if (body === undefined) throw new SkillManagerError('version-not-found', `version "${version}" body is missing for skill "${entry.name}"`)
    return body
  }

  /** Read the persisted benchmark for a version, if any. */
  async benchmarkFor(name: string, cwd: string, version: string): Promise<BenchmarkSummary | undefined> {
    const entry = await this.findLocal(name, cwd)
    if (entry === undefined) return undefined
    const meta = await this.readMeta(entry.directory)
    return meta?.benchmarks[version]
  }

  /** Resolve the active model route snapshot: provider and model pair required. */
  assertRoute(route: ModelRoute): ModelRoute {
    if (typeof route.provider !== 'string' || route.provider.length === 0
      || typeof route.model !== 'string' || route.model.length === 0) {
      throw new SkillManagerError('skill-invalid', 'model route requires non-empty provider and model')
    }
    return route
  }

  /** Snapshot of one run identity for the benchmark engine. */
  newRunId(): string {
    return `bench-${randomUUID()}`
  }

  private readonly benchmarkRuns = new Map<string, BenchmarkRun>()
  private readonly benchmarkControllers = new Map<string, AbortController>()

  /**
   * Start a sequential batch of benchmarks, one run per skill, in the
   * background. Runs advance one at a time in the given order so the task
   * model is never load-balanced across concurrent suites; a failing skill
   * is recorded on its own run and the batch continues with the next name.
   * Cancelling any run of the batch aborts the whole batch: the current run
   * settles as `cancelled` and every not-yet-started run is marked cancelled.
   * @param input - shared batch settings (models and workspace).
   * @param names - skill names to benchmark, in run order.
   * @returns the immediate run views, one per name.
   */
  startBenchmarkBatch(input: BenchmarkBatchInput, names: readonly string[]): BenchmarkRun[] {
    const controller = new AbortController()
    const runs: BenchmarkRun[] = names.map(name => ({
      id: this.newRunId(),
      skillName: name,
      status: 'running',
      phase: 'preparing',
      progress: { case: 0, total: 0 },
      createdAt: Date.now(),
    }))
    for (const run of runs) {
      this.benchmarkRuns.set(run.id, run)
      this.benchmarkControllers.set(run.id, controller)
    }
    void this.runBenchmarkBatch(input, names, runs, controller).finally(() => {
      for (const run of runs) this.benchmarkControllers.delete(run.id)
    })
    return runs
  }

  /** Drive one sequential batch to completion, recording each run as it settles. */
  private async runBenchmarkBatch(
    input: BenchmarkBatchInput,
    names: readonly string[],
    runs: readonly BenchmarkRun[],
    controller: AbortController,
  ): Promise<void> {
    for (let index = 0; index < names.length; index += 1) {
      const name = names[index]
      const run = runs[index]
      // v8 ignore next -- names and runs are built from the same list, so the index is always in range.
      if (run === undefined || name === undefined) continue
      if (controller.signal.aborted) {
        this.updateBenchmarkRun(run.id, { ...run, status: 'cancelled' })
        continue
      }
      try {
        const result = await runBenchmark(this.ctx, this, {
          skillName: name,
          cwd: input.cwd,
          taskModel: input.taskModel,
          ...input.evaluatorModel !== undefined ? { evaluatorModel: input.evaluatorModel } : {},
          ...input.caseCount !== undefined ? { caseCount: input.caseCount } : {},
        }, (next) => { this.updateBenchmarkRun(run.id, { ...run, ...next, skillName: name }) }, controller.signal)
        this.updateBenchmarkRun(run.id, { ...run, status: 'completed', phase: 'done', result, skillName: name })
      } catch (error: unknown) {
        // oxlint-disable-next-line typescript/no-unnecessary-condition -- external cancelBenchmark aborts can land here.
        const status = controller.signal.aborted ? 'cancelled' : 'failed'
        this.updateBenchmarkRun(run.id, { ...run, status, error: String(error), skillName: name })
      }
    }
  }

  /**
   * Start one benchmark in the background and return its live run view. Poll
   * with {@link pollBenchmark}; cancel with {@link cancelBenchmark}.
   * @param request - validated benchmark request.
   * @returns the immediately-visible running run.
   */
  startBenchmark(request: BenchmarkRequest): BenchmarkRun {
    const controller = new AbortController()
    const run: BenchmarkRun = {
      id: this.newRunId(),
      skillName: request.skillName,
      status: 'running',
      phase: 'preparing',
      progress: { case: 0, total: 0 },
      createdAt: Date.now(),
    }
    this.benchmarkRuns.set(run.id, run)
    this.benchmarkControllers.set(run.id, controller)
    void runBenchmark(this.ctx, this, request, (next) => { this.updateBenchmarkRun(run.id, next) }, controller.signal).then(
      (result) => {
        this.updateBenchmarkRun(run.id, { ...run, status: 'completed', phase: 'done', result })
      },
      (error: unknown) => {
        const status = controller.signal.aborted ? 'cancelled' : 'failed'
        this.updateBenchmarkRun(run.id, { ...run, status, error: String(error) })
      },
    ).finally(() => {
      this.benchmarkControllers.delete(run.id)
    })
    return run
  }

  /**
   * Start an Auto Improve loop in the background.
   * @param request - auto-improve request with iteration limits.
   * @returns the immediately-visible running run.
   */
  startAutoImprove(request: AutoImproveRequest): AutoImproveRun {
    const controller = new AbortController()
    const run: AutoImproveRun = {
      id: this.newRunId(),
      skillName: request.skillName,
      status: 'running',
      phase: 'preparing',
      progress: { case: 0, total: 0 },
      createdAt: Date.now(),
      iterations: [],
      bestVersion: '',
    }
    this.benchmarkRuns.set(run.id, run)
    this.benchmarkControllers.set(run.id, controller)
    void runAutoImprove(this.ctx, this, request, (next) => { this.updateBenchmarkRun(run.id, next) }, controller.signal).then(
      (result) => {
        this.updateBenchmarkRun(run.id, { ...run, ...result, status: 'completed', phase: 'done' })
      },
      (error: unknown) => {
        const status = controller.signal.aborted ? 'cancelled' : 'failed'
        this.updateBenchmarkRun(run.id, { ...run, status, error: String(error) })
      },
    ).finally(() => {
      this.benchmarkControllers.delete(run.id)
    })
    return run
  }

  /**
   * Read the current view of one benchmark or Auto Improve run.
   * @param runId - run id from a start call.
   * @returns the live run view, or `undefined` when unknown.
   */
  pollBenchmark(runId: string): BenchmarkRun | undefined {
    return this.benchmarkRuns.get(runId)
  }

  /**
   * Cancel one running benchmark or Auto Improve run. The run settles as
   * `cancelled`; a completed best version is never rolled back by cancellation.
   * @param runId - run id from a start call.
   * @returns the cancelled view, or `undefined` when unknown.
   */
  cancelBenchmark(runId: string): BenchmarkRun | undefined {
    const run = this.benchmarkRuns.get(runId)
    if (run === undefined) return undefined
    if (run.status === 'running') {
      this.benchmarkControllers.get(runId)?.abort(new Error('benchmark cancelled by user'))
      const updated: BenchmarkRun = { ...run, status: 'cancelled' }
      this.benchmarkRuns.set(runId, updated)
      return updated
    }
    return run
  }

  private updateBenchmarkRun(runId: string, next: BenchmarkRun): void {
    const previous = this.benchmarkRuns.get(runId)
    /* v8 ignore next -- live progress always refers to a registered run. */
    if (previous === undefined) return
    this.benchmarkRuns.set(runId, { ...previous, ...next, id: runId })
  }

  private async discoverRoot(root: SkillRootInfo): Promise<LocalSkillEntry[]> {
    let entries
    try {
      entries = await readdir(root.path, { withFileTypes: true, encoding: 'utf8' })
    } catch {
      return []
    }
    const result: LocalSkillEntry[] = []
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name === '.system') continue
      const directory = entry.isDirectory()
        ? join(root.path, entry.name)
        : entry.isFile() && entry.name.endsWith('.md')
          ? root.path
          : undefined
      if (directory === undefined) continue
      const path = entry.isDirectory() ? join(directory, 'SKILL.md') : join(root.path, entry.name)
      const parsed = await this.parseFile(path)
      if (parsed === undefined) continue
      result.push({
        name: parsed.name,
        description: parsed.description,
        ...parsed.localizedDescription !== undefined ? { localizedDescription: parsed.localizedDescription } : {},
        ...parsed.whenToUse !== undefined ? { whenToUse: parsed.whenToUse } : {},
        invocation: parsed.invocation,
        ...parsed.metadata !== undefined ? { metadata: parsed.metadata } : {},
        content: parsed.content,
        scope: root.scope,
        source: root.source,
        directory,
        path,
        enabled: true,
      })
    }
    return result
  }

  private async parseFile(path: string): Promise<ParsedSkill | undefined> {
    let raw: string
    try {
      raw = await readFile(path, 'utf8')
    } catch {
      return undefined
    }
    const result = parseSkillSource(raw)
    return result.ok ? result.skill : undefined
  }

  private async findLocal(name: string, cwd: string): Promise<LocalSkillEntry | undefined> {
    for (const root of await this.roots(cwd)) {
      for (const entry of await this.discoverRoot(root)) {
        if (entry.name === name) return entry
      }
    }
    return undefined
  }

  private async rootFor(scope: SkillScope, cwd: string): Promise<SkillRootInfo> {
    const roots = await this.roots(cwd)
    const root = roots.find(candidate => candidate.scope === scope)
    /* v8 ignore next -- the SkillScope union is exactly the three managed roots. */
    if (root === undefined) throw new SkillManagerError('skill-invalid', `unknown scope "${scope}"`)
    return root
  }

  private async builtins(cwd: string): Promise<RegistrySkill[]> {
    const skills = await this.ctx.skills.list({ cwd })
    const managed = new Set<string>()
    for (const root of await this.roots(cwd)) {
      for (const entry of await this.discoverRoot(root)) managed.add(entry.name)
    }
    return skills.filter(skill => !managed.has(skill.name)).map(skill => ({
      name: skill.name,
      description: skill.description,
      /* v8 ignore next -- runtime registry summaries do not carry localized descriptions. */
      ...skill.localizedDescription !== undefined ? { localizedDescription: skill.localizedDescription } : {},
      ...skill.whenToUse !== undefined ? { whenToUse: skill.whenToUse } : {},
      invocation: skill.invocation,
      source: skill.source,
    }))
  }

  private async toSummary(entry: LocalSkillEntry): Promise<ManagedSkillSummary> {
    const meta = await this.readMeta(entry.directory)
    const activeVersion = meta?.activeVersion ?? 'v1'
    const versionsCount = meta?.versions.length ?? 1
    const benchmarks = meta?.benchmarks ?? {}
    const lastBenchmark = benchmarks[activeVersion]
    const verdict = securityCheck(entry.content)
    const enabled = !(await pathExists(join(entry.directory, SKILL_DISABLED_MARKER)))
    return {
      name: entry.name,
      description: entry.description,
      ...entry.localizedDescription !== undefined ? { localizedDescription: entry.localizedDescription } : {},
      ...entry.whenToUse !== undefined ? { whenToUse: entry.whenToUse } : {},
      invocation: toManagedInvocation(entry.invocation),
      scope: entry.scope,
      path: entry.path,
      source: entry.source,
      enabled,
      status: deriveStatus({ enabled, verdict, lastBenchmark, activeVersion, hasAnyBenchmark: Object.keys(benchmarks).length > 0 }),
      version: activeVersion,
      versionsCount,
      ...meta !== undefined ? { createdAt: meta.createdAt, updatedAt: meta.updatedAt } : {},
      ...lastBenchmark !== undefined ? { lastBenchmark } : {},
    }
  }

  private async readMeta(directory: string): Promise<SkillMetaFile | undefined> {
    try {
      const raw = await readFile(join(directory, SKILL_MANAGER_META_FILE), 'utf8')
      const parsed = JSON.parse(raw) as Partial<SkillMetaFile>
      if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.versions) || typeof parsed.activeVersion !== 'string') {
        return undefined
      }
      return parsed as SkillMetaFile
    } catch {
      return undefined
    }
  }

  private async writeMeta(directory: string, meta: SkillMetaFile): Promise<void> {
    await writeFile(join(directory, SKILL_MANAGER_META_FILE), `${JSON.stringify(meta, null, 2)}\n`, 'utf8')
  }

  private versionsFromMeta(meta: SkillMetaFile): SkillVersion[] {
    const versions: SkillVersion[] = []
    for (const version of [...meta.versions].reverse()) {
      versions.push({
        id: version.id,
        createdAt: version.createdAt,
        reason: version.reason,
        source: version.source,
        ...meta.benchmarks[version.id] !== undefined ? { benchmark: meta.benchmarks[version.id] } : {},
      })
    }
    return versions
  }

  private async inTrash(name: string, cwd: string): Promise<boolean> {
    return (await this.trashEntries(cwd)).some(entry => entry.name === name)
  }

  private async trashEntries(cwd: string): Promise<Array<{ name: string; scope: SkillScope; path: string }>> {
    const entries: Array<{ name: string; scope: SkillScope; path: string }> = []
    for (const root of await this.roots(cwd)) {
      const trashRoot = join(root.path, SKILL_TRASH_DIR)
      let names: string[]
      try {
        names = await readdir(trashRoot, { encoding: 'utf8' })
      } catch {
        continue
      }
      for (const name of names) {
        if (name.startsWith('.')) continue
        // A trashed flat markdown file is addressed by its public (frontmatter)
        // name without the `.md` suffix, matching remove/read/restore.
        const publicName = name.endsWith('.md') ? name.slice(0, -3) : name
        entries.push({ name: publicName, scope: root.scope, path: join(trashRoot, name) })
      }
    }
    return entries
  }
}

function freshMeta(activeVersion: string): SkillMetaFile {
  const now = new Date().toISOString()
  return {
    schemaVersion: 1,
    createdAt: now,
    updatedAt: now,
    activeVersion,
    versions: [{ id: activeVersion, createdAt: now, reason: 'Initial', source: 'initial' }],
    benchmarks: {},
  }
}

function nextVersionId(meta: SkillMetaFile | undefined): string {
  /* v8 ignore next -- every caller passes an initialized meta; creation addresses v1 directly. */
  const count = meta === undefined ? 0 : meta.versions.length
  return `v${count + 1}`
}

function deriveStatus(input: {
  enabled: boolean
  verdict: SecurityVerdict
  lastBenchmark: BenchmarkSummary | undefined
  activeVersion: string
  hasAnyBenchmark: boolean
}): SkillStatus {
  if (!input.enabled) return 'disabled'
  if (input.verdict.status === 'blocked') return 'blocked'
  if (input.verdict.status === 'warning') return 'warning'
  if (input.lastBenchmark !== undefined && input.lastBenchmark.version !== input.activeVersion) return 'benchmark-outdated'
  if (input.lastBenchmark === undefined && input.hasAnyBenchmark) return 'benchmark-outdated'
  if (input.lastBenchmark === undefined) return 'not-tested'
  return 'enabled'
}

function toManagedInvocation(invocation: SkillInvocationPolicy): ManagedInvocation {
  return { modelInvocable: invocation.modelInvocable, userInvocable: invocation.userInvocable }
}

function securityBlockedMessage(verdict: SecurityVerdict): string {
  const reasons = verdict.findings
    .filter(finding => finding.severity === 'blocked')
    .map(finding => finding.message)
  return `skill is blocked by security validation: ${reasons.join('; ')}`
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function readText(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    /* v8 ignore next -- readers only target files the manager wrote; absence means external corruption. */
    return undefined
  }
}

function compareCodePoints(left: string, right: string): number {
  // v8 ignore start -- the comparator's ordered arms are exercised by the catalog sort test.
  if (left < right) return -1
  if (left > right) return 1
  // v8 ignore stop
  /* v8 ignore next -- managed catalogs deduplicate names, so equal code points never sort. */
  return 0
}
