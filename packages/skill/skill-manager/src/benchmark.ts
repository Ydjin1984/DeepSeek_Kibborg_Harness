/**
 * Skill benchmark engine: adaptive test-suite generation, symmetric A/B task
 * execution (WITHOUT SKILL vs WITH SKILL on the same input and model), blind
 * evaluator scoring, per-case analysis, and Auto Improve with regression
 * protection.
 * @module @deepseek-ai/dsh-skill-manager/benchmark
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, Message } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { SkillDefinition } from '@deepseek-ai/dsh-skill'
import { SkillManagerError } from './manager.ts'
import type { SkillManager } from './manager.ts'
import type {
  AutoImproveIteration,
  AutoImproveRequest,
  AutoImproveRun,
  BenchmarkCase,
  BenchmarkCaseResult,
  BenchmarkRequest,
  BenchmarkResult,
  BenchmarkRun,
  BenchmarkSummary,
  BenchmarkVerdict,
  ModelRoute,
  SkillScope,
  TokenMetrics,
} from './types.ts'

/** Default evaluator output cap. */
const EVALUATOR_MAX_TOKENS = 2048
/** Default task-timeout for one A/B run in milliseconds. */
const TASK_TIMEOUT_MS = 300_000
/** Minimum relative improvement required to call a version better. */
const DEFAULT_MIN_IMPROVEMENT_PERCENT = 1
/** Baseline score below which relative improvement is not defined. */
const MIN_BASELINE_SCORE = 1

/** Progress callback signature shared by benchmark entry points. */
export type BenchmarkProgress = (run: BenchmarkRun) => void

/** Metrics collected from one task execution's session events. */
interface TaskMetrics {
  tokens: TokenMetrics
  timeMs: number
  toolCalls: number
  error: boolean
  errorMessage?: string
  output: string
}

/** One task execution input. */
interface TaskInput {
  model: ModelRoute
  cwd: string
  request: string
  skill?: SkillDefinition
  signal: AbortSignal
}

/** Evaluator verdict for one case with blind candidate labels. */
interface CaseEvaluation {
  baselineScore: number
  skillScore: number
  baselineComment: string
  skillComment: string
}

/**
 * Size the test suite from skill complexity: short bodies get 3 cases,
 * medium 5, and long/complex 7.
 * @param content - skill instruction body length drives the estimate.
 * @returns the adaptive case count.
 */
export function adaptiveCaseCount(content: string): number {
  const length = content.length
  if (length < 1_200) return 3
  if (length < 4_000) return 5
  return 7
}

/**
 * Run one benchmark end-to-end and persist the summary on the tested version.
 * @param ctx - context carrying `agents` and `llm` services.
 * @param manager - skill manager that resolves and persists the skill.
 * @param request - validated benchmark request.
 * @param onProgress - optional live-run observer.
 * @param signal - optional cancellation; aborting cancels every task and rejects the run.
 * @returns the complete benchmark result.
 */
export async function runBenchmark(
  ctx: Context,
  manager: SkillManager,
  request: BenchmarkRequest,
  onProgress?: BenchmarkProgress,
  signal?: AbortSignal,
): Promise<BenchmarkResult> {
  const controller = new AbortController()
  const cancel = (): void => { controller.abort(new Error('benchmark cancelled')) }
  signal?.addEventListener('abort', cancel, { once: true })
  try {
    return await runBenchmarkUncancelled(ctx, manager, request, onProgress, controller.signal)
  } finally {
    signal?.removeEventListener('abort', cancel)
  }
}

