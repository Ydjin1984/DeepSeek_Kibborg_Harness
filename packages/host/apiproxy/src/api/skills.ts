/**
 * skills domain contract: the read-only skill catalog plus the skill-manager
 * lifecycle surface (CRUD, trash, versions, enable/disable, validation,
 * security, and benchmark control). Every request is addressed by session; the
 * session's header cwd resolves to the canonical project root host-side — the
 * client never submits a raw path, and skill operations never create or resume
 * an Agent (except benchmark task agents, which the manager owns).
 */

import type { LocalizedSkillDescription } from '@deepseek-ai/dsh-skill'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { RpcRequest, RpcResponse } from './rpc.ts'

/** Skill catalog row (wire projection of the host SkillSummary; provider/source vocabulary stays host-side). */
export interface SkillEntry {
  /** Kebab-case identifier the user references as `/name` in the composer. */
  readonly name: string
  /** Short routing description (the model-facing default). */
  readonly description: string
  /** Optional per-locale routing descriptions; locale-aware surfaces prefer the active locale's entry. */
  readonly localizedDescription?: LocalizedSkillDescription
  /** Optional extra routing guidance. */
  readonly whenToUse?: string
  /** False marks a user-only skill (`disable-model-invocation`): invocable here, absent from the model catalog. */
  readonly modelInvocable: boolean
}

/** Managed skill status as surfaced to the Skills Manager tab. */
export type ManagedSkillStatus =
  | 'enabled'
  | 'disabled'
  | 'not-tested'
  | 'benchmark-outdated'
  | 'warning'
  | 'blocked'

/** Managed catalog row (wire projection of the manager's ManagedSkillSummary). */
export interface ManagedSkillSummaryView {
  readonly name: string
  readonly description: string
  readonly localizedDescription?: LocalizedSkillDescription
  readonly whenToUse?: string
  readonly invocation: { readonly modelInvocable: boolean; readonly userInvocable: boolean }
  /** `built-in` marks a bundled/runtime contribution that cannot be edited or deleted. */
  readonly scope: 'user' | 'project' | 'agents' | 'built-in'
  /** Absolute SKILL.md path for filesystem skills; absent for built-ins. */
  readonly path?: string
  readonly source: string
  readonly enabled: boolean
  readonly status: ManagedSkillStatus
  readonly version: string
  readonly versionsCount: number
  readonly createdAt?: string
  readonly updatedAt?: string
  readonly lastBenchmark?: BenchmarkSummaryView
}

/** Full managed skill: summary plus body and version history. */
export interface ManagedSkillView extends ManagedSkillSummaryView {
  readonly content: string
  readonly versions: readonly SkillVersionView[]
  readonly metadata?: Readonly<Record<string, unknown>>
}

/** One version-history entry. */
export interface SkillVersionView {
  readonly id: string
  readonly createdAt: string
  readonly reason: string
  readonly source: string
  readonly benchmark?: BenchmarkSummaryView
}

/** Model route used by a benchmark task or evaluator. */
export interface ModelRouteView {
  readonly provider: string
  readonly model: string
}

/** Persisted benchmark outcome attached to a version. */
export interface BenchmarkSummaryView {
  readonly runId: string
  readonly at: string
  readonly version: string
  readonly taskModel: ModelRouteView
  readonly evaluatorModel: ModelRouteView
  readonly baselineScore: number
  readonly skillScore: number
  readonly improvementPercent: number
  readonly verdict: 'improvement' | 'worse' | 'no-significant-improvement'
  readonly baselineTokens: TokenMetricsView
  readonly skillTokens: TokenMetricsView
  readonly baselineTimeMs: number
  readonly skillTimeMs: number
  readonly baselineToolCalls: number
  readonly skillToolCalls: number
}

/** Token accounting for one task execution. */
export interface TokenMetricsView {
  readonly input: number
  readonly output: number
  readonly total: number
}

/** One security finding with matched evidence. */
export interface SecurityFindingView {
  readonly severity: 'info' | 'warning' | 'blocked'
  readonly rule: string
  readonly message: string
  readonly evidence: string
}

/** Static security verdict over a skill body. */
export interface SecurityVerdictView {
  readonly status: 'valid' | 'warning' | 'blocked'
  readonly findings: readonly SecurityFindingView[]
}

/** One benchmark test case. */
export interface BenchmarkCaseView {
  readonly id: string
  readonly title: string
  readonly request: string
}

