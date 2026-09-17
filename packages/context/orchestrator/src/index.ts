/**
 * Orchestrator mode, host half.
 *
 * When enabled, the deployment splits model roles: the session's chat model
 * acts as the HEAD (planner) and delegates heavy, tool-driven work to a
 * dedicated `executor` tool that always runs on the configured LOCAL model —
 * so cloud tokens are spent on planning, not on long tool chains. A
 * system-prompt section instructs the head while the mode is on; the bundled
 * `orchestrator-head` and `orchestrator-executor` skills carry the full
 * operating protocol and are registered on `ctx.skills` as built-in runtime
 * skills for the duration of the mode, so every project that enables the mode
 * can load them through the `skill` tool.
 *
 * Configuration lives in the plugin's `orchestrator` SETTINGS NAMESPACE
 * (Settings → Models → «Оркестратор» shows the form; edits apply at runtime —
 * the tool and the prompt section read the resolved namespace on every
 * call/render). Only the LOCAL executor route is chosen there; the head role
 * is always the session's live chat model, whatever the composer picker
 * selects.
 *
 * @module @deepseek-ai/dsh-orchestrator
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { JsonValue } from '@deepseek-ai/dsh-session'
import {
  delegationDepthOf,
  type SubagentResult, type SubagentRun,
} from '@deepseek-ai/dsh-subagent'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { loadOrchestratorSkills, ORCHESTRATOR_ROI_SKILL } from './skills.ts'
import { filterHeadToolSchemas, headToolDeny } from './policy.ts'

/** CDP client shipped under the harness home; never a machine-specific user path. */
function chromeCdpClientPath(): string {
  const override = process.env.DSH_HOME?.trim()
  const root = override !== undefined && override !== '' ? override : join(homedir(), '.dsh')
  return join(root, 'chrome', 'cdp.mjs')
}

/** Tools the head planner must not call directly unless the operator empties the list. */
export const DEFAULT_HEAD_DENY_TOOLS: readonly string[] = ['grep', 'glob', 'pwsh', 'bash']

export const name = 'orchestrator'
export const inject = ['skills', 'tools', 'subagents', 'systemPrompt', 'settings']

/** The prompt-section order: after the delegation policy, before child reporting. */
const EXECUTOR_SECTION_ORDER = 116.7

/**
 * Worker names the ROI swarm hands out in order. A fixed roster is what makes a
 * multi-worker report readable: "Федя нашёл X" identifies one delegation the
 * head can follow up on, where a run id does not.
 */
export const DEFAULT_ROI_NAMES: readonly string[] = [
  'Бася', 'Петя', 'Федя', 'Гоша', 'Дуся', 'Лёша', 'Мила', 'Нюра', 'Проша', 'Роза',
  'Сеня', 'Тоша', 'Уля', 'Фома', 'Харитон', 'Циля', 'Шура', 'Юра', 'Яша', 'Ася',
]

/** Ceiling on one swarm call; a wider fan-out spends the pool faster than it returns. */
export const MAX_ROI_WORKERS = 20

/** Ceiling on extra models one swarm task may be retried on. */
export const MAX_ROI_RETRIES = 5

/** Orchestrator-mode settings surface (edited in Settings → Models → «Оркестратор»). */
export interface OrchestratorSettings {
  /** Enable the head/executor split. */
  enabled: boolean
  /** The `ctx.subagents` provider the executor tool starts runs on. */
  subagentProvider: string
  /** LLM provider route of the LOCAL executor model (e.g. `pi-ai`). */
  executorProvider: string
  /** Exact local model id the executor tool pins (e.g. the local Kiborg). */
  executorModel: string
  /**
   * Tools the HEAD planner may not call directly. While the mode is enabled
   * with a non-empty list, depth-0 assemblies omit these names from the
   * model-facing tool schema (`system-prompt/assemble`) and `tools/pre-execute`
   * denies them before approval. Delegated agents — the executor worker and
   * its children — keep the full tool set. Empty by default: the split
   * applies only to the tools listed here.
   */
  headDenyTools: string[]
  /**
   * ROI mode: run one task per worker on the FREE pooled OpenRouter models
   * instead of one task at a time on the local executor. Each worker gets its
   * own model from the pool's rotation, so a fan-out costs no paid tokens and
   * no worker waits behind another's generation.
   */
  roiEnabled: boolean
  /** Workers one swarm call may start; also the maximum number of tasks it takes. */
  roiWorkers: number
  /**
   * Extra models one task may be retried on when its model answers a rate
   * limit. Free OpenRouter models are answered from shared upstream pools, so
   * a `429` on one model says nothing about the next; retrying rotates instead
   * of failing the task the head already described.
   */
  roiRetries: number
  /** Worker names, assigned in order and reused cyclically. */
  roiNames: string[]
}