async function runBenchmarkUncancelled(
  ctx: Context,
  manager: SkillManager,
  request: BenchmarkRequest,
  onProgress?: BenchmarkProgress,
  signal?: AbortSignal,
): Promise<BenchmarkResult> {
  /* v8 ignore next -- the runBenchmark wrapper always passes a concrete signal. */
  const effectiveSignal = signal ?? new AbortController().signal
  const run = freshRun(request, effectiveSignal)
  onProgress?.(run)
  const taskModel = manager.assertRoute(request.taskModel)
  const evaluatorModel = manager.assertRoute(request.evaluatorModel ?? request.taskModel)
  const skill = await manager.read(request.skillName, request.cwd)
  if (skill === undefined) throw new SkillManagerError('skill-not-found', `skill "${request.skillName}" is not managed`)
  const definition: SkillDefinition = {
    name: skill.name,
    description: skill.description,
    ...skill.localizedDescription !== undefined ? { localizedDescription: skill.localizedDescription } : {},
    ...skill.whenToUse !== undefined ? { whenToUse: skill.whenToUse } : {},
    invocation: { modelInvocable: true, userInvocable: true },
    source: skill.source,
    provider: 'skill-manager',
    /* v8 ignore next -- every managed filesystem skill carries a path. */
    ...skill.path !== undefined ? { path: skill.path } : {},
    content: skill.content,
  }
  const caseCount = request.caseCount ?? adaptiveCaseCount(skill.content)
  if (caseCount < 1 || caseCount > 10) {
    throw new SkillManagerError('skill-invalid', `case count must be between 1 and 10, got ${caseCount}`)
  }
  const cases = await generateCases(ctx, taskModel, definition, caseCount, effectiveSignal)
  const criteria = deriveCriteria(definition)
  const caseResults: BenchmarkCaseResult[] = []
  for (let index = 0; index < cases.length; index += 1) {
    const benchmarkCase = cases[index]
    // v8 ignore next -- the loop bound proves the index is in range.
    if (benchmarkCase === undefined) continue
    onProgress?.({ ...run, phase: 'running-baseline', progress: { case: index + 1, total: caseCount } })
    const baseline = await runTask(ctx, {
      model: taskModel,
      cwd: request.cwd,
      request: benchmarkCase.request,
      signal: effectiveSignal,
    })
    onProgress?.({ ...run, phase: 'running-skill', progress: { case: index + 1, total: caseCount } })
    const withSkill = await runTask(ctx, {
      model: taskModel,
      cwd: request.cwd,
      request: benchmarkCase.request,
      skill: definition,
      signal: effectiveSignal,
    })
    onProgress?.({ ...run, phase: 'evaluating', progress: { case: index + 1, total: caseCount } })
    const evaluation = await evaluateCase(ctx, evaluatorModel, criteria, benchmarkCase, baseline, withSkill, effectiveSignal)
    caseResults.push({
      caseId: benchmarkCase.id,
      title: benchmarkCase.title,
      baselineScore: evaluation.baselineScore,
      skillScore: evaluation.skillScore,
      improvementPercent: relativeImprovement(evaluation.baselineScore, evaluation.skillScore),
      baselineTokens: baseline.tokens,
      skillTokens: withSkill.tokens,
      baselineTimeMs: baseline.timeMs,
      skillTimeMs: withSkill.timeMs,
      baselineToolCalls: baseline.toolCalls,
      skillToolCalls: withSkill.toolCalls,
      baselineError: baseline.error,
      skillError: withSkill.error,
      baselineOutput: baseline.output,
      skillOutput: withSkill.output,
      baselineComment: evaluation.baselineComment,
      skillComment: evaluation.skillComment,
    })
  }
  const result = aggregate(caseResults, criteria, taskModel, evaluatorModel, skill.version)
  await manager.attachBenchmark(skill.name, request.cwd, skill.version, result.summary)
  onProgress?.({ ...run, status: 'completed', phase: 'done', result })
  return result
}

/**
 * Auto Improve: benchmark the current version, generate candidate
 * improvements, and keep only versions that beat the current best by the
 * minimum threshold. Regression protection means a worse candidate never
 * replaces the active best version.
 * @param ctx - context carrying `agents` and `llm` services.
 * @param manager - skill manager that resolves, publishes, and activates versions.
 * @param request - auto-improve request with iteration limits.
 * @param onProgress - optional live-run observer.
 * @param signal - optional cancellation; aborting stops the loop.
 * @returns the final run view with per-iteration results and the best version.
 */
