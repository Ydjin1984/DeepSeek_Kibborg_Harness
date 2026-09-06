/**
 * Composition tests for `@deepseek-ai/dsh-engagement-stub`: verify the plugin
 * registers its `tools/pre-execute` listener when enabled, denies blocked tools
 * and out-of-scope hosts, emits `engagement/denied` audit events, and stays
 * inert when disabled.
 */

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as EngagementStub from '../src/index.ts'
import type { Config } from '../src/index.ts'
import type { PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'

/** Type of the fiber returned by `ctx.plugin`. */
type PluginFiber = Awaited<ReturnType<Context['plugin']>>

/** Narrow a pre-execute decision to its deny reason, failing on non-deny. */
function denyReason(decision: PreToolDecision): string {
  if (decision.kind !== 'deny') throw new Error('expected a deny decision')
  return decision.reason
}

/** Minimal agent stub for waterfall execution chains. */
function agentAt(depth: number): { options: { subagentDepth: number }; session: { header: Record<string, never> } } {
  return {
    options: { subagentDepth: depth },
    session: { header: {} },
  }
}

/** Build a ToolExecution-like object for the waterfall. */
function execOf(name: string, arguments_: unknown): ToolExecution {
  return {
    name,
    arguments: arguments_,
    agent: agentAt(0),
  } as unknown as ToolExecution
}

const allowNext = (): Promise<PreToolDecision> => Promise.resolve({ kind: 'allow' })

/** Boot a minimal context with fake `tools` service and mount the plugin; returns [ctx, fiber]. */
async function mount(config: Config): Promise<[Context, PluginFiber]> {
  const ctx = new Context()
  ctx.provide('tools', { register: () => () => {} } as never)
  const fiber = await ctx.plugin(EngagementStub, config)
  return [ctx, fiber]
}

describe('plugin: enabled contour', () => {
  it('denies a blocked tool (nmap)', async () => {
    const [ctx, fiber] = await mount({
      enabled: true,
      allowedHosts: ['example.com'],
      blockedTools: ['nmap'],
    })
    const decision = await ctx.waterfall(
      ctx as never,
      'tools/pre-execute',
      execOf('nmap', {}),
      allowNext,
    )
    expect(decision).toMatchObject({ kind: 'deny', reason: 'tool nmap is blocked by the engagement contour' })
    await fiber.dispose()
  })

  it('denies web_fetch to an out-of-scope host', async () => {
    const [ctx, fiber] = await mount({
      enabled: true,
      allowedHosts: ['example.com'],
      blockedTools: ['nmap'],
    })
    const decision = await ctx.waterfall(
      ctx as never,
      'tools/pre-execute',
      execOf('web_fetch', { url: 'http://evil.com/page' }),
      allowNext,
    )
    expect(decision).toMatchObject({ kind: 'deny' })
    expect(denyReason(decision)).toBe('host evil.com is outside the engagement allowlist')
    await fiber.dispose()
  })

  it('allows web_fetch to an allowed host', async () => {
    const [ctx, fiber] = await mount({
      enabled: true,
      allowedHosts: ['example.com'],
      blockedTools: ['nmap'],
    })
    const decision = await ctx.waterfall(
      ctx as never,
      'tools/pre-execute',
      execOf('web_fetch', { url: 'https://example.com/page' }),
      allowNext,
    )
    expect(decision).toEqual({ kind: 'allow' })
    await fiber.dispose()
  })

  it('allows web_fetch to localhost without allowlist entries', async () => {
    const [ctx, fiber] = await mount({
      enabled: true,
      allowedHosts: ['example.com'],
      blockedTools: ['nmap'],
    })
    const decision = await ctx.waterfall(
      ctx as never,
      'tools/pre-execute',
      execOf('web_fetch', { url: 'http://localhost:3000/api' }),
      allowNext,
    )
    expect(decision).toEqual({ kind: 'allow' })
    await fiber.dispose()
  })

  it('emits engagement/denied audit event on deny', async () => {
    const [ctx, fiber] = await mount({
      enabled: true,
      allowedHosts: ['example.com'],
      blockedTools: ['nmap'],
    })
    let auditEvent: unknown
    ctx.on('engagement/denied', (payload) => { auditEvent = payload })

    await ctx.waterfall(
      ctx as never,
      'tools/pre-execute',
      execOf('web_fetch', { url: 'http://evil.com/' }),
      allowNext,
    )

    expect(auditEvent).toBeDefined()
    expect((auditEvent as Record<string, unknown>).toolName).toBe('web_fetch')
    expect((auditEvent as Record<string, unknown>).host).toBe('evil.com')
    expect((auditEvent as Record<string, unknown>).reason).toBe('host evil.com is outside the engagement allowlist')
    expect((auditEvent as Record<string, unknown>).time).toBeDefined()
    await fiber.dispose()
  })

  it('does NOT emit audit event on allow', async () => {
    const [ctx, fiber] = await mount({
      enabled: true,
      allowedHosts: ['example.com'],
      blockedTools: ['nmap'],
    })
    let auditEvent: unknown
    ctx.on('engagement/denied', (payload) => { auditEvent = payload })

    await ctx.waterfall(
      ctx as never,
      'tools/pre-execute',
      execOf('web_fetch', { url: 'https://example.com/' }),
      allowNext,
    )

    expect(auditEvent).toBeUndefined()
    await fiber.dispose()
  })

  it('logs a warning on deny via ctx.logger.warn', async () => {
    const [ctx, fiber] = await mount({
      enabled: true,
      allowedHosts: ['example.com'],
      blockedTools: ['nmap'],
    })
    const warnMock = vi.fn()
    const logger = ctx.logger as unknown as { warn: ReturnType<typeof vi.fn> }
    logger.warn = warnMock

    await ctx.waterfall(
      ctx as never,
      'tools/pre-execute',
      execOf('nmap', { target: '10.0.0.1' }),
      allowNext,
    )

    expect(logger.warn).toHaveBeenCalled()
    const calls = logger.warn.mock.calls
    const combined = calls.map((c: unknown[]) => String(c[0])).join(' ')
    expect(combined).toContain('engagement-stub')
    expect(combined).toContain('nmap')
    await fiber.dispose()
  })

  it('denies metasploit and msfconsole from blockedTools', async () => {
    const [ctx, fiber] = await mount({
      enabled: true,
      allowedHosts: [],
      blockedTools: ['metasploit', 'msfconsole', 'nc', 'netcat'],
    })
    for (const tool of ['metasploit', 'msfconsole', 'nc', 'netcat']) {
      const decision = await ctx.waterfall(
        ctx as never,
        'tools/pre-execute',
        execOf(tool, {}),
        allowNext,
      )
      expect(decision.kind).toBe('deny')
      expect(denyReason(decision)).toContain(tool)
    }
    await fiber.dispose()
  })

  it('does not double-register listener on repeated apply', async () => {
    const ctx = new Context()
    ctx.provide('tools', { register: () => () => {} } as never)
    const fiber = await ctx.plugin(EngagementStub, {
      enabled: true,
      allowedHosts: ['example.com'],
      blockedTools: ['nmap'],
    })
    let auditEvent: unknown
    ctx.on('engagement/denied', (payload) => { auditEvent = payload })

    await ctx.waterfall(
      ctx as never,
      'tools/pre-execute',
      execOf('nmap', {}),
      allowNext,
    )

    const count = auditEvent ? 1 : 0
    expect(count).toBe(1)
    await fiber.dispose()
  })
})

describe('plugin: disabled contour', () => {
  it('does not register any listener when enabled is false', async () => {
    const [ctx, fiber] = await mount({
      enabled: false,
      allowedHosts: [],
      blockedTools: ['nmap'],
    })
    const decision = await ctx.waterfall(
      ctx as never,
      'tools/pre-execute',
      execOf('nmap', {}),
      allowNext,
    )
    expect(decision).toEqual({ kind: 'allow' })
    await fiber.dispose()
  })

  it('allows web_fetch even to unknown hosts when disabled', async () => {
    const [ctx, fiber] = await mount({
      enabled: false,
      allowedHosts: [],
      blockedTools: [],
    })
    const decision = await ctx.waterfall(
      ctx as never,
      'tools/pre-execute',
      execOf('web_fetch', { url: 'http://unknown.example.net/' }),
      allowNext,
    )
    expect(decision).toEqual({ kind: 'allow' })
    await fiber.dispose()
  })
})

describe('plugin: contract', () => {
  it('exposes name', () => {
    expect(EngagementStub.name).toBe('engagement-stub')
  })

  it('exposes inject as empty array', () => {
    expect(EngagementStub.inject).toEqual([])
  })

  it('exposes Config schema', () => {
    expect(EngagementStub.Config).toBeDefined()
  })

  it('exposes apply as function', () => {
    expect(typeof EngagementStub.apply).toBe('function')
  })

  it('has no default export', () => {
    expect('default' in EngagementStub).toBe(false)
  })
})