/** Namespace + schema behind the Settings → Models «Оркестратор» card. */
const NS = settingsNamespace('orchestrator')

const orchestratorSchema = z.object({
  enabled: z.boolean().default(false),
  subagentProvider: z.string().default('spawn'),
  executorProvider: z.string().default(''),
  executorModel: z.string().default(''),
  headDenyTools: z.array(z.string()).default([...DEFAULT_HEAD_DENY_TOOLS]),
  roiEnabled: z.boolean().default(false),
  roiWorkers: z.number().step(1).min(1).max(MAX_ROI_WORKERS).default(5),
  roiRetries: z.number().step(1).min(0).max(5).default(2),
  roiNames: z.array(z.string()).default([...DEFAULT_ROI_NAMES]),
})

/** One non-`completed` child stop means the delegation did not finish cleanly. */
function stopReasonError(result: SubagentResult): string | undefined {
  switch (result.stopReason) {
    case 'completed':
      return undefined
    case 'aborted':
      return 'executor run was cancelled'
    case 'error':
      return `executor run failed: ${result.diagnostic ?? 'unknown error'}`
    case 'max-tokens':
      return 'executor run hit its token limit'
    case 'refusal':
      return 'executor model refused the task'
    /* v8 ignore next -- closed union over the provider result vocabulary */
    default:
      return 'executor run ended abnormally'
  }
}

/**
 * The compact worker persona injected into every executor child. Children
 * never see the head prompt (it is suppressed for delegated depths), so this
 * section is what keeps them in the executor role. It also tells the worker
 * it has vision: the local model can open image files (read_image) and explain
 * what it sees, so the head may hand it "look at <path> and explain" tasks.
 */
function executorPersona(): string {
  return [
    'Ты — ИСПОЛНИТЕЛЬ (executor) в режиме оркестра: ты не планируешь верхнеуровневую работу',
    'и не вызываешь другие модели. Выполни выданную тебе подзадачу инструментами сам,',
    'не перекладывая шаги на других агентов, и верни сжатый структурированный отчёт.',
    'У тебя есть зрение (vision): ты можешь открывать и анализировать изображения',
    '(PNG/JPEG/WebP/GIF: скриншоты, GUI, картинки, диаграммы) инструментом чтения изображений',
    '(read_image) и объяснять, что реально на них видно. Если задание просит «посмотри»,',
    '«взгляни», «что на картинке/скриншоте» — открой файл изображения по указанному пути',
    'и опиши содержимое. Не выдумывай содержимое по имени файла или тексту и никогда',
    'не описывай изображение, которое не открывал.',
    'Для веб-задач (посмотреть страницу, вытянуть информацию, осмотреть сайт визуально)',
    'используй Chrome с DevTools Protocol на 127.0.0.1:9222 через CDP-клиент:',
    `node "${chromeCdpClientPath()}" ensure | open <url> | shot <файл.png> --tab <id>`,
    '| text | html | eval "<js>" | click "<селектор>" | wait <мс> | close --tab <id>.',
    'Визуальный осмотр сайта = скриншот (shot) + чтение изображения (read_image).',
    'Закрывай только вкладки, которые открыл сам.',
  ].join(' ')
}

/** Join text blocks of one child's durable output for the parent's result. */
function outputText(values: readonly unknown[]): string {
  return values
    .filter((value): value is { type: 'text'; text: string } =>
      typeof value === 'object' && value !== null && !Array.isArray(value)
      && (value as { type?: unknown }).type === 'text'
      && typeof (value as { text?: unknown }).text === 'string')
    .map(value => value.text)
    .join('\n')
}