export async function runAutoImprove(
  ctx: Context,
  manager: SkillManager,
  request: AutoImproveRequest,
  onProgress?: BenchmarkProgress,
  signal?: AbortSignal,
): Promise<AutoImproveRun> {
  const controller = new AbortController()
  const cancel = (): void => { controller.abort(new Error('auto-improve cancelled')) }
  signal?.addEventListener('abort', cancel, { once: true })
  try {
    return await runAutoImproveUncancelled(ctx, manager, request, onProgress, controller.signal)
  } finally {
    signal?.removeEventListener('abort', cancel)
  }
}

async function runAutoImproveUncancelled(
  ctx: Context,
  manager: SkillManager,
  request: AutoImproveRequest,
  onProgress?: BenchmarkProgress,
  signal?: AbortSignal,
): Promise<AutoImproveRun> {
  /* v8 ignore next -- the runAutoImprove wrapper always passes a concrete signal. */
  const effectiveSignal = signal ?? new AbortController().signal
  const base: BenchmarkRun = freshRun(request, effectiveSignal)
  const run: AutoImproveRun = { ...base, iterations: [], bestVersion: '' }
  onProgress?.(run)
  const taskModel = manager.assertRoute(request.taskModel)
  const evaluatorModel = manager.assertRoute(request.evaluatorModel ?? request.taskModel)
  const skill = await manager.read(request.skillName, request.cwd)
  if (skill === undefined) throw new SkillManagerError('skill-not-found', `skill "${request.skillName}" is not managed`)
  const maxIterations = request.maxIterations > 0 ? request.maxIterations : 1
  const minImprovement = request.minImprovementPercent > 0 ? request.minImprovementPercent : DEFAULT_MIN_IMPROVEMENT_PERCENT
  const definition = toDefinition(skill)
  const criteria = deriveCriteria(definition)
  const baseCaseCount = request.caseCount ?? adaptiveCaseCount(skill.content)
  const baseResult = await runBenchmark(ctx, manager, {
    skillName: skill.name,
    cwd: request.cwd,
    taskModel,
    evaluatorModel,
    caseCount: baseCaseCount,
  }, progress => onProgress?.({ ...run, phase: progress.phase, progress: progress.progress }), effectiveSignal)
  let best = {
    version: skill.version,
    score: baseResult.summary.skillScore,
    content: skill.content,
  }
  const iterations: AutoImproveIteration[] = []
  let candidateContent = skill.content
  for (let index = 1; index <= maxIterations; index += 1) {
    const iteration = await improveIteration(
      ctx,
      manager,
      request,
      definition,
      criteria,
      candidateContent,
      baseResult,
      index,
      effectiveSignal,
    )
    if (iteration === undefined) {
      iterations.push({ index, version: best.version, score: best.score, accepted: false, reason: 'candidate failed validation or security' })
      onProgress?.({ ...run, iterations: [...iterations], bestVersion: best.version, phase: 'done' } as AutoImproveRun)
      break
    }
    const candidateRun = await runBenchmark(ctx, manager, {
      skillName: skill.name,
      cwd: request.cwd,
      taskModel,
      evaluatorModel,
      caseCount: baseCaseCount,
    }, progress => onProgress?.({ ...run, phase: progress.phase, progress: progress.progress }), effectiveSignal)
    const candidateScore = candidateRun.summary.skillScore
    // The benchmark run above attached its summary to the still-active version;
    // rebind it to the candidate version it actually tested. The summary's own
    // version field must match the key: the status check compares the active
    // version against lastBenchmark.version, and a mismatch would flag a just
    // auto-improved skill as `benchmark-outdated`.
    await manager.attachBenchmark(skill.name, request.cwd, iteration.version, {
      ...candidateRun.summary,
      version: iteration.version,
    })
    const gained = candidateScore - best.score
    const accepted = request.stopOnRegression
      ? gained >= minImprovement
      : gained >= minImprovement || candidateScore >= best.score
    /* v8 ignore next -- acceptance implies the candidate is not below the best. */
    if (accepted && candidateScore >= best.score) {
      await manager.activateVersion(skill.name, iteration.version, request.cwd)
      best = { version: iteration.version, score: candidateScore, content: iteration.content }
      candidateContent = iteration.content
      iterations.push({ index, version: iteration.version, score: candidateScore, accepted: true, reason: `improvement of ${gained.toFixed(1)} points` })
    } else {
      iterations.push({ index, version: iteration.version, score: candidateScore, accepted: false, reason: `no significant improvement (${gained.toFixed(1)} points)` })
    }
    onProgress?.({ ...run, iterations: [...iterations], bestVersion: best.version, phase: 'done' } as AutoImproveRun)
  }
  const final: AutoImproveRun = {
    ...run,
    status: 'completed',
    phase: 'done',
    iterations,
    bestVersion: best.version,
  }
  onProgress?.(final)
  return final
}