/** Per-case A/B outcome. */
export interface BenchmarkCaseResultView {
  readonly caseId: string
  readonly title: string
  readonly baselineScore: number
  readonly skillScore: number
  readonly improvementPercent: number
  readonly baselineTokens: TokenMetricsView
  readonly skillTokens: TokenMetricsView
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

/** Complete benchmark result. */
export interface BenchmarkResultView {
  readonly summary: BenchmarkSummaryView
  readonly cases: readonly BenchmarkCaseResultView[]
  readonly criteria: readonly string[]
  readonly reasons: readonly string[]
}

/** Live view of one benchmark or Auto Improve run. */
export interface BenchmarkRunView {
  readonly id: string
  readonly skillName: string
  readonly status: 'running' | 'completed' | 'failed' | 'cancelled'
  readonly phase: 'preparing' | 'generating-cases' | 'running-baseline' | 'running-skill' | 'evaluating' | 'done'
  readonly progress: { readonly case: number; readonly total: number }
  readonly result?: BenchmarkResultView
  readonly error?: string
  readonly createdAt: number
  /** Auto Improve only. */
  readonly iterations?: readonly AutoImproveIterationView[]
  /** Auto Improve only: the version that won. */
  readonly bestVersion?: string
}

/** One Auto Improve iteration outcome. */
export interface AutoImproveIterationView {
  readonly index: number
  readonly version: string
  readonly score: number
  readonly accepted: boolean
  readonly reason: string
}

/** Save outcome of the manager. */
export interface SaveSkillResultView {
  readonly name: string
  readonly scope: 'user' | 'project' | 'agents'
  readonly path: string
  readonly created: boolean
  readonly version: string
  readonly security: SecurityVerdictView
}

/** One trashed skill entry. */
export interface TrashEntryView {
  readonly name: string
  readonly scope: 'user' | 'project' | 'agents'
  readonly path: string
}

/**
 * Skill-domain unary methods. `list` is the invocation catalog used by the
 * composer; the remaining methods drive the skill manager lifecycle. All
 * manager methods resolve the workspace from the session header, so a cold
 * session must be attached to a project before management works.
 */
export interface SkillsApi {
  /** Lists the user-invocable skill catalog for the session's project. */
  list(request: RpcRequest<{ sessionId: SessionId }>): Promise<RpcResponse<{ skills: readonly SkillEntry[] }>>
  /** Lists the full managed catalog: filesystem skills plus built-ins. */
  listManaged(request: RpcRequest<{ sessionId: SessionId }>): Promise<RpcResponse<{ skills: readonly ManagedSkillSummaryView[] }>>
  /** Reads one managed skill with body and version history. */
  read(request: RpcRequest<{ sessionId: SessionId; name: string }>): Promise<RpcResponse<{ skill?: ManagedSkillView }>>
  /** Creates or updates one managed skill (conflict resolution requires replace). */
  save(request: RpcRequest<{
    sessionId: SessionId
    name: string
    content: string
    scope: 'user' | 'project' | 'agents'
    replace?: boolean
    force?: boolean
  }>): Promise<RpcResponse<{ result: SaveSkillResultView }>>
  /** Moves one managed skill to the trash. */
  remove(request: RpcRequest<{ sessionId: SessionId; name: string }>): Promise<RpcResponse<{}>>
  /** Restores one trashed skill. */
  restore(request: RpcRequest<{ sessionId: SessionId; name: string }>): Promise<RpcResponse<{}>>
  /** Permanently deletes one trashed skill. */
  permanentDelete(request: RpcRequest<{ sessionId: SessionId; name: string }>): Promise<RpcResponse<{}>>
  /** Lists trashed skills. */
  trash(request: RpcRequest<{ sessionId: SessionId }>): Promise<RpcResponse<{ entries: readonly TrashEntryView[] }>>
  /** Enables or disables one managed skill. */
  setEnabled(request: RpcRequest<{ sessionId: SessionId; name: string; enabled: boolean }>): Promise<RpcResponse<{}>>
  /** Lists the version history of one managed skill. */
  versions(request: RpcRequest<{ sessionId: SessionId; name: string }>): Promise<RpcResponse<{ versions: readonly SkillVersionView[] }>>
  /** Rolls one managed skill back to an earlier version. */
  rollback(request: RpcRequest<{ sessionId: SessionId; name: string; version: string }>): Promise<RpcResponse<{ activeVersion: string }>>
  /** Validates raw SKILL.md content with the shared parser. */
  validate(request: RpcRequest<{ content: string }>): Promise<RpcResponse<{ ok: boolean; reason?: string }>>
  /** Runs the static security check over raw SKILL.md content. */
  securityCheck(request: RpcRequest<{ content: string }>): Promise<RpcResponse<SecurityVerdictView>>
  /** Starts a background benchmark and returns its live run view. */
  benchmarkStart(request: RpcRequest<{
    sessionId: SessionId
    name: string
    taskModel: ModelRouteView
    evaluatorModel?: ModelRouteView
    caseCount?: number
  }>): Promise<RpcResponse<{ run: BenchmarkRunView }>>
  /** Reads the current view of one benchmark or Auto Improve run. */
  benchmarkPoll(request: RpcRequest<{ runId: string }>): Promise<RpcResponse<{ run: BenchmarkRunView }>>
  /** Cancels one running benchmark or Auto Improve run. */
  benchmarkCancel(request: RpcRequest<{ runId: string }>): Promise<RpcResponse<{ run: BenchmarkRunView }>>
  /** Starts a sequential batch of background benchmarks, one run per named skill. */
  benchmarkBatchStart(request: RpcRequest<{
    sessionId: SessionId
    names: string[]
    taskModel: ModelRouteView
    evaluatorModel?: ModelRouteView
    caseCount?: number
  }>): Promise<RpcResponse<{ runs: readonly BenchmarkRunView[] }>>
  /** Starts a background Auto Improve loop. */
  autoImprove(request: RpcRequest<{
    sessionId: SessionId
    name: string
    taskModel: ModelRouteView
    evaluatorModel?: ModelRouteView
    caseCount?: number
    maxIterations?: number
    minImprovementPercent?: number
    stopOnRegression?: boolean
  }>): Promise<RpcResponse<{ run: BenchmarkRunView }>>
}
