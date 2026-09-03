/**
 * Orchestrator host-half composition: the executor tool mounts/unmounts with
 * the live settings namespace, the head prompt section is suppressed for
 * delegated agents, execution is head-only, and executor children are scoped
 * (no re-entrant `executor`, bounded depth, worker persona) when the provider
 * advertises those capabilities.
 */

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { PromptSection } from '@deepseek-ai/dsh-system-prompt'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SubagentResult, SubagentStartRequest } from '@deepseek-ai/dsh-subagent'
import { apply, inject } from '../src/index.ts'

/** Provider capability presets the fake subagent registry answers with. */
type Caps = { toolFilter: boolean; depthLimit: boolean; persona: boolean }

interface Harness {
  ctx: Context
  /** Live settings the fake namespace serves. */
  settings: { enabled: boolean; subagentProvider: string; executorProvider: string; executorModel: string }
  /** The result the fake subagent registry resolves for the next start. */
  fixture: { result: SubagentResult }
  /** Registered tool definitions (name → definition). */
  tools: Map<string, { execute: (args: unknown, exec: unknown) => unknown }>
  /** Registered prompt sections by name. */
  sections: Map<string, PromptSection>
  /** Start requests the fake subagents registry received. */
  starts: SubagentStartRequest[]
  /** Dispose the plugin fiber (HMR teardown). */
  dispose: () => Promise<void>
  /** Flip the live settings and fire the namespace watcher. */
  applySettings: () => void
}

/** Agent stub carrying a delegation depth (delegationDepthOf reads the header). */
function agentAt(depth: number): Agent {
  return {
    options: { subagentDepth: depth },
    session: { header: {} },
  } as unknown as Agent
}

/** A settled subagent result for one stop reason. */
function resultOf(stopReason: SubagentResult['stopReason']): SubagentResult {
  return { stopReason, output: [{ type: 'text', text: 'partial' }] }
}

async function setup(caps: Caps, initial: Partial<Harness['settings']> = {}): Promise<Harness> {
  const ctx = new Context()
  const settings = {
    enabled: false,
    subagentProvider: 'spawn',
    executorProvider: 'kibborg',
    executorModel: 'Kibborg_Flash_v5.7',
    ...initial,
  }
  const fixture: Harness['fixture'] = { result: resultOf('completed') }
  const tools = new Map<string, { execute: (args: unknown, exec: unknown) => unknown }>()
  const sections = new Map<string, PromptSection>()
  const starts: SubagentStartRequest[] = []
  let watcher: (() => void) | undefined

  ctx.provide('tools', {
    register: (tool: { name: string; execute: (args: unknown, exec: unknown) => unknown }): (() => void) => {
      tools.set(tool.name, tool)
      return () => { tools.delete(tool.name) }
    },
  })
  ctx.provide('systemPrompt', {
    section: (section: PromptSection): (() => void) => {
      sections.set(section.name, section)
      return () => { sections.delete(section.name) }
    },
  })
  ctx.provide('settings', {
    register: (): { get: () => Harness['settings']; watch: (callback: () => void) => () => void } => ({
      get: () => settings,
      watch: (callback: () => void) => {
        watcher = callback
        return () => { watcher = undefined }
      },
    }),
  })
  ctx.provide('subagents', {
    getProvider: () => ({ capabilities: caps }),
    start: async (_provider: string, request: SubagentStartRequest): Promise<{
      id: string
      result: Promise<SubagentResult>
      dispose: () => Promise<void>
    }> => {
      starts.push(request)
      return {
        id: 'run-1',
        result: Promise.resolve(fixture.result),
        dispose: vi.fn(async () => undefined),
      }
    },
  })

  const plugin = ctx.plugin({ inject: [...inject], apply })
  await plugin.await()
  return {
    ctx,
    settings,
    fixture,
    tools,
    sections,
    starts,
    dispose: () => plugin.dispose(),
    applySettings: () => { watcher?.() },
  }
}

