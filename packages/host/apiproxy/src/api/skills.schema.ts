/**
 * skills domain zod schemas (names derived from map keys: skillListRequestSchema /
 * skillListValueSchema, skillSaveRequestSchema / skillSaveValueSchema, …).
 */

import { z } from 'zod'
import type { RequestPayload, ResponseValue } from './rpc-map.ts'
import type { Wire } from './rpc.schema.ts'
import { sessionIdSchema } from './sessions.schema.ts'
import type { SkillEntry } from './skills.ts'

/** SkillEntry row of skill.list. */
export const skillEntrySchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  localizedDescription: z.object({
    zh: z.string().min(1).optional(),
    ru: z.string().min(1).optional(),
  }).optional(),
  whenToUse: z.string().optional(),
  modelInvocable: z.boolean(),
}) satisfies z.ZodType<Wire<SkillEntry>>

const managedScopeSchema = z.enum(['user', 'project', 'agents', 'built-in'])
const modelRouteSchema = z.object({ provider: z.string().min(1), model: z.string().min(1) })
const tokenMetricsSchema = z.object({ input: z.number(), output: z.number(), total: z.number() })

/** BenchmarkSummaryView row. */
export const benchmarkSummarySchema = z.object({
  runId: z.string(),
  at: z.string(),
  version: z.string(),
  taskModel: modelRouteSchema,
  evaluatorModel: modelRouteSchema,
  baselineScore: z.number(),
  skillScore: z.number(),
  improvementPercent: z.number(),
  verdict: z.enum(['improvement', 'worse', 'no-significant-improvement']),
  baselineTokens: tokenMetricsSchema,
  skillTokens: tokenMetricsSchema,
  baselineTimeMs: z.number(),
  skillTimeMs: z.number(),
  baselineToolCalls: z.number(),
  skillToolCalls: z.number(),
})

/** ManagedSkillSummaryView row. */
export const managedSkillSummarySchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  localizedDescription: z.object({
    zh: z.string().min(1).optional(),
    ru: z.string().min(1).optional(),
  }).optional(),
  whenToUse: z.string().optional(),
  invocation: z.object({ modelInvocable: z.boolean(), userInvocable: z.boolean() }),
  scope: managedScopeSchema,
  path: z.string().optional(),
  source: z.string(),
  enabled: z.boolean(),
  status: z.enum(['enabled', 'disabled', 'not-tested', 'benchmark-outdated', 'warning', 'blocked']),
  version: z.string(),
  versionsCount: z.number(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  lastBenchmark: benchmarkSummarySchema.optional(),
})

const skillVersionSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  reason: z.string(),
  source: z.string(),
  benchmark: benchmarkSummarySchema.optional(),
})