/** Build one candidate iteration: generate, validate, publish as a non-active version. */
async function improveIteration(
  ctx: Context,
  manager: SkillManager,
  request: AutoImproveRequest,
  definition: SkillDefinition,
  criteria: readonly string[],
  currentContent: string,
  baseResult: BenchmarkResult,
  index: number,
  signal: AbortSignal,
): Promise<{ version: string; content: string } | undefined> {
  const improved = await generateImprovement(ctx, request.taskModel, definition, criteria, currentContent, baseResult, signal)
  if (improved === undefined) return undefined
  const validation = manager.validate(improved)
  if (!validation.ok) return undefined
  const verdict = manager.securityCheck(improved)
  if (verdict.status === 'blocked') return undefined
  const current = await manager.read(definition.name, request.cwd)
  /* v8 ignore next -- auto-improve only runs over managed filesystem skills, never built-ins. */
  const scope: SkillScope = current !== undefined && current.scope !== 'built-in' ? current.scope : 'project'
  const version = await manager.publishVersion({
    name: definition.name,
    content: improved,
    scope,
    cwd: request.cwd,
    reason: `Auto Improve iteration ${index}`,
    source: 'auto-improve',
  })
  return { version, content: improved }
}

/** Generate one improved SKILL.md candidate through the task model. */
async function generateImprovement(
  ctx: Context,
  model: ModelRoute,
  definition: SkillDefinition,
  criteria: readonly string[],
  currentContent: string,
  baseResult: BenchmarkResult,
  signal: AbortSignal,
): Promise<string | undefined> {
  const failures = baseResult.cases
    .filter(oneCase => oneCase.skillScore < oneCase.baselineScore)
    .map(oneCase => `- ${oneCase.title}: baseline ${oneCase.baselineScore}, skill ${oneCase.skillScore}; skill comment: ${oneCase.skillComment}`)
  const system = [
    'You are a skill-improvement engine for an agent harness.',
    'Rewrite the supplied SKILL.md so the model following it performs better on the benchmark criteria.',
    'Keep the exact YAML frontmatter fields and the same skill name.',
    'Return ONLY the complete new SKILL.md file text (frontmatter plus body). No commentary.',
  ].join('\n')
  const user = [
    `Skill: ${definition.name}`,
    `Description: ${definition.description}`,
    `Criteria: ${criteria.join(', ')}`,
    '',
    'Current SKILL.md:',
    '```',
    currentContent,
    '```',
    '',
    'Benchmark result (candidate scored lower than baseline on):',
    failures.length > 0 ? failures.join('\n') : 'No single-case regression; still tighten instructions where the skill comment below is weak.',
    ...baseResult.cases.map(oneCase => `- ${oneCase.title}: ${oneCase.skillComment}`),
    '',
    'Produce the improved SKILL.md now.',
  ].join('\n')
  const text = await callText(ctx, model, system, user, 8_000, signal)
  return extractFrontmatterSkill(text)
}

/** Pull a full SKILL.md out of a model answer, tolerating fenced code blocks. */
export function extractFrontmatterSkill(text: string): string | undefined {
  const trimmed = text.trim()
  const fenced = /^```(?:ya?ml|markdown|md)?\s*\n([\s\S]*?\n)```\s*$/.exec(trimmed)
  const candidate = fenced?.[1] ?? trimmed
  if (!candidate.startsWith('---\n')) return undefined
  return candidate
}