/** Call the mounted executor tool's execute with a top-level agent. */
async function runExecutorTool(h: Harness, depth = 0): Promise<unknown> {
  const tool = h.tools.get('executor')
  if (tool === undefined) throw new Error('executor tool is not mounted')
  return tool.execute({ description: 'task', prompt: 'do it' }, {
    agent: agentAt(depth),
    signal: new AbortController().signal,
    overrides: {},
  })
}

describe('dsh-orchestrator composition', () => {
  const FULL_CAPS: Caps = { toolFilter: true, depthLimit: true, persona: true }

  it('registers the prompt section and mounts the tool only while enabled with a model', async () => {
    const h = await setup(FULL_CAPS)
    expect(h.sections.has('orchestrator')).toBe(true)
    expect(h.tools.has('executor')).toBe(false)

    h.settings.enabled = true
    h.applySettings()
    expect(h.tools.has('executor')).toBe(true)

    h.settings.enabled = false
    h.applySettings()
    expect(h.tools.has('executor')).toBe(false)
    await h.dispose()
  })

  it('tears the tool and section down with the plugin fiber', async () => {
    const h = await setup(FULL_CAPS, { enabled: true })
    h.applySettings()
    expect(h.tools.has('executor')).toBe(true)

    await h.dispose()
    expect(h.tools.has('executor')).toBe(false)
    expect(h.sections.has('orchestrator')).toBe(false)
  })

  it('renders head instructions only for the top-level agent', async () => {
    const h = await setup(FULL_CAPS, { enabled: true })
    const section = h.sections.get('orchestrator')!
    const text = section.text as (context: { agent?: Agent }) => string

    expect(text({})).toContain('Исполнительная (локальная) модель')
    expect(text({ agent: agentAt(1) })).toBe('')
    // Disabled: no instructions regardless of depth.
    h.settings.enabled = false
    expect(text({})).toBe('')
    await h.dispose()
  })

  it('scopes the executor child: no re-entrant executor, bounded depth, worker persona', async () => {
    const h = await setup(FULL_CAPS, { enabled: true })
    h.applySettings()
    await runExecutorTool(h)

    expect(h.starts).toHaveLength(1)
    const request = h.starts[0]!
    expect(request.maxDepth).toBe(1)
    expect(request.toolFilter).toEqual({ deny: ['executor'] })
    expect(request.persona).toContain('ИСПОЛНИТЕЛЬ')
    await h.dispose()
  })

  it('omits the scoping when the provider cannot honor it', async () => {
    const h = await setup({ toolFilter: false, depthLimit: false, persona: false }, { enabled: true })
    h.applySettings()
    await runExecutorTool(h)

    expect(h.starts).toHaveLength(1)
    const request = h.starts[0]!
    expect(request.maxDepth).toBeUndefined()
    expect(request.toolFilter).toBeUndefined()
    expect(request.persona).toBeUndefined()
    await h.dispose()
  })

  it('refuses execution from delegated agents', async () => {
    const h = await setup(FULL_CAPS, { enabled: true })
    h.applySettings()
    await expect(runExecutorTool(h, 1)).rejects.toThrow('executor is head-only')
    await h.dispose()
  })

  it('reports an unavailable mode at execution time', async () => {
    // Mounted while enabled, then disabled before the watcher runs (the live
    // race): the still-mounted tool refuses at execution time.
    const h = await setup(FULL_CAPS, { enabled: true })
    expect(h.tools.has('executor')).toBe(true)
    h.settings.enabled = false
    await expect(runExecutorTool(h)).rejects.toThrow('executor unavailable')
    await h.dispose()
  })

  it('preserves partial output for each non-completed stop reason', async () => {
    const h = await setup(FULL_CAPS, { enabled: true })
    h.applySettings()
    for (const [stopReason, fragment] of [
      ['aborted', 'executor run was cancelled'],
      ['error', 'executor run failed'],
      ['max-tokens', 'executor run hit its token limit'],
      ['refusal', 'executor model refused the task'],
    ] as const) {
      h.fixture.result = resultOf(stopReason)
      await expect(runExecutorTool(h)).rejects.toThrow(new RegExp(fragment))
    }
    await h.dispose()
  })
})
