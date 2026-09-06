/**
 * Tests for the `dsh mcp` registry-management command: add/list/remove/
 * enable/disable against temporary user and project registry files, argument
 * validation, and error handling for a damaged registry.
 */
import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { RegistryDocument } from '@deepseek-ai/dsh-mcp-servers'
import { runMcp } from '../src/mcp.ts'

interface Harness {
  home: string
  project: string
  out: string[]
  err: string[]
}

async function makeHarness(): Promise<Harness> {
  const home = await mkdtemp(join(tmpdir(), 'dsh-mcp-home-'))
  const project = await mkdtemp(join(tmpdir(), 'dsh-mcp-project-'))
  return { home, project, out: [], err: [] }
}

function ioOf(harness: Harness) {
  return {
    cwd: harness.project,
    dshHome: harness.home,
    stdout: (line: string) => harness.out.push(line),
    stderr: (line: string) => harness.err.push(line),
  }
}

async function readRegistry(file: string): Promise<RegistryDocument> {
  return JSON.parse(await readFile(file, 'utf8')) as RegistryDocument
}

async function teardown(harness: Harness): Promise<void> {
  await rm(harness.home, { recursive: true, force: true })
  await rm(harness.project, { recursive: true, force: true })
}

describe('dsh mcp command', () => {
  it('adds a stdio server to the user registry and lists it', async () => {
    const harness = await makeHarness()
    try {
      const code = await runMcp([
        'add', 'demo', '--command', 'npx', '--arg', '-y',
        '--arg', '@modelcontextprotocol/server-demo', '--env', 'TOKEN=secret',
      ], ioOf(harness))
      expect(code).toBe(0)
      const file = join(harness.home, 'mcpServers.json')
      expect(existsSync(file)).toBe(true)
      const document = await readRegistry(file)
      expect(document.mcpServers?.demo).toEqual({
        command: 'npx', args: ['-y', '@modelcontextprotocol/server-demo'], env: { TOKEN: 'secret' },
      })

      const listCode = await runMcp(['list', '--user'], ioOf(harness))
      expect(listCode).toBe(0)
      expect(harness.out.join('')).toContain('demo\tuser\tstdio\tyes\tnpx -y @modelcontextprotocol/server-demo')
    } finally {
      await teardown(harness)
    }
  })

  it('adds a streamable-http server to the project registry with headers', async () => {
    const harness = await makeHarness()
    try {
      const code = await runMcp([
        'add', 'remote', '--project', '--url', 'https://example.test/mcp', '--header', 'Authorization=Bearer t',
      ], ioOf(harness))
      expect(code).toBe(0)
      const file = join(harness.project, '.mcp.json')
      expect(existsSync(file)).toBe(true)
      const document = await readRegistry(file)
      expect(document.mcpServers?.remote).toEqual({
        url: 'https://example.test/mcp', headers: { Authorization: 'Bearer t' },
      })
    } finally {
      await teardown(harness)
    }
  })

  it('lists json output for both scopes with their file sources', async () => {
    const harness = await makeHarness()
    try {
      await runMcp(['add', 'user-server', '--command', 'node'], ioOf(harness))
      await runMcp(['add', 'proj-server', '--url', 'https://proj.test/mcp', '--project'], ioOf(harness))
      harness.out.length = 0
      const code = await runMcp(['list', '--json'], ioOf(harness))
      expect(code).toBe(0)
      const records = JSON.parse(harness.out.join('')) as Array<Record<string, unknown>>
      const byName = Object.fromEntries(records.map(record => [String(record.name), record])) as Record<string, Record<string, unknown>>
      expect(byName['user-server']).toMatchObject({ scope: 'user', kind: 'stdio', command: 'node' })
      expect(byName['proj-server']).toMatchObject({ scope: 'project', kind: 'streamable-http', url: 'https://proj.test/mcp' })
    } finally {
      await teardown(harness)
    }
  })

  it('remove and disable round-trip through the registry file', async () => {
    const harness = await makeHarness()
    try {
      await runMcp(['add', 'demo', '--command', 'node'], ioOf(harness))
      const disableCode = await runMcp(['disable', 'demo'], ioOf(harness))
      expect(disableCode).toBe(0)
      const file = join(harness.home, 'mcpServers.json')
      expect((await readRegistry(file)).mcpServers?.demo).toEqual({ command: 'node', enabled: false })

      const enableCode = await runMcp(['enable', 'demo'], ioOf(harness))
      expect(enableCode).toBe(0)
      expect((await readRegistry(file)).mcpServers?.demo).toEqual({ command: 'node' })

      const removeCode = await runMcp(['remove', 'demo'], ioOf(harness))
      expect(removeCode).toBe(0)
      expect((await readRegistry(file)).mcpServers?.demo).toBeUndefined()
    } finally {
      await teardown(harness)
    }
  })

  it('rejects invalid additions with exit code 1 and no registry write', async () => {
    const harness = await makeHarness()
    try {
      const noTarget = await runMcp(['add', 'demo'], ioOf(harness))
      expect(noTarget).toBe(1)
      expect(harness.err.join('')).toContain('requires --command')

      harness.err.length = 0
      const both = await runMcp(['add', 'demo', '--command', 'node', '--url', 'https://x'], ioOf(harness))
      expect(both).toBe(1)
      expect(harness.err.join('')).toContain('either --command or --url')

      harness.err.length = 0
      const badName = await runMcp(['add', 'bad name!', '--command', 'node'], ioOf(harness))
      expect(badName).toBe(1)
      expect(harness.err.join('')).toContain('invalid server name')

      harness.err.length = 0
      const badEnv = await runMcp(['add', 'demo', '--command', 'node', '--env', 'NOVALUE'], ioOf(harness))
      expect(badEnv).toBe(1)
      expect(harness.err.join('')).toContain('--env expects KEY=VALUE')

      expect(existsSync(join(harness.home, 'mcpServers.json'))).toBe(false)
    } finally {
      await teardown(harness)
    }
  })

  it('rejects remove of an unknown server and edits of a damaged registry', async () => {
    const harness = await makeHarness()
    try {
      const unknown = await runMcp(['remove', 'ghost'], ioOf(harness))
      expect(unknown).toBe(1)
      expect(harness.err.join('')).toContain('not declared')

      const file = join(harness.home, 'mcpServers.json')
      await writeFile(file, '{broken', 'utf8')
      const damaged = await runMcp(['add', 'demo', '--command', 'node'], ioOf(harness))
      expect(damaged).toBe(1)
      expect(harness.err.join('')).toContain('not valid JSON')
    } finally {
      await teardown(harness)
    }
  })

  it('prints an empty listing when nothing is declared', async () => {
    const harness = await makeHarness()
    try {
      const code = await runMcp(['list'], ioOf(harness))
      expect(code).toBe(0)
      expect(harness.out.join('')).toContain('(no MCP servers declared)')
    } finally {
      await teardown(harness)
    }
  })
})
