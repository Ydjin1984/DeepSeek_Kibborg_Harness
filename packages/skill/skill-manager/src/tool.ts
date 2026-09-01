/**
 * Model-facing `skill_manage` tool: the programming surface the Skill Creator
 * model uses for every skill operation — validation, security checks, saving,
 * lifecycle, version history, and benchmark control. One tool with an action
 * discriminator keeps the creator's tool catalog compact.
 * @module @deepseek-ai/dsh-skill-manager/tool
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool, type JsonValue } from '@deepseek-ai/dsh-tools'
import { SkillManagerError } from './manager.ts'
import type { SkillManager } from './manager.ts'
import type { BenchmarkRun, ModelRoute, SkillScope } from './types.ts'

const ACTIONS = [
  'validate',
  'security-check',
  'list',
  'read',
  'save',
  'remove',
  'restore',
  'delete',
  'set-enabled',
  'versions',
  'rollback',
  'benchmark-start',
  'benchmark-poll',
  'benchmark-cancel',
  'auto-improve',
] as const

type Action = (typeof ACTIONS)[number]

/** One model route rendered as `provider/model`. */
function parseRoute(
  value: string | undefined,
  fallback?: { provider: string; model: string },
): { provider: string; model: string } | undefined {
  if (value === undefined) return fallback
  const slash = value.indexOf('/')
  if (slash <= 0 || slash === value.length - 1) return undefined
  return { provider: value.slice(0, slash), model: value.slice(slash + 1) }
}

interface SkillManageResult {
  ok: boolean
  message: string
  data?: Record<string, JsonValue>
}

function result(ok: boolean, message: string, data?: Record<string, JsonValue>): SkillManageResult {
  return { ok, message, ...data !== undefined ? { data } : {} }
}

/**
 * Register the `skill_manage` tool on `ctx.tools`.
 * @param ctx - context carrying the tools registry and the skill manager service.
 * @param getManager - resolves the skill manager service for the executing agent.
 */
export function registerSkillManageTool(ctx: Context, getManager: () => SkillManager | undefined): void {
  const tool = defineTool({
    name: 'skill_manage',
    description: 'Manage reusable Skills programmatically: validate content, run security checks, save with versioning, list/read/remove/restore/delete, toggle enabled, version history, rollback, and run or poll benchmarks and Auto Improve. Call this for every skill file operation the Skill Creator workflow needs.',
    parameters: {
      action: {
        type: 'string',
        required: true,
        description: `Operation to perform: ${ACTIONS.join(', ')}.`,
      },
      name: { type: 'string', description: 'Kebab-case skill name. Required by most actions.' },
      content: { type: 'string', description: 'Full SKILL.md content for validate, security-check, and save.' },
      scope: {
        type: 'string',
        description: 'Storage scope for save: user (~/.dsh/skills), project (<root>/.dsh/skills), or agents (<root>/.agents/skills). Defaults to project.',
      },
      replace: { type: 'boolean', description: 'Allow overwriting an existing skill of the same name in save.' },
      force: { type: 'boolean', description: 'Allow saving despite a blocked security verdict.' },
      enabled: { type: 'boolean', description: 'Target enabled state for set-enabled.' },
      version: { type: 'string', description: 'Version id for rollback (e.g. v2).' },
      model: { type: 'string', description: 'Task model route as provider/model for benchmark-start and auto-improve.' },
      evaluatorModel: { type: 'string', description: 'Evaluator model route as provider/model; defaults to the task model.' },
      caseCount: { type: 'number', description: 'Explicit benchmark test-suite size (1-10); defaults to an adaptive size.' },
      maxIterations: { type: 'number', description: 'Auto Improve iteration limit (default 5).' },
      minImprovementPercent: { type: 'number', description: 'Auto Improve minimum relative improvement to accept a version (default 1).' },
      stopOnRegression: { type: 'boolean', description: 'Auto Improve: reject candidates that regress below the current best.' },
      runId: { type: 'string', description: 'Benchmark run id for benchmark-poll and benchmark-cancel.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          message: { type: 'string', required: true },
          data: { type: 'object', additionalProperties: true, properties: {} },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderResult(value) }],
    },
    execute(args, exec) {
      const manager = getManager()
      if (manager === undefined) {
        throw new Error('skill_manage: the skill manager service is not mounted')
      }
      const cwd = exec.agent?.session.header.cwd
      if (cwd === undefined) {
        throw new Error('skill_manage: no workspace is attached to this session')
      }
      return runAction(manager, args as Record<string, unknown>, cwd) as never
    },
    presentCall(args) {
      return { card: 'generic', title: `skill_manage: ${args.action}`, kind: 'read' }
    },
  })
  ctx.tools.register(tool)
}

/** Execute one action against the skill manager. */
export async function runAction(manager: SkillManager, args: Record<string, unknown>, cwd: string): Promise<SkillManageResult> {
  try {
    return await runActionInner(manager, args, cwd)
  } catch (error: unknown) {
    if (error instanceof SkillManagerError) {
      return result(false, error.message, { code: error.code })
    }
    throw error
  }
}

