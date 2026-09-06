/**
 * Real-composition proof for the mcp-servers registry connector: boots the
 * actual Cordis Loader over a test-only composition, saves one registry entry
 * pointing at the package-owned keyless MCP fixture server, and proves the
 * real `dsh-mcp-client` bridge connects and registers a `mcp__<name>__*`
 * tool — the whole registry → deploy → tools path a profile exercises.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import { boot } from '@deepseek-ai/dsh-app-boot'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as McpServersModule from '@deepseek-ai/dsh-mcp-servers'
import type { Config as ServiceConfig } from '@deepseek-ai/dsh-mcp-servers'

const root = resolve(import.meta.dirname, '../../../..')
const baseConfig = resolve(import.meta.dirname, 'fixtures/mcp-servers-base.cordis.yml')
const fixtureServer = resolve(root, 'packages/mcp/mcp-client/tests/fixture-server.ts')

const liveContexts = new Set<Context>()

afterEach(async () => {
  await Promise.all([...liveContexts].map(async ctx => ctx.fiber.dispose()))
  liveContexts.clear()
})

async function waitForTool(ctx: Context, name: string): Promise<void> {
  const deadline = Date.now() + 15_000
  while (!ctx.tools.schemas().some(schema => schema.name === name)) {
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${name}`)
    await new Promise(resolveWait => setTimeout(resolveWait, 25))
  }
}

describe('mcp-servers registry connector real composition', () => {
  it('deploys a saved registry server and exposes its tools to the host tool registry', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mcp-servers-e2e-'))
    const userFile = join(dir, 'mcpServers.json')
    const config: ServiceConfig = { userFile, includeProjectFile: false, projectFile: '', watch: false }
    const patch: PatchOptions = { id: 'mcp-servers', config }
    const ctx = await boot('mcp-servers-e2e', baseConfig, [patch], (booted) => {
      liveContexts.add(booted)
      booted.loader.builtins['mcp-servers-test-system-prompt'] = SystemPrompt
      booted.loader.builtins['mcp-servers-test-tools'] = ToolRuntime
      booted.loader.builtins['mcp-servers-test'] = McpServersModule
    })

    expect(ctx.mcpServers.list()).toEqual([])

    const status = await ctx.mcpServers.saveUserServer('fixture', {
      command: process.execPath,
      args: [fixtureServer],
      cwd: root,
    })
    await waitForTool(ctx, 'mcp__fixture__greet')
    expect(status.state).toBe('connected')
    expect(status.toolCount).toBeGreaterThanOrEqual(1)
    const listed = ctx.mcpServers.list().find(server => server.name === 'fixture')
    expect(listed?.state).toBe('connected')
    expect(listed?.toolCount).toBeGreaterThanOrEqual(1)

    await ctx.mcpServers.removeUserServer('fixture')
    expect(ctx.tools.get('mcp__fixture__greet')).toBeUndefined()
    await rm(dir, { recursive: true, force: true })
  }, 30_000)
})