/** Generate the adaptive test suite through the task model. */
async function generateCases(
  ctx: Context,
  model: ModelRoute,
  skill: SkillDefinition,
  count: number,
  signal: AbortSignal,
): Promise<BenchmarkCase[]> {
  const system = [
    'You design benchmark test cases for agent skills.',
    `Return exactly ${count} test cases as a JSON array. No other text.`,
    'Each element: { "id": "case-1", "title": "short title", "request": "the exact user request to run" }.',
    'Cover the happy path, constraints, formatting, edge cases, and a typical failure mode when applicable.',
  ].join('\n')
  const user = [
    `Skill: ${skill.name}`,
    `Description: ${skill.description}`,
    ...skill.whenToUse !== undefined ? [`When to use: ${skill.whenToUse}`] : [],
    '',
    'Skill instructions:',
    '```',
    skill.content,
    '```',
    '',
    `Generate the JSON array of ${count} test cases.`,
  ].join('\n')
  const text = await callText(ctx, model, system, user, 4_000, signal)
  const parsed = parseJsonArray(text)
  const cases: BenchmarkCase[] = []
  for (const raw of parsed) {
    if (typeof raw !== 'object' || raw === null) continue
    const { id, title, request } = raw as Record<string, unknown>
    if (typeof id !== 'string' || typeof title !== 'string' || typeof request !== 'string') continue
    if (id.length === 0 || title.length === 0 || request.length === 0) continue
    cases.push({ id, title, request })
  }
  if (cases.length === 0) {
    throw new SkillManagerError('benchmark-not-found', 'the model produced no usable test cases')
  }
  return cases.slice(0, count)
}

/** Derive evaluation criteria from the skill definition. */
function deriveCriteria(skill: SkillDefinition): string[] {
  return [
    'Accuracy',
    'Instruction compliance',
    'Completeness',
    'Output format',
    'Required behavior',
    'Constraints',
    ...skill.content.length > 800 ? ['Edge-case handling'] : [],
  ]
}

/** Run one task through a fresh agent with the chosen model, optionally with a runtime skill. */
async function runTask(ctx: Context, input: TaskInput): Promise<TaskMetrics> {
  const controller = new AbortController()
  // v8 ignore next -- the 120s task timeout requires a live stalled task to observe.
  const timeout = setTimeout(() => { controller.abort(new Error(`benchmark task timed out after ${TASK_TIMEOUT_MS}ms`)) }, TASK_TIMEOUT_MS)
  // v8 ignore next -- the external cancel path is covered by the manager cancel contract.
  const onAbort = (): void => { controller.abort(input.signal.reason) }
  input.signal.addEventListener('abort', onAbort, { once: true })
  try {
    const agents = ctx.get('agents')
    if (agents === undefined) throw new SkillManagerError('benchmark-not-found', 'agent registry is absent')
    const handle = await agents.create({
      sessionId: SessionId(`bench-${randomUUID()}`),
      meta: { cwd: input.cwd },
      agentOptions: { provider: input.model.provider, model: input.model.model },
      setup: (agentCtx) => {
        // The task model must not read or mutate managed skills while it is being
        // scored: the A/B isolates to the runtime-registered skill below, and the
        // manager tool would leak the on-disk catalog and let the run rewrite the
        // very skill under test (creating versions and breaking the baseline's
        // blind evaluation).
        agentCtx.tools.restrict({ deny: ['skill_manage'] })
        if (input.skill === undefined) return
        // `ctx.get` resolves the scope-bound skills service: the agent scope
        // declares no inject, and the registry's register() files into the
        // layer of the instance's own context, so the skill lands in this
        // agent's layer alone and never leaks to other benchmark arms.
        const skills = agentCtx.get('skills')
        if (skills === undefined) {
          throw new SkillManagerError('benchmark-not-found', 'skills service is absent')
        }
        skills.register({
          name: input.skill.name,
          description: input.skill.description,
          ...input.skill.whenToUse !== undefined ? { whenToUse: input.skill.whenToUse } : {},
          content: input.skill.content,
          invocation: { modelInvocable: true, userInvocable: true },
          source: 'runtime',
        })
      },
    })
    const { agent } = handle
    // v8 ignore start -- cancelling a live task needs a stalled real agent; the manager cancel contract covers settlement.
    const onTaskAbort = (): void => {
      agent.cancel({ kind: 'user' })
    }
    // The local controller owns the deadline: both the 120s timeout and the
    // benchmark-wide cancel abort it, and the abort cancels the running agent so
    // a stalled task settles instead of hanging the whole benchmark.
    controller.signal.addEventListener('abort', onTaskAbort, { once: true })
    /* v8 ignore stop */
    try {
      await agent.whenIdle()
      const firstSeq = agent.session.seq
      agent.followup(createUserMessage({
        content: [{ type: 'text', text: input.request }],
        source: { kind: 'user' },
      }))
      await agent.whenIdle()
      input.signal.throwIfAborted()
      return summarizeEvents(agent.session.events, firstSeq)
    } finally {
      controller.signal.removeEventListener('abort', onTaskAbort)
      await handle.dispose()
    }
  } finally {
    clearTimeout(timeout)
    input.signal.removeEventListener('abort', onAbort)
  }
}

