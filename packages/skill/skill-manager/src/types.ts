/**
 * Public vocabulary of the skill manager: managed catalog rows, storage scopes,
 * version history, security verdicts, and benchmark runs. Types only — no
 * runtime code.
 * @module @deepseek-ai/dsh-skill-manager/types
 */

import type { LocalizedSkillDescription, SkillSource } from '@deepseek-ai/dsh-skill'

/** Where a managed skill physically lives. `user` = `~/.dsh/skills`, `project` =
 * `<root>/.dsh/skills`, `agents` = `<root>/.agents/skills`. */
export type SkillScope = 'user' | 'project' | 'agents'

/** UI state of one skill derived from disk, policy, and benchmark history. */
export type SkillStatus =
  | 'enabled'
  | 'disabled'
  | 'not-tested'
  | 'benchmark-outdated'
  | 'warning'
  | 'blocked'

/** Invocation controls as the manager surfaces them. */
export interface ManagedInvocation {
  readonly modelInvocable: boolean
  readonly userInvocable: boolean
}

/** Catalog row the Skills Manager tab renders. */
export interface ManagedSkillSummary {
  readonly name: string
  readonly description: string
  readonly localizedDescription?: LocalizedSkillDescription
  readonly whenToUse?: string
  readonly invocation: ManagedInvocation
  /** `built-in` marks a bundled/runtime contribution that cannot be edited or deleted. */
  readonly scope: SkillScope | 'built-in'
  /** Absolute SKILL.md path for filesystem skills; absent for built-ins. */
  readonly path?: string
  readonly source: SkillSource
  readonly enabled: boolean
  readonly status: SkillStatus
  /** Active version id (`v1`, `v2`, …); `-` for built-ins. */
  readonly version: string
  readonly versionsCount: number
  readonly createdAt?: string
  readonly updatedAt?: string
  readonly lastBenchmark?: BenchmarkSummary
}

/** Full managed skill body plus its version history. */
export interface ManagedSkill extends ManagedSkillSummary {
  readonly content: string
  readonly versions: SkillVersion[]
  /** Parsed optional metadata object from the skill frontmatter. */
  readonly metadata?: Readonly<Record<string, unknown>>
}

/** Origin of one version event. */
export type VersionSource = 'initial' | 'creator' | 'manual' | 'auto-improve' | 'rollback' | 'restore'

/** One entry of a skill's version history. */
export interface SkillVersion {
  readonly id: string
  readonly createdAt: string
  readonly reason: string
  readonly source: VersionSource
  readonly benchmark?: BenchmarkSummary
}

/** Model route used by a benchmark task or evaluator. */
export interface ModelRoute {
  readonly provider: string
  readonly model: string
}

/** Aggregate benchmark judgment over the whole test suite. */
export type BenchmarkVerdict = 'improvement' | 'worse' | 'no-significant-improvement'

/** Persisted benchmark outcome attached to a skill version. */
export interface BenchmarkSummary {
  readonly runId: string
  readonly at: string
  readonly version: string
  readonly taskModel: ModelRoute
  readonly evaluatorModel: ModelRoute
  readonly baselineScore: number
  readonly skillScore: number
  readonly improvementPercent: number
  readonly verdict: BenchmarkVerdict
  readonly baselineTokens: TokenMetrics
  readonly skillTokens: TokenMetrics
  readonly baselineTimeMs: number
  readonly skillTimeMs: number
  readonly baselineToolCalls: number
  readonly skillToolCalls: number
}

/** Token accounting for one task execution. */
export interface TokenMetrics {
  readonly input: number
  readonly output: number
  readonly total: number
}

/** Outcome of validating raw SKILL.md content with the shared parser. */
export type ValidationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string }

/** Severity of one security finding. */
export type SecurityFindingSeverity = 'info' | 'warning' | 'blocked'