/** Run one foreground executor task and dispose the run after collection. */
async function runExecutor(
  ctx: Context,
  settings: OrchestratorSettings,
  parent: Agent,
  args: { description?: string; prompt: string },
  signal: AbortSignal,
): Promise<{ runId: string; output: JsonValue[] }> {
  const provider = ctx.subagents.getProvider(settings.subagentProvider)
  const run: SubagentRun = await ctx.subagents.start(settings.subagentProvider, {
    /* v8 ignore next -- the tool schema marks `description` required, so this defensive fallback never fires through the tool boundary. */
    ...args.description === undefined ? {} : { label: args.description },
    prompt: [{ type: 'text', text: args.prompt }] as ContentBlock[],
    parent,
    agentOptions: { provider: settings.executorProvider, model: settings.executorModel },
    // The child is a worker, never another head: hide the `executor` tool from
    // it (no unbounded recursion) and cap delegated depth at one level, when
    // the chosen provider can honor those scopes. The worker persona keeps the
    // child in the executor role without the head prompt.
    ...(provider?.capabilities.toolFilter === true ? { toolFilter: { deny: ['executor', 'swarm'] } } : {}),
    ...(provider?.capabilities.depthLimit === true ? { maxDepth: 1 } : {}),
    ...(provider?.capabilities.persona === true ? { persona: executorPersona() } : {}),
    signal,
  })
  const [execution] = await Promise.allSettled([
    run.result.then((result) => {
      const error = stopReasonError(result)
      if (error !== undefined) {
        throw new Error(`${error}; partial output follows:\n${outputText(result.output)}`)
      }
      return { runId: run.id, output: result.output as unknown as JsonValue[] }
    }),
  ])
  const [disposal] = await Promise.allSettled([Promise.resolve().then(() => run.dispose())])
  if (execution.status === 'rejected') throw execution.reason
  if (disposal.status === 'rejected') throw disposal.reason
  return execution.value
}

/** One free model the swarm may run on, as the pool hands it out. */
interface SwarmLease {
  /** `pi-ai` provider route the model is reachable through. */
  readonly provider: string
  /** Model id to pin on the worker run. */
  readonly model: string
  /**
   * Record what the attempt cost.
   * @param outcome - the attempt's result, in the pool's vocabulary.
   */
  release(outcome: SwarmLeaseOutcome): Promise<void>
}

/** What a worker reports back about its attempt to the pool that leased its model. */
type SwarmLeaseOutcome =
  | { kind: 'success'; tokens?: number }
  | { kind: 'rate-limited'; retryAfterMs?: number }
  | { kind: 'failure'; message: string }

/**
 * The free-model pool surface the swarm consumes, declared structurally:
 * `@deepseek-ai/dsh-llm-openrouter-free` provides it, and a deployment may
 * compose the orchestrator without it. Reading it through
 * {@link swarmPoolOf} keeps a missing pool a configuration fact rather than a
 * load-time dependency.
 */
interface SwarmModelPool {
  /** Whether any pooled model can take a task right now. */
  available(): boolean
  /** Reserve the next model, or answer nothing when the pool is spent. */
  acquire(): SwarmLease | undefined
  /** Cheap status: `enabled` is false when the operator has not turned the pool on. */
  snapshot(): { enabled: boolean }
}

/** Wording a provider failure carries when the model had nothing left to spend. */
const RATE_LIMIT_PATTERN = /(429|rate[ _-]?limit|too many requests|quota)/i

/**
 * Read the free-model pool from the context, if this deployment composed one.
 * @param ctx - host context.
 * @returns the pool, or `undefined` when no pool is mounted.
 */
function swarmPoolOf(ctx: Context): SwarmModelPool | undefined {
  const candidate: unknown = ctx.get('openrouterFree')
  if (candidate === null || typeof candidate !== 'object') return undefined
  const pool = candidate as Partial<SwarmModelPool>
  return typeof pool.acquire === 'function'
    && typeof pool.available === 'function'
    && typeof pool.snapshot === 'function'
    ? pool as SwarmModelPool
    : undefined
}

/** One worker's report as the swarm tool returns it. */
interface SwarmWorkerReport {
  /** Worker roster name. */
  name: string
  /** Route/model the worker ran on, or `—` when no model was available. */
  model: string
  /** Whether the worker completed and produced a report. */
  ok: boolean
  /** The worker's condensed report, when it completed. */
  report?: string
  /** Why the worker produced no report. */
  error?: string
}

/** Why a worker run ended, in the swarm's own vocabulary. */
function swarmStopReason(result: SubagentResult): string | undefined {
  if (result.stopReason === 'completed') return undefined
  const reason = stopReasonError(result)?.replace('executor run', 'worker run')
  return reason ?? 'worker run ended abnormally'
}

/**
 * Classify one finished worker run for the pool's ledger. A provider failure
 * whose diagnostic names a rate limit or a spent quota is what benches the
 * model until its window turns over; anything else is an ordinary failure.
 */