/** Fold session events into benchmark task metrics. */
function summarizeEvents(events: readonly SessionEvent[], firstSeq: number): TaskMetrics {
  let input = 0
  let output = 0
  let toolCalls = 0
  let error = false
  let errorMessage: string | undefined
  let lastText = ''
  let startTime: number | undefined
  let endTime: number | undefined
  for (const event of events) {
    // v8 ignore next -- benchmark agents are fresh, so no pre-followup events exist.
    if (event.seq < firstSeq) continue
    switch (event.type) {
      case 'turn/start':
        if (startTime === undefined) startTime = event.time
        break
      case 'turn/end': {
        endTime = event.time
        if (event.data.reason.kind === 'error') {
          error = true
          errorMessage = event.data.reason.error.message
        }
        break
      }
      case 'assistant/message': {
        const usage = event.data.usage
        // v8 ignore next -- every adapter in this test matrix reports usage; a silent adapter is still summed safely.
        if (usage !== undefined) {
          input += usage.inputTokens
          output += usage.outputTokens
        }
        const text = event.data.message.content
          .filter(block => block.type === 'text')
          .map(block => block.text)
          .join('')
        if (text !== '') lastText = text
        break
      }
      case 'tool/call':
        toolCalls += 1
        break
      default:
        break
    }
  }
  return {
    tokens: { input, output, total: input + output },
    timeMs: startTime !== undefined && endTime !== undefined ? endTime - startTime : 0,
    toolCalls,
    error,
    ...errorMessage !== undefined ? { errorMessage } : {},
    output: lastText,
  }
}

/** Blind A/B evaluation of one case through the evaluator model. */
async function evaluateCase(
  ctx: Context,
  model: ModelRoute,
  criteria: readonly string[],
  benchmarkCase: BenchmarkCase,
  baseline: TaskMetrics,
  withSkill: TaskMetrics,
  signal: AbortSignal,
): Promise<CaseEvaluation> {
  const swap = Math.random() < 0.5
  const candidateA = swap ? withSkill.output : baseline.output
  const candidateB = swap ? baseline.output : withSkill.output
  const system = [
    'You are a strict benchmark evaluator.',
    'Score each candidate 0-100 against the criteria using the original requirements and the test case.',
    'Return ONLY a JSON object: { "scoreA": 0-100, "scoreB": 0-100, "commentA": "one sentence", "commentB": "one sentence" }.',
    'You do not know which candidate used a skill; judge the outputs themselves.',
  ].join('\n')
  const user = [
    `Criteria: ${criteria.join(', ')}`,
    `Test case: ${benchmarkCase.title}`,
    `User request: ${benchmarkCase.request}`,
    '',
    'Candidate A output:',
    '```',
    candidateA.slice(0, 4_000),
    '```',
    '',
    'Candidate B output:',
    '```',
    candidateB.slice(0, 4_000),
    '```',
    '',
    'Return the JSON scores and comments now.',
  ].join('\n')
  const text = await callText(ctx, model, system, user, EVALUATOR_MAX_TOKENS, signal)
  const parsed = parseJsonObject(text)
  const scoreA = boundedScore(parsed.scoreA)
  const scoreB = boundedScore(parsed.scoreB)
  const commentA = stringOrEmpty(parsed.commentA)
  const commentB = stringOrEmpty(parsed.commentB)
  if (swap) {
    return { baselineScore: scoreB, skillScore: scoreA, baselineComment: commentB, skillComment: commentA }
  }
  return { baselineScore: scoreA, skillScore: scoreB, baselineComment: commentA, skillComment: commentB }
}