async function runActionInner(manager: SkillManager, args: Record<string, unknown>, cwd: string): Promise<SkillManageResult> {
  const action = String(args.action) as Action
  const name = stringArg(args.name)
  switch (action) {
    case 'validate': {
      const validation = manager.validate(stringArg(args.content) ?? '')
      return validation.ok
        ? result(true, 'Skill content is valid.')
        : result(false, `Skill validation failed. Reason: ${validation.reason}`, { reason: validation.reason })
    }
    case 'security-check': {
      const verdict = manager.securityCheck(stringArg(args.content) ?? '')
      const findings = verdict.findings.map(finding => ({
        severity: finding.severity,
        rule: finding.rule,
        message: finding.message,
        evidence: finding.evidence,
      }))
      return result(true, `Security verdict: ${verdict.status.toUpperCase()}.`, { status: verdict.status, findings })
    }
    case 'list': {
      const summaries = (await manager.list(cwd)).map(summary => ({
        name: summary.name,
        description: summary.description,
        scope: summary.scope,
        status: summary.status,
        enabled: summary.enabled,
        version: summary.version,
      }))
      return result(true, `${summaries.length} skills.`, { skills: summaries })
    }
    case 'read': {
      if (name === undefined) return result(false, 'read requires a skill name')
      const skill = await manager.read(name, cwd)
      if (skill === undefined) return result(false, `skill "${name}" is not managed`)
      return result(true, `Skill ${skill.name} (${skill.scope}).`, {
        name: skill.name,
        description: skill.description,
        scope: skill.scope,
        status: skill.status,
        version: skill.version,
        content: skill.content,
        versions: skill.versions.map(version => ({ id: version.id, reason: version.reason, source: version.source })),
      })
    }
    case 'save': {
      const content = stringArg(args.content)
      if (content === undefined || content === '') return result(false, 'save requires skill content')
      const scope = scopeArg(args.scope)
      const saved = await manager.save({
        name: name ?? '',
        content,
        scope,
        cwd,
        reason: 'Created by Skill Creator',
        source: 'creator',
        replace: booleanArg(args.replace) ?? false,
        force: booleanArg(args.force) ?? false,
      })
      return result(
        true,
        `Saved ${saved.name} as ${saved.version} at ${saved.path}${saved.security.status === 'warning' ? ' (security warning)' : ''}.`,
        {
          name: saved.name,
          scope: saved.scope,
          path: saved.path,
          version: saved.version,
          created: saved.created,
          security: saved.security.status,
        },
      )
    }
    case 'remove': {
      if (name === undefined) return result(false, 'remove requires a skill name')
      await manager.remove(name, cwd)
      return result(true, `Skill "${name}" moved to trash.`, { name })
    }
    case 'restore': {
      if (name === undefined) return result(false, 'restore requires a skill name')
      await manager.restore(name, cwd)
      return result(true, `Skill "${name}" restored.`, { name })
    }
    case 'delete': {
      if (name === undefined) return result(false, 'delete requires a skill name')
      await manager.permanentDelete(name, cwd)
      return result(true, `Skill "${name}" permanently deleted.`, { name })
    }
    case 'set-enabled': {
      if (name === undefined) return result(false, 'set-enabled requires a skill name')
      const enabled = booleanArg(args.enabled)
      if (enabled === undefined) return result(false, 'set-enabled requires enabled: true or false')
      await manager.setEnabled(name, enabled, cwd)
      return result(true, `Skill "${name}" ${enabled ? 'enabled' : 'disabled'}.`, { name, enabled })
    }
    case 'versions': {
      if (name === undefined) return result(false, 'versions requires a skill name')
      const versions = await manager.versions(name, cwd)
      return result(true, `${versions.length} versions.`, {
        versions: versions.map(version => ({
          id: version.id,
          reason: version.reason,
          source: version.source,
          createdAt: version.createdAt,
          ...version.benchmark !== undefined
            ? { benchmark: { score: version.benchmark.skillScore, verdict: version.benchmark.verdict, version: version.benchmark.version } }
            : {},
        })),
      })
    }
    case 'rollback': {
      if (name === undefined) return result(false, 'rollback requires a skill name')
      const version = stringArg(args.version)
      if (version === undefined) return result(false, 'rollback requires a version id')
      const active = await manager.rollback(name, version, cwd)
      return result(true, `Skill "${name}" rolled back; active version is now ${active}.`, { name, activeVersion: active })
    }
    case 'benchmark-start': {
      if (name === undefined) return result(false, 'benchmark-start requires a skill name')
      const taskModel = parseRoute(stringArg(args.model))
      if (taskModel === undefined) return result(false, 'benchmark-start requires a task model route as provider/model')
      const options: {
        skillName: string
        cwd: string
        taskModel: ModelRoute
        evaluatorModel?: ModelRoute
        caseCount?: number
      } = { skillName: name, cwd, taskModel }
      const evaluatorModel = parseRoute(stringArg(args.evaluatorModel))
      const caseCount = numberArg(args.caseCount)
      if (evaluatorModel !== undefined) options.evaluatorModel = evaluatorModel
      if (caseCount !== undefined) options.caseCount = caseCount
      const run = manager.startBenchmark(options)
      return result(true, `Benchmark started as ${run.id}. Poll with benchmark-poll.`, { runId: run.id, status: run.status })
    }
    case 'benchmark-poll': {
      const runId = stringArg(args.runId)
      if (runId === undefined) return result(false, 'benchmark-poll requires a run id')
      const run = manager.pollBenchmark(runId)
      if (run === undefined) return result(false, `benchmark run "${runId}" not found`)
      /* v8 ignore next -- the running-phase poll is transient; completing, failed, and cancelled polls are covered. */
      if (run.status === 'running') {
        return result(true, `Benchmark ${run.phase} (case ${run.progress.case}/${run.progress.total}).`, { runId: run.id, status: run.status, phase: run.phase, progress: run.progress })
      }
      /* v8 ignore next -- a failed run always records its error message. */
      if (run.status === 'failed') return result(false, `Benchmark failed: ${run.error === undefined ? 'unknown error' : run.error}`, { runId: run.id, status: run.status })
      if (run.status === 'cancelled') return result(false, 'Benchmark was cancelled.', { runId: run.id, status: run.status })
      return result(true, benchmarkResultMessage(run.result), {
        runId: run.id,
        status: run.status,
        /* v8 ignore next -- the completed poll returns its result through the poll tool test. */
        ...run.result !== undefined ? { result: run.result as unknown as JsonValue } : {},
      })
    }
    case 'benchmark-cancel': {
      const runId = stringArg(args.runId)
      if (runId === undefined) return result(false, 'benchmark-cancel requires a run id')
      const run = manager.cancelBenchmark(runId)
      if (run === undefined) return result(false, `benchmark run "${runId}" not found`)
      return result(true, `Benchmark ${run.id} cancelled.`, { runId: run.id, status: run.status })
    }
    case 'auto-improve': {
      if (name === undefined) return result(false, 'auto-improve requires a skill name')
      const taskModel = parseRoute(stringArg(args.model))
      if (taskModel === undefined) return result(false, 'auto-improve requires a task model route as provider/model')
      const options: {
        skillName: string
        cwd: string
        taskModel: ModelRoute
        evaluatorModel?: ModelRoute
        caseCount?: number
        maxIterations: number
        minImprovementPercent: number
        stopOnRegression: boolean
      } = {
        skillName: name,
        cwd,
        taskModel,
        maxIterations: numberArg(args.maxIterations) ?? 5,
        minImprovementPercent: numberArg(args.minImprovementPercent) ?? 1,
        stopOnRegression: booleanArg(args.stopOnRegression) ?? true,
      }
      const evaluatorModel = parseRoute(stringArg(args.evaluatorModel))
      const caseCount = numberArg(args.caseCount)
      if (evaluatorModel !== undefined) options.evaluatorModel = evaluatorModel
      if (caseCount !== undefined) options.caseCount = caseCount
      const run = manager.startAutoImprove(options)
      return result(true, `Auto Improve started as ${run.id}. Poll with benchmark-poll.`, { runId: run.id, status: run.status, iterations: run.iterations.length, bestVersion: run.bestVersion })
    }
  }
}

