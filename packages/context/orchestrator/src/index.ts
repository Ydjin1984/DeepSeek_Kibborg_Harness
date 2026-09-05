/**
 * Orchestrator mode, host half.
 *
 * When enabled, the deployment splits model roles: the session's chat model
 * acts as the HEAD (planner) and delegates heavy, tool-driven work to a
 * dedicated `executor` tool that always runs on the configured LOCAL model —
 * so cloud tokens are spent on planning, not on long tool chains. A
 * system-prompt section instructs the head while the mode is on; the bundled
 * `orchestrator-head` and `orchestrator-executor` skills carry the full
 * operating protocol.
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

export const name = 'orchestrator'
export const inject = ['tools', 'subagents', 'systemPrompt', 'settings']

/** The prompt-section order: after the delegation policy, before child reporting. */
const EXECUTOR_SECTION_ORDER = 116.7

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
}

/** Namespace + schema behind the Settings → Models «Оркестратор» card. */
const NS = settingsNamespace('orchestrator')

const orchestratorSchema = z.object({
  enabled: z.boolean().default(false),
  subagentProvider: z.string().default('spawn'),
  executorProvider: z.string().default(''),
  executorModel: z.string().default(''),
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
    'node "C:\\Users\\lex66\\.dsh\\chrome\\cdp.mjs" ensure | open <url> | shot <файл.png> --tab <id>',
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
    ...args.description === undefined ? {} : { label: args.description },
    prompt: [{ type: 'text', text: args.prompt }] as ContentBlock[],
    parent,
    agentOptions: { provider: settings.executorProvider, model: settings.executorModel },
    // The child is a worker, never another head: hide the `executor` tool from
    // it (no unbounded recursion) and cap delegated depth at one level, when
    // the chosen provider can honor those scopes. The worker persona keeps the
    // child in the executor role without the head prompt.
    ...(provider?.capabilities.toolFilter === true ? { toolFilter: { deny: ['executor'] } } : {}),
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
    const disposeWatch = handle.watch(syncTool)
    syncTool()

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
        return [
          'Режим оркестра включён: ты — ГОЛОВНАЯ (планирующая) модель, твои токены дороги.',
          `Исполнительная (локальная) модель — ${route} через инструмент \`executor\`.`,
          'Не выполняй сам длинные цепочки инструментов: сначала загрузи навык `orchestrator-head` инструментом `skill` и следуй ему. Тяжёлую инструментальную работу (поиск по коду, массовые чтения, команды, переборы) отдавай в `executor` одним полным заданием и требуй сжатый структурированный отчёт. Проверяй результат чтением ключевых мест сам, не пересказывая его.',
          'У исполнителя есть зрение (vision): он может открывать и анализировать изображения (скриншоты, GUI, картинки) инструментом чтения изображений (read_image) и объяснять, что видит. Если тебе нужно что-то посмотреть — не пытайся сам анализировать графический файл текстом, а дай исполнителю задание «посмотри на <путь к изображению> и объясни, что на нём», указав точный путь к файлу. Учти: у головной модели (deepseek-v4-flash) нет vision — читать изображения может только исполнитель.',
          'Для веб-задач («полазить в интернете», посмотреть страницу, вытянуть информацию с сайта, «потыкать» сайт, визуально осмотреть страницу/фичи) почти всегда доступен Chrome с DevTools Protocol на 127.0.0.1:9222. Делегируй исполнителю задание использовать CDP-клиент: node "C:\\Users\\lex66\\.dsh\\chrome\\cdp.mjs" (ensure → open <url> → shot <файл.png> → осмотр скриншота через read_image; при необходимости text/html/eval/click). Визуальный осмотр сайта делается только через скриншот Chrome + чтение изображения исполнителем.',
        ].join(' ')
      },
    })

    return () => {
      disposeWatch()
      disposeSection()
      if (disposeTool !== undefined) {
        disposeTool()
        disposeTool = undefined
      }
    }
  }, 'orchestrator: live settings/tool/prompt registration')
}
