/**
 * Wire adapter for the Skills Manager: folds the skills domain's RpcResponse
 * envelopes into plain promises, preserving the manager's machine-routable
 * error code (details.code for `skill-manager-error` failures) on a typed
 * error class the dialogs use for conflict/blocked resolution.
 */

import type {
  BenchmarkRunView, ManagedSkillSummaryView, ManagedSkillView, ModelProviderGroup,
  ModelRouteView, RpcResponse, SaveSkillResultView, SecurityVerdictView,
  SkillVersionView, TrashEntryView,
} from '@deepseek-ai/dsh-host-apiproxy/api'
import type { IApiClient, SessionId } from '@deepseek-ai/dsh-client-connection/client'

/** Scope the manager writes into (built-ins are never written). */
export type SkillWriteScope = 'user' | 'project' | 'agents'

/** Input of the save action (conflict/blocked flags resolve through the UI). */
export interface SaveSkillInput {
  readonly sessionId: SessionId
  readonly name: string
  readonly content: string
  readonly scope: SkillWriteScope
  readonly replace?: boolean
  readonly force?: boolean
}

/** Input of the benchmark start action. */
export interface BenchmarkStartInput {
  readonly sessionId: SessionId
  readonly name: string
  readonly taskModel: ModelRouteView
  readonly evaluatorModel?: ModelRouteView
  readonly caseCount?: number
}

/** Input of the run-all action: one sequential batch over the named skills. */
export interface BenchmarkBatchStartInput {
  readonly sessionId: SessionId
  names: string[]
  readonly taskModel: ModelRouteView
  readonly evaluatorModel?: ModelRouteView
  readonly caseCount?: number
}

/**
 * Typed wire failure. `code` is the manager's own error code where the host
 * wraps one (`skill-conflict`, `skill-blocked`, …), falling back to the RPC
 * error code for non-manager failures.
 */
export class SkillApiError extends Error {
  /** Stable machine-routable error code. */
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'SkillApiError'
    this.code = code
  }
}

/** Unwrap a unary response or throw a SkillApiError carrying the routed code. */
function unwrap<T>(response: RpcResponse<T>): T {
  if (response.result.ok) return response.result.value
  const { code, message, details } = response.result.error
  const detailsCode = (details as { code?: unknown } | undefined)?.code
  const routed = typeof detailsCode === 'string' ? detailsCode : code
  throw new SkillApiError(routed, message)
}

/** Business actions the section binds; every rejection is a SkillApiError. */
export interface SkillsActions {
  /** List the full managed catalog (filesystem skills plus built-ins). */
  listManaged: (sessionId: SessionId) => Promise<readonly ManagedSkillSummaryView[]>
  /** List trashed skills. */
  trash: (sessionId: SessionId) => Promise<readonly TrashEntryView[]>
  /** Read one managed skill with body and version history. */
  read: (sessionId: SessionId, name: string) => Promise<ManagedSkillView | undefined>
  /** Create or update one managed skill. */
  save: (input: SaveSkillInput) => Promise<SaveSkillResultView>
  /** Move one managed skill to the trash. */
  remove: (sessionId: SessionId, name: string) => Promise<void>
  /** Restore one trashed skill. */
  restore: (sessionId: SessionId, name: string) => Promise<void>
  /** Permanently delete one trashed skill. */
  permanentDelete: (sessionId: SessionId, name: string) => Promise<void>
  /** Enable or disable one managed skill. */
  setEnabled: (sessionId: SessionId, name: string, enabled: boolean) => Promise<void>
  /** List the version history of one managed skill. */
  versions: (sessionId: SessionId, name: string) => Promise<readonly SkillVersionView[]>
  /** Roll one managed skill back to an earlier version; returns the new active version. */
  rollback: (sessionId: SessionId, name: string, version: string) => Promise<string>
  /** Validate raw SKILL.md content with the shared parser. */
  validate: (content: string) => Promise<{ ok: boolean; reason?: string }>
  /** Run the static security check over raw SKILL.md content. */
  securityCheck: (content: string) => Promise<SecurityVerdictView>
  /** Start a background benchmark and return its live run view. */
  benchmarkStart: (input: BenchmarkStartInput) => Promise<BenchmarkRunView>
  /** Read the current view of one benchmark run. */
  benchmarkPoll: (runId: string) => Promise<BenchmarkRunView>
  /** Cancel one running benchmark run. */
  benchmarkCancel: (runId: string) => Promise<BenchmarkRunView>
  /** Start a sequential batch of benchmarks over the named skills. */
  benchmarkBatchStart: (input: BenchmarkBatchStartInput) => Promise<readonly BenchmarkRunView[]>
  /** List the model catalog groups for benchmark model selection. */
  listModels: () => Promise<readonly ModelProviderGroup[]>
}

/**
 * Build the section's actions over the shared wire client.
 * @param api - the client's skills + llm domains.
 * @returns the action table.
 */
export function createSkillsActions(api: Pick<IApiClient, 'skills' | 'llm'>): SkillsActions {
  return {
    async listManaged(sessionId) {
      return unwrap(await api.skills.listManaged({ sessionId })).skills
    },
    async trash(sessionId) {
      return unwrap(await api.skills.trash({ sessionId })).entries
    },
    async read(sessionId, name) {
      return unwrap(await api.skills.read({ sessionId, name })).skill
    },
    async save(input) {
      return unwrap(await api.skills.save(input)).result
    },
    async remove(sessionId, name) {
      unwrap(await api.skills.remove({ sessionId, name }))
    },
    async restore(sessionId, name) {
      unwrap(await api.skills.restore({ sessionId, name }))
    },
    async permanentDelete(sessionId, name) {
      unwrap(await api.skills.permanentDelete({ sessionId, name }))
    },
    async setEnabled(sessionId, name, enabled) {
      unwrap(await api.skills.setEnabled({ sessionId, name, enabled }))
    },
    async versions(sessionId, name) {
      return unwrap(await api.skills.versions({ sessionId, name })).versions
    },
    async rollback(sessionId, name, version) {
      return unwrap(await api.skills.rollback({ sessionId, name, version })).activeVersion
    },
    async validate(content) {
      return unwrap(await api.skills.validate({ content }))
    },
    async securityCheck(content) {
      return unwrap(await api.skills.securityCheck({ content }))
    },
    async benchmarkStart(input) {
      return unwrap(await api.skills.benchmarkStart(input)).run
    },
    async benchmarkPoll(runId) {
      return unwrap(await api.skills.benchmarkPoll({ runId })).run
    },
    async benchmarkCancel(runId) {
      return unwrap(await api.skills.benchmarkCancel({ runId })).run
    },
    async benchmarkBatchStart(input) {
      return unwrap(await api.skills.benchmarkBatchStart(input)).runs
    },
    async listModels() {
      return unwrap(await api.llm.models({})).groups
    },
  }
}