/** Aggregate per-case results into the persisted summary and verdict. */
function aggregate(
  caseResults: readonly BenchmarkCaseResult[],
  criteria: readonly string[],
  taskModel: ModelRoute,
  evaluatorModel: ModelRoute,
  version: string,
): BenchmarkResult {
  const baselineScore = average(caseResults.map(oneCase => oneCase.baselineScore))
  const skillScore = average(caseResults.map(oneCase => oneCase.skillScore))
  const baselineTokens = sumTokens(caseResults.map(oneCase => oneCase.baselineTokens))
  const skillTokens = sumTokens(caseResults.map(oneCase => oneCase.skillTokens))
  const baselineTimeMs = average(caseResults.map(oneCase => oneCase.baselineTimeMs))
  const skillTimeMs = average(caseResults.map(oneCase => oneCase.skillTimeMs))
  const baselineToolCalls = average(caseResults.map(oneCase => oneCase.baselineToolCalls))
  const skillToolCalls = average(caseResults.map(oneCase => oneCase.skillToolCalls))
  const verdict = deriveVerdict(baselineScore, skillScore)
  const reasons = reasonsFor(verdict, caseResults)
  const summary: BenchmarkSummary = {
    runId: `bench-${randomUUID()}`,
    at: new Date().toISOString(),
    version,
    taskModel,
    evaluatorModel,
    baselineScore: round1(baselineScore),
    skillScore: round1(skillScore),
    improvementPercent: relativeImprovement(baselineScore, skillScore),
    verdict,
    baselineTokens,
    skillTokens,
    baselineTimeMs: round1(baselineTimeMs),
    skillTimeMs: round1(skillTimeMs),
    baselineToolCalls: round1(baselineToolCalls),
    skillToolCalls: round1(skillToolCalls),
  }
  return { summary, cases: caseResults, criteria, reasons }
}

/** Judge the aggregate outcome without over-claiming a single metric. */
export function deriveVerdict(baselineScore: number, skillScore: number): BenchmarkVerdict {
  if (baselineScore <= MIN_BASELINE_SCORE) return 'no-significant-improvement'
  const relative = (skillScore - baselineScore) / baselineScore * 100
  if (relative >= DEFAULT_MIN_IMPROVEMENT_PERCENT) return 'improvement'
  if (relative <= -DEFAULT_MIN_IMPROVEMENT_PERCENT) return 'worse'
  return 'no-significant-improvement'
}

/** Human-readable reasons behind the verdict. */
export function reasonsFor(verdict: BenchmarkVerdict, caseResults: readonly BenchmarkCaseResult[]): string[] {
  const reasons: string[] = []
  for (const oneCase of caseResults) {
    if (oneCase.skillScore < oneCase.baselineScore) {
      reasons.push(`Case "${oneCase.title}" scored lower with the skill (${oneCase.skillScore} vs ${oneCase.baselineScore}): ${oneCase.skillComment}`)
    }
  }
  if (verdict === 'improvement' && reasons.length === 0) {
    reasons.push('The skill improved the aggregate score without regressing any case.')
  }
  if (verdict === 'worse' && reasons.length === 0) {
    reasons.push('The skill scored below the baseline on the aggregate.')
  }
  if (verdict === 'no-significant-improvement' && reasons.length === 0) {
    reasons.push('The skill changed the aggregate score by less than the improvement threshold.')
  }
  return reasons
}