/** Compact model-facing summary of a completed benchmark. */
function benchmarkResultMessage(result: BenchmarkRun['result']): string {
  /* v8 ignore next -- a completed run always carries its result. */
  if (result === undefined) return 'Benchmark completed with no result.'
  const { summary } = result
  return [
    `Baseline: ${summary.baselineScore}/100`,
    `Skill: ${summary.skillScore}/100`,
    // v8 ignore start -- polled runs are improvement-verdict, so the negative sign is unreachable.
    `Improvement: ${summary.improvementPercent >= 0 ? '+' : ''}${summary.improvementPercent}%`,
    // v8 ignore stop
    `Verdict: ${summary.verdict}`,
    `Tokens: ${summary.baselineTokens.total} → ${summary.skillTokens.total}`,
    `Time: ${summary.baselineTimeMs}ms → ${summary.skillTimeMs}ms`,
    `Tool calls: ${summary.baselineToolCalls} → ${summary.skillToolCalls}`,
  ].join('\n')
}

/** Render the tool result as plain text lines. */
function renderResult(value: SkillManageResult): string {
  const data = value.data
  /* v8 ignore next -- the tool result always carries its data in this package's actions. */
  const entries = data === undefined ? [] : Object.entries(data)
  return [value.message, ...entries.map(([key, entry]) => `${key}: ${JSON.stringify(entry)}`)].join('\n')
}

function stringArg(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function booleanArg(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function numberArg(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function scopeArg(value: unknown): SkillScope {
  return value === 'user' || value === 'agents' ? value : 'project'
}