/** One security-check finding with the matched evidence. */
export interface SecurityFinding {
  readonly severity: SecurityFindingSeverity
  readonly rule: string
  readonly message: string
  readonly evidence: string
}

/** Static security verdict over a skill body. */
export interface SecurityVerdict {
  readonly status: 'valid' | 'warning' | 'blocked'
  readonly findings: readonly SecurityFinding[]
}

/** Input to {@link SkillManager.save}. */
export interface SaveSkillInput {
  readonly name: string
  readonly content: string
  readonly scope: SkillScope
  readonly cwd: string
  readonly reason?: string
  readonly source?: VersionSource
  /** Allow overwriting an existing skill of the same name in the target scope. */
  readonly replace?: boolean
  /** Allow saving despite a `blocked` security verdict. */
  readonly force?: boolean
}

/** Result of a save operation. */
export interface SaveSkillResult {
  readonly name: string
  readonly scope: SkillScope
  readonly path: string
  readonly created: boolean
  readonly version: string
  readonly security: SecurityVerdict
}

/** One generated benchmark test case. */
export interface BenchmarkCase {
  readonly id: string
  readonly title: string
  readonly request: string
}

/** Per-case A/B outcome with both outputs and the evaluator's comments. */
export interface BenchmarkCaseResult {
  readonly caseId: string
  readonly title: string
  readonly baselineScore: number
  readonly skillScore: number
  readonly improvementPercent: number
  readonly baselineTokens: TokenMetrics
  readonly skillTokens: TokenMetrics
  readonly baselineTimeMs: number
  readonly skillTimeMs: number
  readonly baselineToolCalls: number
  readonly skillToolCalls: number
  readonly baselineError: boolean
  readonly skillError: boolean
  readonly baselineOutput: string
  readonly skillOutput: string
  readonly baselineComment: string
  readonly skillComment: string
}

/** Complete benchmark result: overall summary plus per-case detail. */
export interface BenchmarkResult {
  readonly summary: BenchmarkSummary
  readonly cases: readonly BenchmarkCaseResult[]
  readonly criteria: readonly string[]
  readonly reasons: readonly string[]
}

/** Input to {@link SkillManager.benchmarkStart}. */
export interface BenchmarkRequest {
  readonly skillName: string
  readonly cwd: string
  readonly taskModel: ModelRoute
  readonly evaluatorModel?: ModelRoute
  /** Explicit test-suite size; omitted sizes adapt to skill complexity. */
  readonly caseCount?: number
}

/** Shared settings of a sequential benchmark batch over several skills. */
export interface BenchmarkBatchInput {
  /** Workspace directory resolving the managed roots. */
  readonly cwd: string
  readonly taskModel: ModelRoute
  readonly evaluatorModel?: ModelRoute
  /** Explicit test-suite size; omitted sizes adapt per skill complexity. */
  readonly caseCount?: number
}

/** Live view of one benchmark run; `result` is present only when completed. */
export interface BenchmarkRun {
  readonly id: string
  readonly skillName: string
  readonly status: 'running' | 'completed' | 'failed' | 'cancelled'
  readonly phase: 'preparing' | 'generating-cases' | 'running-baseline' | 'running-skill' | 'evaluating' | 'done'
  readonly progress: { readonly case: number; readonly total: number }
  readonly result?: BenchmarkResult
  readonly error?: string
  readonly createdAt: number
}

/** Input to {@link SkillManager.autoImprove}. */
export interface AutoImproveRequest extends BenchmarkRequest {
  readonly maxIterations: number
  readonly minImprovementPercent: number
  readonly stopOnRegression: boolean
}

/** One Auto Improve iteration outcome. */
export interface AutoImproveIteration {
  readonly index: number
  readonly version: string
  readonly score: number
  readonly accepted: boolean
  readonly reason: string
}

/** Live view of one Auto Improve run. */
export interface AutoImproveRun extends BenchmarkRun {
  readonly iterations: readonly AutoImproveIteration[]
  readonly bestVersion: string
}