function leaseOutcomeOf(result: SubagentResult, tokens: number): SwarmLeaseOutcome {
  if (result.stopReason === 'completed') return { kind: 'success', tokens }
  const diagnostic = result.diagnostic ?? ''
  if (RATE_LIMIT_PATTERN.test(diagnostic)) return { kind: 'rate-limited' }
  return { kind: 'failure', message: swarmStopReason(result) ?? 'worker run failed' }
}

/** Join one worker's text output for the swarm report. */
function workerText(values: readonly unknown[]): string {
  return outputText(values).trim()
}

/** One settled worker attempt: its report plus whether another model could answer instead. */
interface SwarmAttempt {
  /** What the worker reported. */
  report: SwarmWorkerReport
  /** Whether the model's rate limit, rather than the task, ended the attempt. */
  retryable: boolean
}

/**
 * Run one swarm worker on a leased free model and settle its lease.
 *
 * The worker is a normal delegated child: it keeps the full tool set (it does
 * the tool work the head is avoiding), it cannot re-enter `executor` or `swarm`
 * where the provider honors a tool filter, and its persona keeps it in the
 * worker role.
 */
async function runSwarmWorker(
  ctx: Context,
  settings: OrchestratorSettings,
  parent: Agent,
  task: { description: string; prompt: string },
  lease: SwarmLease,
  name: string,
  signal: AbortSignal,
): Promise<SwarmAttempt> {
  const provider = ctx.subagents.getProvider(settings.subagentProvider)
  const run: SubagentRun = await ctx.subagents.start(settings.subagentProvider, {
    label: `${name}: ${task.description}`,
    prompt: [{ type: 'text', text: task.prompt }] as ContentBlock[],
    parent,
    agentOptions: { provider: lease.provider, model: lease.model },
    ...(provider?.capabilities.toolFilter === true ? { toolFilter: { deny: ['executor', 'swarm'] } } : {}),
    ...(provider?.capabilities.depthLimit === true ? { maxDepth: 1 } : {}),
    ...(provider?.capabilities.persona === true ? { persona: swarmPersona(name) } : {}),
    signal,
  })
  let result: SubagentResult | undefined
  let failure: unknown
  try {
    result = await run.result
  } catch (error: unknown) {
    failure = error
  }
  await run.dispose().catch((error: unknown) => {
    // A failed dispose after the result settled must not hide the report; the
    // child is already finished and the parent still needs the worker text.
    ctx.logger.warn(`orchestrator: swarm worker dispose failed: ${String(error)}`)
  })
  const model = `${lease.provider}/${lease.model}`
  if (result === undefined) {
    const message = failure instanceof Error ? failure.message : String(failure)
    const retryable = RATE_LIMIT_PATTERN.test(message)
    await lease.release(retryable ? { kind: 'rate-limited' } : { kind: 'failure', message })
    return { report: { name, model, ok: false, error: message }, retryable }
  }
  const outcome = leaseOutcomeOf(result, 0)
  await lease.release(outcome)
  const error = swarmStopReason(result)
  const report = workerText(result.output)
  if (error !== undefined) {
    return {
      retryable: outcome.kind === 'rate-limited',
      report: {
        name,
        model,
        ok: false,
        error: report === '' ? error : `${error}; partial output follows:\n${report}`,
      },
    }
  }
  return { retryable: false, report: { name, model, ok: true, report } }
}

/**
 * The compact swarm worker persona. It differs from the executor persona in one
 * thing that matters: the worker runs on a free model with a smaller context
 * than the head, so it is told to answer in the shortest form that carries the
 * facts rather than to narrate its work.
 * @param name - the roster name this worker was given.
 * @returns the persona text for one worker.
 */
function swarmPersona(name: string): string {
  return [
    `Ты — ${name}, один из воркеров (roi-swarm) в режиме оркестра: ты не планируешь`,
    'верхнеуровневую работу и не вызываешь другие модели. Выполни выданную подзадачу',
    'инструментами сам и верни сжатый структурированный отчёт: что сделал, что нашёл,',
    'чем подтверждается, что осталось неясным. Ты работаешь на бесплатной модели с',
    'небольшим контекстом — не пересказывай чужие файлы, цитируй только нужные строки.',
    'У тебя есть зрение (vision): открывай изображения инструментом чтения изображений',
    '(read_image) и описывай то, что реально видно; никогда не описывай картинку, которую',
    'не открывал. Для веб-задач используй Chrome через CDP-клиент:',
    `node "${chromeCdpClientPath()}" ensure | open <url> | shot <файл.png> --tab <id>`,
    '| text | html | eval "<js>" | click "<селектор>" | wait <мс> | close --tab <id>.',
  ].join(' ')
}