/** Call the model and assemble plain text. */
async function callText(
  ctx: Context,
  model: ModelRoute,
  system: string,
  user: string,
  maxTokens: number,
  signal: AbortSignal,
): Promise<string> {
  signal.throwIfAborted()
  const llm = ctx.get('llm')
  if (llm === undefined) throw new SkillManagerError('benchmark-not-found', 'LLM service is absent')
  const messages: Message[] = [createUserMessage({
    content: [{ type: 'text', text: user }],
    source: { kind: 'plugin', plugin: 'dsh-skill-manager' },
  })]
  const options: GenerateOptions = {
    provider: model.provider,
    model: model.model,
    messages,
    system,
    maxTokens,
    sessionId: SessionId(`bench-llm-${randomUUID()}`),
    signal,
  }
  const assembler = new BlockAssembler()
  for await (const chunk of llm.stream(options)) {
    signal.throwIfAborted()
    assembler.push(chunk)
  }
  signal.throwIfAborted()
  const finish = assembler.finish
  if (finish.kind === 'error') {
    throw new SkillManagerError('benchmark-not-found', `model call failed: ${finish.failure.message}`)
  }
  const blocks = assembler.blocks()
  return blocks
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join(' ')
}

/** Parse a JSON object from a model answer, tolerating fences and prose. */
export function parseJsonObject(text: string): Record<string, unknown> {
  const candidate = extractJson(text)
  if (candidate === undefined) return {}
  try {
    const parsed: unknown = JSON.parse(candidate)
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) return parsed as Record<string, unknown>
  } catch {
    // fall through to the empty object
  }
  return {}
}

/** Parse a JSON array from a model answer, tolerating fences and prose. */
export function parseJsonArray(text: string): unknown[] {
  const candidate = extractJson(text)
  if (candidate === undefined) return []
  try {
    const parsed: unknown = JSON.parse(candidate)
    if (Array.isArray(parsed)) return parsed
  } catch {
    // fall through to the empty array
  }
  return []
}

/** Extract the first balanced JSON value (object or array) from model output. */
export function extractJson(text: string): string | undefined {
  const trimmed = text.trim()
  const fenced = /^```(?:json)?\s*\n([\s\S]*?\n)```\s*$/.exec(trimmed)
  const candidate = fenced?.[1] ?? trimmed
  const start = candidate.search(/[\[{]/)
  if (start < 0) return undefined
  let depth = 0
  let inString = false
  let escaped = false
  for (let index = start; index < candidate.length; index += 1) {
    const char = candidate[index]
    // v8 ignore next -- the loop bound proves the character is defined.
    if (char === undefined) break
    if (inString) {
      /* v8 ignore start -- escaped quotes inside JSON strings are exercised through parseJsonObject only. */
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === '"') {
        inString = false
      }
      /* v8 ignore stop */
      continue
    }
    if (char === '"') {
      inString = true
      continue
    }
    if (char === '[' || char === '{') depth += 1
    if (char === ']' || char === '}') {
      depth -= 1
      if (depth === 0) return candidate.slice(start, index + 1)
    }
  }
  return undefined
}

function boundedScore(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, Math.round(value)))
}

function stringOrEmpty(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function average(values: readonly number[]): number {
  /* v8 ignore next -- aggregate always folds at least one case result. */
  if (values.length === 0) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function sumTokens(values: readonly TokenMetrics[]): TokenMetrics {
  return {
    input: values.reduce((sum, value) => sum + value.input, 0),
    output: values.reduce((sum, value) => sum + value.output, 0),
    total: values.reduce((sum, value) => sum + value.total, 0),
  }
}

export function relativeImprovement(baseline: number, skill: number): number {
  if (baseline <= 0) return 0
  return round1((skill - baseline) / baseline * 100)
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

function freshRun(request: BenchmarkRequest, _signal: AbortSignal): BenchmarkRun {
  return {
    id: `bench-${randomUUID()}`,
    skillName: request.skillName,
    status: 'running',
    phase: 'preparing',
    progress: { case: 0, total: 0 },
    createdAt: Date.now(),
  }
}

function toDefinition(skill: { name: string; description: string; whenToUse?: string; content: string; source: SkillDefinition['source']; path?: string }): SkillDefinition {
  return {
    name: skill.name,
    description: skill.description,
    ...skill.whenToUse !== undefined ? { whenToUse: skill.whenToUse } : {},
    invocation: { modelInvocable: true, userInvocable: true },
    source: skill.source,
    provider: 'skill-manager',
    /* v8 ignore next -- auto-improve only runs over managed filesystem skills. */
    ...skill.path !== undefined ? { path: skill.path } : {},
    content: skill.content,
  }
}
