/**
 * The pool's scan schedule: the interval it installs, what firing it does, and
 * what a live settings change does to both.
 *
 * The service is exercised directly (not through the CLI) because the interval
 * is the one behavior a short live run cannot show: the first scan happens at
 * mount, and its result is only observable after the configured interval.
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { OpenRouterFreePool } from '../src/service.ts'
import type { OpenRouterFreeConfig } from '../src/config.ts'

/** One directory body with two free, tool-capable models. */
const DIRECTORY = {
  data: [
    {
      id: 'vendor/one:free',
      name: 'One',
      context_length: 262_144,
      pricing: { prompt: '0', completion: '0' },
      supported_parameters: ['tools'],
      architecture: { input_modalities: ['text'] },
    },
    {
      id: 'vendor/two:free',
      name: 'Two',
      context_length: 65_536,
      pricing: { prompt: '0', completion: '0' },
      supported_parameters: ['tools'],
      architecture: { input_modalities: ['text'] },
    },
  ],
}

/** Wait for real I/O (the ledger read) to settle without fake timers. */
const settle = (ms = 120): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

/** The settings-section surface the service writes its report through. */
interface FakeSection {
  register: (
    ns: unknown,
    schema: unknown,
    options?: { base?: Record<string, unknown>; validate?: (value: never) => void },
  ) => { get: () => OpenRouterFreeConfig; watch: (cb: () => void) => () => void; update: () => Promise<void>; replace: () => Promise<void> }
  get: (ns: unknown) => unknown
  mutate: (ns: unknown, ops: readonly { op: string; path: readonly string[]; value?: unknown }[]) => Promise<void>
  mutations: { op: string; path: readonly string[]; value?: unknown }[][]
}