/** Render the swarm reports for the head. */
function swarmText(value: { workers: readonly SwarmWorkerReport[] }): string {
  return value.workers
    .map((worker) => {
      const head = `${worker.ok ? '✔' : '✖'} ${worker.name} [${worker.model}]`
      return worker.ok ? `${head}\n${worker.report ?? ''}` : `${head}\n${worker.error ?? 'нет отчёта'}`
    })
    .join('\n\n')
}

/** The route string shown to the head in instructions and tool copy. */
function routeLabel(settings: OrchestratorSettings): string {
  return `${settings.executorProvider}/${settings.executorModel}`
}

/** Whether the live settings describe a usable local route (both halves set). */
function routeReady(settings: OrchestratorSettings): boolean {
  return settings.executorProvider.trim() !== '' && settings.executorModel.trim() !== ''
}

/**
 * Register the executor tool and the head-role prompt section, both reading
 * the live `orchestrator` settings namespace. Everything lives inside one
 * effect so an HMR re-apply tears the previous watcher, tool, and section down
 * before re-registering (a stale settings watcher must not remount the tool).
 * @param ctx - host context carrying the tool, delegation, prompt, and settings registries.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => {
    const handle = ctx.settings.register(NS, orchestratorSchema, {
      base: {
        enabled: false,
        subagentProvider: 'spawn',
        executorProvider: '',
        executorModel: '',
        headDenyTools: [...DEFAULT_HEAD_DENY_TOOLS],
        roiEnabled: false,
        roiWorkers: 5,
        roiRetries: 2,
        roiNames: [...DEFAULT_ROI_NAMES],
      },
    })
    const settingsOf = (): OrchestratorSettings => handle.get()

    let disposeTool: (() => void) | undefined
    const mount = (): void => {
      if (disposeTool !== undefined) return
      disposeTool = ctx.tools.register(defineTool({
        name: 'executor',
        description:
          'Run one heavy, tool-driven task on the LOCAL executor model and return its condensed report. '
          + 'Use this instead of doing long tool chains yourself: the executor reads files, searches, and '
          + 'runs commands with the full tool set, then answers briefly. Give it a complete, standalone '
          + 'prompt — it does not see this conversation. Foreground by default; this call waits for the report.',
        parameters: {
          description: {
            type: 'string',
            required: true,
            description: 'Short label for the delegated task (used in UI and logs).',
          },
          prompt: {
            type: 'string',
            required: true,
            description:
              'The complete, self-contained task: goal, exact paths, boundaries, and the required report format.',
          },
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              runId: { type: 'string', required: true },
              output: { type: 'array', required: true, items: { type: 'json' } },
            },
          },
          render: (_args, value) => [{ type: 'text', text: outputText(value.output) }],
        },
        isConcurrencySafe: () => false,
        async execute(args, exec) {
          const current = settingsOf()
          if (!current.enabled || !routeReady(current)) {
            throw new Error(
              'executor unavailable: enable orchestrator and set both executorProvider and executorModel '
              + 'in Settings → Models → Оркестратор',
            )
          }
          const agent = exec.agent
          if (agent === undefined) {
            throw new Error('executor tool requires a calling agent (exec.agent was undefined)')
          }
          // Head-only, enforced at execution (the spawned children also hide the
          // tool, so this is the backstop for any other delegated path).
          if (delegationDepthOf(agent) > 0) {
            throw new Error('executor is head-only: delegated agents must do their own tool work')
          }
          return runExecutor(ctx, current, agent, args, exec.signal)
        },
        presentCall(args) {
          return { card: 'generic', title: `Executor: ${args.description}`, kind: 'execute', rawInput: args.prompt }
        },
      }))
    }

    // Keep the tool mounted exactly while the mode is enabled with a full
    // provider+model route (an empty provider would silently override the
    // parent route through `agentOptions.provider: ''`).
    const syncTool = (): void => {
      const current = settingsOf()
      if (current.enabled && routeReady(current)) mount()
      if (!current.enabled || !routeReady(current)) {
        if (disposeTool !== undefined) {
          disposeTool()
          disposeTool = undefined
        }
      }
    }

    // The ROI swarm tool: mounted exactly while the mode is enabled, ROI is
    // switched on, and a free-model pool is composed. Its own tool, not a mode
    // of `executor`, because the two delegate differently: `executor` pins one
    // local route, while `swarm` leases a model per task from the pool and
    // fans the tasks out in parallel.
    let disposeSwarm: (() => void) | undefined
    const mountSwarm = (): void => {
      if (disposeSwarm !== undefined) return
      disposeSwarm = ctx.tools.register(defineTool({
        name: 'swarm',
        description:
          'Run several independent tasks at once on the FREE pooled models and return their reports. '
          + 'Every task gets its own worker and its own free model, leased from the pool\'s rotation, so a '
          + 'fan-out costs no paid tokens and no worker waits behind another\'s generation. Use it when the '
          + 'request splits into independent pieces — parallel searches, per-file audits, several sources to '
          + 'check — and you would otherwise chain executor calls. Each prompt must be complete and '
          + 'standalone: workers do not see this conversation. A model that answers a rate limit moves the '
          + 'task to the next pooled model; a worker the pool cannot serve at all is reported as failed '
          + 'immediately instead of being waited on.',
        parameters: {
          tasks: {
            type: 'array',
            required: true,
            description: 'The independent tasks, one worker each; only the first roiWorkers tasks are started.',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                description: {
                  type: 'string',
                  required: true,
                  description: 'Short label for this task (used in UI and logs).',
                },
                prompt: {
                  type: 'string',
                  required: true,
                  description:
                    'The complete, self-contained task: goal, exact paths, boundaries, and the required report format.',
                },
              },
            },
          },
        },
        output: {
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              workers: {
                type: 'array',
                required: true,
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    name: { type: 'string', required: true },
                    model: { type: 'string', required: true },
                    ok: { type: 'boolean', required: true },
                    report: { type: 'string' },
                    error: { type: 'string' },
                  },
                },
              },
            },
          },
          render: (_args, value) => [{ type: 'text', text: swarmText(value) }],
        },
        isConcurrencySafe: () => false,
        async execute(args, exec) {
          const current = settingsOf()
          if (!current.enabled || !current.roiEnabled) {
            throw new Error(
              'swarm unavailable: enable orchestrator and the ROI mode in Settings → Models → Оркестратор',
            )
          }
          const pool = swarmPoolOf(ctx)
          if (pool === undefined || !pool.snapshot().enabled) {
            throw new Error(
              'swarm unavailable: enable OpenRouter Free in Settings → Models → OpenRouter Free',
            )
          }
          const agent = exec.agent
          if (agent === undefined) {
            throw new Error('swarm tool requires a calling agent (exec.agent was undefined)')
          }
          if (delegationDepthOf(agent) > 0) {
            throw new Error('swarm is head-only: delegated agents must do their own tool work')
          }
          const names = current.roiNames.filter(entry => entry.trim() !== '')
          const limit = Math.max(1, Math.min(current.roiWorkers, MAX_ROI_WORKERS))
          const retries = Math.max(0, Math.min(current.roiRetries, MAX_ROI_RETRIES))
          const selected = args.tasks.slice(0, limit)
          const reports = await Promise.all(selected.map(async (task, index) => {
            const name = names.length === 0 ? `Воркер ${String(index + 1)}` : names[index % names.length] ?? `Воркер ${String(index + 1)}`
            let last: SwarmWorkerReport | undefined
            for (let attempt = 0; attempt <= retries; attempt += 1) {
              const lease = pool.acquire()
              if (lease === undefined) {
                return last ?? {
                  name,
                  model: '—',
                  ok: false,
                  error: 'нет бесплатных моделей с остатком: пул исчерпан (см. Settings → Models → OpenRouter Free)',
                }
              }
              const attemptResult = await runSwarmWorker(ctx, current, agent, task, lease, name, exec.signal)
              last = attemptResult.report
              if (!attemptResult.retryable) return attemptResult.report
            }
            return last ?? { name, model: '—', ok: false, error: 'воркер не был запущен' }
          }))
          const dropped = args.tasks.slice(limit).map((task, index) => {
            const ordinal = selected.length + index + 1
            const name = names.length === 0 ? `Воркер ${String(ordinal)}` : names[(ordinal - 1) % names.length] ?? `Воркер ${String(ordinal)}`
            return {
              name,
              model: '—',
              ok: false,
              error: `задача «${task.description}» не запущена: лимит roiWorkers=${String(limit)}`,
            }
          })
          return { workers: [...reports, ...dropped] }
        },
        presentCall(args) {
          return {
            card: 'generic',
            title: `Swarm: ${String(args.tasks.length)} задач`,
            kind: 'execute',
            rawInput: args.tasks.map(task => task.description).join('\n'),
          }
        },
      }))
    }

    const syncSwarm = (): void => {
      const current = settingsOf()
      // The pool is read at CALL time, not here: a deployment may mount the
      // free-model plugin after this one, and gating the mount on a service
      // that appears later would leave the tool permanently absent. Without a
      // pool, `execute` refuses with the configuration step that fixes it.
      if (current.enabled && current.roiEnabled) mountSwarm()
      else if (disposeSwarm !== undefined) {
        disposeSwarm()
        disposeSwarm = undefined
      }
    }

    // The bundled companion skills (`orchestrator-head` / `orchestrator-executor`)
    // register on `ctx.skills` exactly while the mode is live, so the operating
    // protocol is available in every project that enables the mode — not only in
    // checkouts carrying `.agents/skills/orchestrator-*`. Registration runs on
    // the host plane, so the runtime skills land in the global registry layer,
    // which every session's catalog (and the Skills manager's «Встроенные»
    // bucket) reads regardless of the project cwd. Loading the assets is async:
    // the live namespace is re-checked when the load settles, and a generation
    // counter invalidates an in-flight load when the mode is toggled off, so a
    // stale load never registers skills onto a disabled mode.
    let disposeSkills: (() => void) | undefined
    let pendingSkills: Promise<void> | undefined
    let skillsGeneration = 0
    let skillsRoi: boolean | undefined

    const unmountSkills = (): void => {
      // Invalidate any in-flight asset load: its `.then` re-checks the
      // generation before registering, so a toggle-off mid-load is a no-op.
      skillsGeneration += 1
      pendingSkills = undefined
      if (disposeSkills !== undefined) {
        disposeSkills()
        disposeSkills = undefined
      }
    }
    const mountSkills = (): void => {
      if (disposeSkills !== undefined || pendingSkills !== undefined) return
      const generation = skillsGeneration
      const loading = loadOrchestratorSkills()
        .then((loaded) => {
          // Re-check the generation: the mode may have been toggled off (or
          // the fiber torn down) while the assets loaded. `unmountSkills`
          // bumps the generation on every toggle-off and on teardown, so a
          // stale load registering skills onto a disabled mode is impossible.
          if (generation !== skillsGeneration) return
          const roiOn = settingsOf().roiEnabled
          const kept = roiOn ? loaded : loaded.filter(skill => skill.name !== ORCHESTRATOR_ROI_SKILL)
          const disposers = kept.map(skill => ctx.skills.register(skill))
          disposeSkills = () => { for (const dispose of disposers) dispose() }
        })
        .catch((error: unknown) => {
          ctx.logger.error(`orchestrator: failed to register bundled skills: ${String(error)}`)
          skillsRoi = undefined
        })
      pendingSkills = loading
      // Clear the pending marker only when this load is still the current one:
      // a toggle-off + re-enable may have started a second load meanwhile, and
      // the older load must not erase the newer load's pending state.
      void loading.finally(() => {
        if (pendingSkills === loading) pendingSkills = undefined
      })
    }
    const syncSkills = (): void => {
      const current = settingsOf()
      if (!(current.enabled && routeReady(current))) {
        unmountSkills()
        skillsRoi = undefined
        return
      }
      if (disposeSkills !== undefined && skillsRoi === current.roiEnabled) return
      unmountSkills()
      skillsRoi = current.roiEnabled
      mountSkills()
    }

    // Head tool policy: while the mode is enabled with a non-empty deny list,
    // hide listed tools from the depth-0 schema and deny them at
    // `tools/pre-execute` before approval. Both listeners share one lifecycle;
    // toggling the list empty or disabling the mode disposes them. Delegated
    // workers and host assemblies without an agent are untouched.
    let disposePolicy: (() => void) | undefined
    const syncPolicy = (): void => {
      const current = settingsOf()
      if (!current.enabled) {
        if (disposePolicy !== undefined) {
          disposePolicy()
          disposePolicy = undefined
        }
        return
      }
      if (disposePolicy !== undefined) return
      const liveDeny = (): Set<string> =>
        new Set(settingsOf().headDenyTools.filter(tool => tool.trim() !== ''))
      const disposeExecute = ctx.on('tools/pre-execute', async (exec, next) => {
        const reason = headToolDeny(exec.agent, exec.name, liveDeny())
        return reason === undefined ? next() : { kind: 'deny', reason }
      })
      const disposeAssemble = ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
        const nextAssembly = await next()
        return {
          ...nextAssembly,
          tools: filterHeadToolSchemas(context.agent, nextAssembly.tools, liveDeny()),
        }
      })
      disposePolicy = () => {
        disposeExecute()
        disposeAssemble()
      }
    }

    const sync = (): void => {
      syncTool()
      syncSwarm()
      syncSkills()
      syncPolicy()
    }
    const disposeWatch = handle.watch(sync)
    sync()

    const disposeSection = ctx.systemPrompt.section({
      name: 'orchestrator',
      order: EXECUTOR_SECTION_ORDER,
      text: (context) => {
        // Head instructions belong to the top-level planner only: a delegated
        // child must never read "you are the HEAD" (its worker persona arrives
        // through the spawn composition instead).
        const agent = context.agent
        if (agent !== undefined && delegationDepthOf(agent) > 0) return ''
        const current = settingsOf()
        if (!current.enabled || !routeReady(current)) return ''
        const route = routeLabel(current)
        const roi = current.roiEnabled
        return [
          'Режим оркестра включён: ты — ГОЛОВНАЯ (планирующая) модель, твои токены дороги.',
          `Исполнительная (локальная) модель — ${route} через инструмент \`executor\`.`,
          ...roi
            ? [`ROI-режим включён: независимые подзадачи можно запускать веером инструментом \`swarm\` — он поднимает до ${String(current.roiWorkers)} воркеров (${current.roiNames.slice(0, 5).join(', ')}…), каждый на своей БЕСПЛАТНОЙ модели из пула OpenRouter, и собирает их отчёты. Протокол роя целиком — в навыке \`orchestrator-roi\`: загрузи его инструментом \`skill\`, прежде чем раздавать задачи. Состояние пула (остатки по каждой бесплатной модели, свежесть списка) показывает инструмент \`free_models\`, он же умеет перечитать каталог досрочно. Дели задачу на действительно независимые куски (по файлу, по источнику, по гипотезе), давай каждому воркеру полный самодостаточный промпт и требуй сжатый отчёт; модель, ответившая лимитом частоты, автоматически уступает задачу следующей модели пула. Если пул исчерпан, воркер сразу вернётся с ошибкой — не жди его, а перераспредели работу через \`executor\` или повтори \`swarm\` позже. Список бесплатных моделей пул перечитывает сам по своему интервалу (по умолчанию каждые 30 минут); форсировать его можно кнопкой «Обновить сейчас» в Settings → Models → «OpenRouter Free».`]
            : [],
          'Не выполняй сам длинные цепочки инструментов: сначала загрузи навык `orchestrator-head` инструментом `skill` и следуй ему. Тяжёлую инструментальную работу (поиск по коду, массовые чтения, команды, переборы) отдавай в `executor`, разбивая на несколько мелких коротких заданий (у локальной модели Kibborg_Flash_v5.7 лимит контекста ≤128k — лучше несколько мелких операций, чем одна большая; для облачных моделей ограничений нет), и требуй сжатый структурированный отчёт. Проверяй результат чтением ключевых мест сам, не пересказывая его. Никогда не дублируй один и тот же вызов инструмента: один файл читай один раз, одну команду запускай один раз — если результат уже получен, используй его, а не вызывай заново.',
          'У исполнителя есть зрение (vision): он может открывать и анализировать изображения (скриншоты, GUI, картинки) инструментом чтения изображений (read_image) и объяснять, что видит. Если тебе нужно что-то посмотреть — не пытайся сам анализировать графический файл текстом, а дай исполнителю задание «посмотри на <путь к изображению> и объясни, что на нём», указав точный путь к файлу. Учти: у головной модели (deepseek-v4-flash) нет vision — читать изображения может только исполнитель.',
          `Для веб-задач («полазить в интернете», посмотреть страницу, вытянуть информацию с сайта, «потыкать» сайт, визуально осмотреть страницу/фичи) почти всегда доступен Chrome с DevTools Protocol на 127.0.0.1:9222. Делегируй исполнителю задание использовать CDP-клиент: node "${chromeCdpClientPath()}" (ensure → open <url> → shot <файл.png> → осмотр скриншота через read_image; при необходимости text/html/eval/click). Визуальный осмотр сайта делается только через скриншот Chrome + чтение изображения исполнителем.`,
        ].join(' ')
      },
    })

    return () => {
      disposeWatch()
      disposeSection()
      unmountSkills()
      if (disposePolicy !== undefined) {
        disposePolicy()
        disposePolicy = undefined
      }
      if (disposeSwarm !== undefined) {
        disposeSwarm()
        disposeSwarm = undefined
      }
      if (disposeTool !== undefined) {
        disposeTool()
        disposeTool = undefined
      }
    }
  }, 'orchestrator: live settings/tool/prompt registration')
}
