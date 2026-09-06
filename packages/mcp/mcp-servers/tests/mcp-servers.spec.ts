/**
 * Service tests for the MCP server registry connector: save/remove converge
 * the deployed `mcp-client` set, user/project scopes merge with user
 * priority, malformed registries fail loud without losing data, and disposing
 * the service unwinds every mounted tool (the HMR-safety requirement).
 *
 * The real `dsh-mcp-client` bridge is mocked: these tests own registry →
 * deployment behavior, while the bridge's own suites own the MCP wire.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { readFile, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'

// The bridge `apply` must be an arrow function: Cordis treats a
// prototype-bearing function as a constructor and would discard its returned
// Promise. Calls are recorded into `calls` for assertions.
const { apply, calls } = vi.hoisted(() => {
  const calls: Array<{ config: { serverName: string; transport: string } }> = []
  const apply = async (
    ctx: { tools: { register: (def: object) => () => void } },
    config: { serverName: string },
  ): Promise<() => void> => {
    calls.push({ config: config as { serverName: string; transport: string } })
    const dispose = ctx.tools.register({
      name: `mcp__${config.serverName}__ping`,
      description: 'mock ping tool',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      output: {
        schema: { type: 'object', properties: {}, additionalProperties: false },
        render: () => [{ type: 'text', text: 'mock ping' }],
      },
    })
    return () => { dispose() }
  }
  return { apply, calls }
})

vi.mock('@deepseek-ai/dsh-mcp-client', () => ({
  name: 'mcp-client',
  inject: ['tools'],
  apply,
}))

// vi.mock is hoisted above static imports, so the module under test sees the
// mocked bridge even through a static import.
import McpServers, { DEFAULT_PROJECT_REGISTRY_FILE, DEFAULT_USER_REGISTRY_FILE } from '@deepseek-ai/dsh-mcp-servers'
import type { Config as ServiceConfig } from '@deepseek-ai/dsh-mcp-servers'

async function makeTempDir(): Promise<string> {
  return await mkdtemp(join(tmpdir(), 'mcp-servers-test-'))
}

function serviceConfig(userFile: string, overrides: Partial<ServiceConfig> = {}): ServiceConfig {
  return {
    userFile,
    includeProjectFile: false,
    projectFile: '',
    watch: false,
    ...overrides,
  }
}

async function mountService(userFile: string, overrides: Partial<ServiceConfig> = {}): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(McpServers, serviceConfig(userFile, overrides))
  await ctx.mcpServers.requestReconcile()
  return ctx
}

async function readJson(file: string): Promise<unknown> {
  return JSON.parse(await readFile(file, 'utf8'))
}

describe('mcp-servers service', () => {
  beforeEach(() => {
    calls.length = 0
  })

  it('exports module identity and default file names', async () => {
    const dir = await makeTempDir()
    const file = join(dir, 'mcpServers.json')
    const ctx = await mountService(file)
    expect(ctx.mcpServers).toBeInstanceOf(McpServers)
    expect(DEFAULT_USER_REGISTRY_FILE).toBe('mcpServers.json')
    expect(DEFAULT_PROJECT_REGISTRY_FILE).toBe('.mcp.json')
    await ctx.fiber.dispose()
    await rm(dir, { recursive: true, force: true })
  })

  it('deploys a saved stdio server and reports it connected', async () => {
    const dir = await makeTempDir()
    const file = join(dir, 'mcpServers.json')
    const ctx = await mountService(file)
    const status = await ctx.mcpServers.saveUserServer('demo', { command: 'node', args: ['--version'] })
    expect(status.error).toBeUndefined()
    expect(status).toMatchObject({
      name: 'demo', source: 'user', kind: 'stdio', state: 'connected', toolCount: 1, enabled: true,
    })
    expect(status.file).toBe(file)
    expect(calls).toHaveLength(1)
    expect(calls[0]!.config).toMatchObject({
      transport: 'stdio', serverName: 'demo', command: 'node', args: ['--version'],
    })
    expect(ctx.tools.get('mcp__demo__ping')).toBeDefined()
    const document = await readJson(file) as { mcpServers: Record<string, unknown> }
    expect(document.mcpServers.demo).toEqual({ command: 'node', args: ['--version'] })
    await ctx.fiber.dispose()
    await rm(dir, { recursive: true, force: true })
  })

  it('remove disposes the deployed server and empties the registry entry', async () => {
    const dir = await makeTempDir()
    const file = join(dir, 'mcpServers.json')
    const ctx = await mountService(file)
    await ctx.mcpServers.saveUserServer('demo', { command: 'node' })
    await ctx.mcpServers.removeUserServer('demo')
    expect(ctx.mcpServers.list()).toEqual([])
    expect(ctx.tools.get('mcp__demo__ping')).toBeUndefined()
    expect(calls).toHaveLength(1)
    const document = await readJson(file) as { mcpServers: Record<string, unknown> }
    expect(document.mcpServers).toEqual({})
    await ctx.fiber.dispose()
    await rm(dir, { recursive: true, force: true })
  })

  it('editing an entry redeploys over the old generation', async () => {
    const dir = await makeTempDir()
    const file = join(dir, 'mcpServers.json')
    const ctx = await mountService(file)
    await ctx.mcpServers.saveUserServer('demo', { command: 'node' })
    const status = await ctx.mcpServers.saveUserServer('demo', { url: 'https://example.test/mcp' })
    expect(status.kind).toBe('streamable-http')
    expect(status.state).toBe('connected')
    expect(status.toolCount).toBe(1)
    expect(calls).toHaveLength(2)
    expect(calls[1]!.config).toMatchObject({
      transport: 'streamable-http', serverName: 'demo', url: 'https://example.test/mcp',
    })
    await ctx.fiber.dispose()
    await rm(dir, { recursive: true, force: true })
  })

  it('invalid saves reject without touching the registry or the bridge', async () => {
    const dir = await makeTempDir()
    const file = join(dir, 'mcpServers.json')
    const ctx = await mountService(file)
    await expect(ctx.mcpServers.saveUserServer('bad name!', { command: 'x' }))
      .rejects.toThrow(/invalid server name/)
    await expect(ctx.mcpServers.saveUserServer('demo', {})).rejects.toThrow(/require a "command"/)
    expect(calls).toHaveLength(0)
    expect(existsSync(file)).toBe(false)
    await ctx.fiber.dispose()
    await rm(dir, { recursive: true, force: true })
  })

  it('a malformed user registry is skipped and refuses silent overwrite', async () => {
    const dir = await makeTempDir()
    const file = join(dir, 'mcpServers.json')
    await writeFile(file, '{broken', 'utf8')
    const ctx = await mountService(file)
    expect(ctx.mcpServers.list()).toEqual([])
    await expect(ctx.mcpServers.saveUserServer('demo', { command: 'x' }))
      .rejects.toThrow(/not valid JSON/)
    expect(calls).toHaveLength(0)
    await ctx.fiber.dispose()
    await rm(dir, { recursive: true, force: true })
  })

  it('reads the project registry and defers duplicate names to the user scope', async () => {
    const dir = await makeTempDir()
    const userFile = join(dir, 'mcpServers.json')
    const projectFile = join(dir, '.mcp.json')
    await writeFile(userFile, JSON.stringify({ mcpServers: { demo: { command: 'user-cmd' } } }), 'utf8')
    await writeFile(projectFile, JSON.stringify({
      mcpServers: { demo: { command: 'proj-cmd' }, extra: { url: 'https://proj.test/mcp' } },
    }), 'utf8')
    const ctx = await mountService(userFile, { includeProjectFile: true, projectFile })
    const statuses = ctx.mcpServers.list()
    expect(statuses.map(item => [item.name, item.source, item.command ?? item.url])).toEqual([
      ['demo', 'user', 'user-cmd'],
      ['extra', 'project', 'https://proj.test/mcp'],
    ])
    const demoCalls = calls.filter(({ config }) => config.serverName === 'demo')
    expect(demoCalls).toHaveLength(1)
    expect(demoCalls[0]!.config).toMatchObject({ command: 'user-cmd' })
    await ctx.fiber.dispose()
    await rm(dir, { recursive: true, force: true })
  })

  it('lists disabled entries without deploying them', async () => {
    const dir = await makeTempDir()
    const file = join(dir, 'mcpServers.json')
    await writeFile(file, JSON.stringify({ mcpServers: { off: { command: 'x', enabled: false } } }), 'utf8')
    const ctx = await mountService(file)
    const statuses = ctx.mcpServers.list()
    expect(statuses).toEqual([expect.objectContaining({ name: 'off', enabled: false, state: 'disabled', toolCount: 0 })])
    expect(calls).toHaveLength(0)
    await ctx.fiber.dispose()
    await rm(dir, { recursive: true, force: true })
  })

  it('unmounts every deployed tool when the service fiber is disposed', async () => {
    const dir = await makeTempDir()
    const file = join(dir, 'mcpServers.json')
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    const fiber = ctx.plugin(McpServers, serviceConfig(file))
    await fiber
    await ctx.mcpServers.requestReconcile()
    await ctx.mcpServers.saveUserServer('demo', { command: 'node' })
    expect(ctx.tools.get('mcp__demo__ping')).toBeDefined()
    await fiber.dispose()
    expect(ctx.tools.get('mcp__demo__ping')).toBeUndefined()
    await rm(dir, { recursive: true, force: true })
  })
})