const managedSkillSchema = managedSkillSummarySchema.extend({
  content: z.string(),
  versions: z.array(skillVersionSchema),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

const securityFindingSchema = z.object({
  severity: z.enum(['info', 'warning', 'blocked']),
  rule: z.string(),
  message: z.string(),
  evidence: z.string(),
})

const securityVerdictSchema = z.object({
  status: z.enum(['valid', 'warning', 'blocked']),
  findings: z.array(securityFindingSchema),
})

const benchmarkCaseResultSchema = z.object({
  caseId: z.string(),
  title: z.string(),
  baselineScore: z.number(),
  skillScore: z.number(),
  improvementPercent: z.number(),
  baselineTokens: tokenMetricsSchema,
  skillTokens: tokenMetricsSchema,
  baselineTimeMs: z.number(),
  skillTimeMs: z.number(),
  baselineToolCalls: z.number(),
  skillToolCalls: z.number(),
  baselineError: z.boolean(),
  skillError: z.boolean(),
  baselineOutput: z.string(),
  skillOutput: z.string(),
  baselineComment: z.string(),
  skillComment: z.string(),
})

const benchmarkResultSchema = z.object({
  summary: benchmarkSummarySchema,
  cases: z.array(benchmarkCaseResultSchema),
  criteria: z.array(z.string()),
  reasons: z.array(z.string()),
})

const autoImproveIterationSchema = z.object({
  index: z.number(),
  version: z.string(),
  score: z.number(),
  accepted: z.boolean(),
  reason: z.string(),
})

const benchmarkRunSchema = z.object({
  id: z.string(),
  skillName: z.string(),
  status: z.enum(['running', 'completed', 'failed', 'cancelled']),
  phase: z.enum(['preparing', 'generating-cases', 'running-baseline', 'running-skill', 'evaluating', 'done']),
  progress: z.object({ case: z.number(), total: z.number() }),
  result: benchmarkResultSchema.optional(),
  error: z.string().optional(),
  createdAt: z.number(),
  iterations: z.array(autoImproveIterationSchema).optional(),
  bestVersion: z.string().optional(),
})

const saveSkillResultSchema = z.object({
  name: z.string(),
  scope: z.enum(['user', 'project', 'agents']),
  path: z.string(),
  created: z.boolean(),
  version: z.string(),
  security: securityVerdictSchema,
})

const trashEntrySchema = z.object({
  name: z.string(),
  scope: z.enum(['user', 'project', 'agents']),
  path: z.string(),
})

const nameRequestSchema = z.object({ sessionId: sessionIdSchema, name: z.string().min(1) })

/** skill.list request payload. */
export const skillListRequestSchema = z.object({
  sessionId: sessionIdSchema,
}) satisfies z.ZodType<Wire<RequestPayload<'skill.list'>>>

/** skill.list response value. */
export const skillListValueSchema = z.object({
  skills: z.array(skillEntrySchema),
}) satisfies z.ZodType<Wire<ResponseValue<'skill.list'>>>

/** skill.listManaged request payload. */
export const skillListManagedRequestSchema = z.object({
  sessionId: sessionIdSchema,
}) satisfies z.ZodType<Wire<RequestPayload<'skill.listManaged'>>>

/** skill.listManaged response value. */
export const skillListManagedValueSchema = z.object({
  skills: z.array(managedSkillSummarySchema),
}) satisfies z.ZodType<Wire<ResponseValue<'skill.listManaged'>>>

/** skill.read request payload. */
export const skillReadRequestSchema = nameRequestSchema satisfies z.ZodType<Wire<RequestPayload<'skill.read'>>>

/** skill.read response value. */
export const skillReadValueSchema = z.object({
  skill: managedSkillSchema.optional(),
}) satisfies z.ZodType<Wire<ResponseValue<'skill.read'>>>

/** skill.save request payload. */
export const skillSaveRequestSchema = z.object({
  sessionId: sessionIdSchema,
  name: z.string().min(1),
  content: z.string().min(1),
  scope: z.enum(['user', 'project', 'agents']),
  replace: z.boolean().optional(),
  force: z.boolean().optional(),
}) satisfies z.ZodType<Wire<RequestPayload<'skill.save'>>>

/** skill.save response value. */
export const skillSaveValueSchema = z.object({
  result: saveSkillResultSchema,
}) satisfies z.ZodType<Wire<ResponseValue<'skill.save'>>>

/** skill.remove request payload. */
export const skillRemoveRequestSchema = nameRequestSchema satisfies z.ZodType<Wire<RequestPayload<'skill.remove'>>>

/** skill.remove response value. */
export const skillRemoveValueSchema = z.object({}) satisfies z.ZodType<Wire<ResponseValue<'skill.remove'>>>

/** skill.restore request payload. */
export const skillRestoreRequestSchema = nameRequestSchema satisfies z.ZodType<Wire<RequestPayload<'skill.restore'>>>

/** skill.restore response value. */
export const skillRestoreValueSchema = z.object({}) satisfies z.ZodType<Wire<ResponseValue<'skill.restore'>>>

/** skill.permanentDelete request payload. */
export const skillPermanentDeleteRequestSchema = nameRequestSchema satisfies z.ZodType<Wire<RequestPayload<'skill.permanentDelete'>>>

/** skill.permanentDelete response value. */
export const skillPermanentDeleteValueSchema = z.object({}) satisfies z.ZodType<Wire<ResponseValue<'skill.permanentDelete'>>>

/** skill.trash request payload. */
export const skillTrashRequestSchema = z.object({
  sessionId: sessionIdSchema,
}) satisfies z.ZodType<Wire<RequestPayload<'skill.trash'>>>

/** skill.trash response value. */
export const skillTrashValueSchema = z.object({
  entries: z.array(trashEntrySchema),
}) satisfies z.ZodType<Wire<ResponseValue<'skill.trash'>>>

/** skill.setEnabled request payload. */
export const skillSetEnabledRequestSchema = z.object({
  sessionId: sessionIdSchema,
  name: z.string().min(1),
  enabled: z.boolean(),
}) satisfies z.ZodType<Wire<RequestPayload<'skill.setEnabled'>>>

/** skill.setEnabled response value. */
export const skillSetEnabledValueSchema = z.object({}) satisfies z.ZodType<Wire<ResponseValue<'skill.setEnabled'>>>

/** skill.versions request payload. */
export const skillVersionsRequestSchema = nameRequestSchema satisfies z.ZodType<Wire<RequestPayload<'skill.versions'>>>

/** skill.versions response value. */
export const skillVersionsValueSchema = z.object({
  versions: z.array(skillVersionSchema),
}) satisfies z.ZodType<Wire<ResponseValue<'skill.versions'>>>

/** skill.rollback request payload. */
export const skillRollbackRequestSchema = z.object({
  sessionId: sessionIdSchema,
  name: z.string().min(1),
  version: z.string().min(1),
}) satisfies z.ZodType<Wire<RequestPayload<'skill.rollback'>>>

/** skill.rollback response value. */
export const skillRollbackValueSchema = z.object({
  activeVersion: z.string(),
}) satisfies z.ZodType<Wire<ResponseValue<'skill.rollback'>>>

/** skill.validate request payload. */
export const skillValidateRequestSchema = z.object({
  content: z.string().min(1),
}) satisfies z.ZodType<Wire<RequestPayload<'skill.validate'>>>

/** skill.validate response value. */
export const skillValidateValueSchema = z.object({
  ok: z.boolean(),
  reason: z.string().optional(),
}) satisfies z.ZodType<Wire<ResponseValue<'skill.validate'>>>

/** skill.securityCheck request payload. */
export const skillSecurityCheckRequestSchema = z.object({
  content: z.string().min(1),
}) satisfies z.ZodType<Wire<RequestPayload<'skill.securityCheck'>>>

/** skill.securityCheck response value. */
export const skillSecurityCheckValueSchema = securityVerdictSchema satisfies z.ZodType<Wire<ResponseValue<'skill.securityCheck'>>>

/** skill.benchmarkStart request payload. */
export const skillBenchmarkStartRequestSchema = z.object({
  sessionId: sessionIdSchema,
  name: z.string().min(1),
  taskModel: modelRouteSchema,
  evaluatorModel: modelRouteSchema.optional(),
  caseCount: z.number().int().min(1).max(10).optional(),
}) satisfies z.ZodType<Wire<RequestPayload<'skill.benchmarkStart'>>>

/** skill.benchmarkStart response value. */
export const skillBenchmarkStartValueSchema = z.object({
  run: benchmarkRunSchema,
}) satisfies z.ZodType<Wire<ResponseValue<'skill.benchmarkStart'>>>

/** skill.benchmarkPoll request payload. */
export const skillBenchmarkPollRequestSchema = z.object({
  runId: z.string().min(1),
}) satisfies z.ZodType<Wire<RequestPayload<'skill.benchmarkPoll'>>>

/** skill.benchmarkPoll response value. */
export const skillBenchmarkPollValueSchema = z.object({
  run: benchmarkRunSchema,
}) satisfies z.ZodType<Wire<ResponseValue<'skill.benchmarkPoll'>>>

/** skill.benchmarkCancel request payload. */
export const skillBenchmarkCancelRequestSchema = z.object({
  runId: z.string().min(1),
}) satisfies z.ZodType<Wire<RequestPayload<'skill.benchmarkCancel'>>>

/** skill.benchmarkCancel response value. */
export const skillBenchmarkCancelValueSchema = z.object({
  run: benchmarkRunSchema,
}) satisfies z.ZodType<Wire<ResponseValue<'skill.benchmarkCancel'>>>

/** skill.benchmarkBatchStart request payload. */
export const skillBenchmarkBatchStartRequestSchema = z.object({
  sessionId: sessionIdSchema,
  names: z.array(z.string().min(1)).min(1),
  taskModel: modelRouteSchema,
  evaluatorModel: modelRouteSchema.optional(),
  caseCount: z.number().int().min(1).max(10).optional(),
}) satisfies z.ZodType<Wire<RequestPayload<'skill.benchmarkBatchStart'>>>

/** skill.benchmarkBatchStart response value. */
export const skillBenchmarkBatchStartValueSchema = z.object({
  runs: z.array(benchmarkRunSchema),
}) satisfies z.ZodType<Wire<ResponseValue<'skill.benchmarkBatchStart'>>>

/** skill.autoImprove request payload. */
export const skillAutoImproveRequestSchema = z.object({
  sessionId: sessionIdSchema,
  name: z.string().min(1),
  taskModel: modelRouteSchema,
  evaluatorModel: modelRouteSchema.optional(),
  caseCount: z.number().int().min(1).max(10).optional(),
  maxIterations: z.number().int().min(1).optional(),
  minImprovementPercent: z.number().min(0).optional(),
  stopOnRegression: z.boolean().optional(),
}) satisfies z.ZodType<Wire<RequestPayload<'skill.autoImprove'>>>

/** skill.autoImprove response value. */
export const skillAutoImproveValueSchema = z.object({
  run: benchmarkRunSchema,
}) satisfies z.ZodType<Wire<ResponseValue<'skill.autoImprove'>>>