describe('pool scan schedule', () => {
  let home: string
  let scheduled: { handler: () => void; ms: number }[]
  let cleared: number
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'dsh-openrouter-free-'))
    vi.stubEnv('DSH_HOME', home)
    // The schedule is observed through what the service asks the runtime for:
    // the handler it passes and the interval it names. Real timers are still
    // installed, so clearing them keeps the process as quiet as production.
    scheduled = []
    cleared = 0
    const realSetInterval = globalThis.setInterval.bind(globalThis)
    const realClearInterval = globalThis.clearInterval.bind(globalThis)
    vi.stubGlobal('setInterval', (handler: () => void, ms?: number): unknown => {
      scheduled.push({ handler, ms: ms ?? 0 })
      return realSetInterval(handler, ms)
    })
    vi.stubGlobal('clearInterval', (handle?: unknown): void => {
      cleared += 1
      realClearInterval(handle as Parameters<typeof clearInterval>[0])
    })
    fetchMock = vi.fn(async () => new Response(JSON.stringify(DIRECTORY), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(async () => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
    await rm(home, { recursive: true, force: true })
  })

  /** Mount the service over a fake settings section and return both. */
  async function mount(
    enabled = true,
    refreshMinutes = 30,
  ): Promise<{ service: OpenRouterFreePool; section: FakeSection; fire: () => void; tools: Map<string, ToolDefinition> }> {
    const configured: OpenRouterFreeConfig = {
      enabled,
      providerRoute: 'openrouter',
      baseURL: 'https://openrouter.test/api/v1',
      apiKeyEnv: 'OPENROUTER_API_KEY',
      refreshMinutes,
      refreshNonce: 0,
      requestTimeoutMs: 5_000,
      maxModels: 20,
      minContextWindow: 32_768,
      requestsPerMinutePerModel: 20,
      requestsPerDayPerModel: 50,
      tokensPerDayPerModel: 0,
      excludeModels: [],
      requireToolSupport: true,
      scannedAt: 0,
      status: [],
    }
    let watcher: (() => void) | undefined
    const mutations: FakeSection['mutations'] = []
    const section: FakeSection = {
      mutations,
      register: () => ({
        get: () => configured,
        watch: (cb: () => void) => {
          watcher = cb
          return () => { watcher = undefined }
        },
        update: async () => undefined,
        replace: async () => undefined,
      }),
      get: () => configured,
      mutate: async (_ns, ops) => { mutations.push([...ops]) },
    }
    const ctx = new Context()
    ctx.provide('settings' as never, section as never)
    ctx.provide('credentials' as never, { resolve: async () => ({ value: 'test-key' }) } as never)
    const tools = new Map<string, ToolDefinition>()
    ctx.provide('tools' as never, {
      register: (tool: ToolDefinition): (() => void) => {
        tools.set(tool.name, tool)
        return () => { tools.delete(tool.name) }
      },
    } as never)
    const service = new OpenRouterFreePool(ctx, configured)
    await settle(150)
    return { service, section, fire: () => { watcher?.() }, tools }
  }

  it('installs the configured interval and rescans when it fires', async () => {
    const { section } = await mount(true, 30)
    // The mount scan ran once, and the schedule was installed at 30 minutes.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(scheduled).toHaveLength(1)
    expect(scheduled[0]?.ms).toBe(30 * 60_000)

    scheduled[0]?.handler()
    await settle(150)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    // The second scan is reported, so a surface sees the fresh timestamp.
    const reported = section.mutations.flat()
    expect(reported.some(op => op.path.length === 1 && op.path[0] === 'scannedAt')).toBe(true)
    expect(reported.some(op => op.path.length === 1 && op.path[0] === 'status')).toBe(true)
  })

  it('honours a one-minute interval and stops scanning when the pool is disabled', async () => {
    const { section, fire } = await mount(true, 1)
    expect(scheduled[0]?.ms).toBe(60_000)

    const configured = section.get(undefined) as OpenRouterFreeConfig
    configured.enabled = false
    fire()
    await settle(150)

    expect(cleared).toBeGreaterThan(0)
    // Disabling withdraws the published route rather than leaving it dangling.
    const ops = section.mutations.flat()
    expect(ops.some(op => op.op === 'unset' && op.path.join('.') === 'providers.openrouter')).toBe(true)
  })

  it('reschedules when the interval changes and ignores its own status report', async () => {
    const { section, fire } = await mount(true, 30)
    expect(scheduled).toHaveLength(1)

    // A committed status report is not a configuration change: no new scan.
    fire()
    await settle(120)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const configured = section.get(undefined) as OpenRouterFreeConfig
    configured.refreshMinutes = 10
    fire()
    await settle(150)
    expect(scheduled).toHaveLength(2)
    expect(scheduled[1]?.ms).toBe(10 * 60_000)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('registers the free_models tool: status reads the pool, refresh rescans it', async () => {
    const { tools } = await mount(true, 30)
    const tool = tools.get('free_models')
    expect(tool).toBeDefined()

    const status = await tool!.execute({ action: 'status' }, {} as never) as {
      enabled: boolean
      hasCapacity: boolean
      scannedAt: number
      models: { id: string; state: string; requestsRemainingToday: number }[]
    }
    // A plain status read never touches the network.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(status.enabled).toBe(true)
    expect(status.hasCapacity).toBe(true)
    expect(status.scannedAt).toBeGreaterThan(0)
    expect(status.models.map(model => model.id)).toEqual(['vendor/one:free', 'vendor/two:free'])
    expect(status.models[0]?.state).toBe('ready')
    expect(status.models[0]?.requestsRemainingToday).toBe(50)

    const refreshed = await tool!.execute({ action: 'refresh' }, {} as never) as { models: unknown[] }
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(refreshed.models).toHaveLength(2)

    // The rendered text names the pool's state and each model's remaining budget.
    const rendered = tool!.output?.render?.({ action: 'status' }, status) ?? []
    const text = rendered
      .flatMap(block => 'text' in block && typeof block.text === 'string' ? [block.text] : [])
      .join('\n')
    expect(text).toContain('Free OpenRouter pool: 2 model(s)')
    expect(text).toContain('vendor/one:free — ready, 50 request(s) left today')
  })
})
