/**
 * Unit tests for registry parsing: entry validation, transport derivation,
 * `${VAR}` interpolation, and document-level error plans.
 */
import { describe, expect, it } from 'vitest'
import {
  expandEnvReferences, parseRegistryDocument, parseServerEntry, validateRegistryEntry,
  SERVER_NAME_PATTERN,
} from '@deepseek-ai/dsh-mcp-servers/src/registry.ts'

const env = { TOKEN: 'secret', EMPTY: '', UNRELATED: 'x' } as Record<string, string | undefined>

describe('expandEnvReferences', () => {
  it('substitutes a resolvable variable', () => {
    expect(expandEnvReferences('npx ${TOKEN} run', env)).toBe('npx secret run')
  })

  it('keeps an unresolvable reference literal', () => {
    expect(expandEnvReferences('${MISSING} and ${TOKEN}', env)).toBe('${MISSING} and secret')
  })

  it('keeps an empty-valued variable literal', () => {
    expect(expandEnvReferences('${EMPTY}', env)).toBe('${EMPTY}')
  })

  it('leaves strings without references untouched', () => {
    expect(expandEnvReferences('plain $HOME text', env)).toBe('plain $HOME text')
  })
})

describe('parseRegistryDocument', () => {
  it('yields no servers for an empty document', () => {
    expect(parseRegistryDocument({}, 'user')).toEqual([])
    expect(parseRegistryDocument({ mcpServers: {} }, 'user')).toEqual([])
  })

  it('reports a non-object document as one error plan', () => {
    const plan = parseRegistryDocument('nope', 'user')[0]!
    expect(plan.name).toBe('(document)')
    expect(plan.error).toMatch(/JSON object/)
  })

  it('reports a non-object mcpServers member', () => {
    const plan = parseRegistryDocument({ mcpServers: [] }, 'project')[0]!
    expect(plan.error).toMatch(/"mcpServers" must be an object/)
  })

  it('parses a stdio entry into an mcp-client configuration', () => {
    const plan = parseRegistryDocument({
      mcpServers: {
        demo: { command: 'npx', args: ['-y', '@scope/server', '--token=${TOKEN}'], env: { TOKEN: '${TOKEN}' }, cwd: '/tmp' },
      },
    }, 'user', env)[0]!
    expect(plan.error).toBeUndefined()
    expect(plan.name).toBe('demo')
    expect(plan.source).toBe('user')
    expect(plan.enabled).toBe(true)
    expect(plan.kind).toBe('stdio')
    expect(plan.command).toBe('npx')
    expect(plan.config).toMatchObject({
      transport: 'stdio',
      serverName: 'demo',
      command: 'npx',
      args: ['-y', '@scope/server', '--token=secret'],
      env: { TOKEN: 'secret' },
      cwd: '/tmp',
    })
  })

  it('defaults stdio args, env, and cwd', () => {
    const plan = parseServerEntry('min', { command: 'echo' }, 'user')
    expect(plan.config).toMatchObject({ transport: 'stdio', args: [], env: {}, cwd: '' })
    expect(plan.config).toHaveProperty('toolCallTimeoutMs')
    expect(plan.config).toHaveProperty('failOnStartupError', false)
  })

  it('parses a streamable-http entry and interpolates url and headers', () => {
    const plan = parseRegistryDocument({
      mcpServers: { remote: { url: 'https://example.test/mcp?t=${TOKEN}', headers: { Authorization: 'Bearer ${TOKEN}' } } },
    }, 'project', env)[0]!
    expect(plan.error).toBeUndefined()
    expect(plan.kind).toBe('streamable-http')
    expect(plan.url).toBe('https://example.test/mcp?t=secret')
    expect(plan.config).toMatchObject({
      transport: 'streamable-http',
      serverName: 'remote',
      url: 'https://example.test/mcp?t=secret',
      headers: { Authorization: 'Bearer secret' },
    })
  })

  it('honors enabled: false without losing the entry', () => {
    const plan = parseServerEntry('off', { command: 'echo', enabled: false }, 'user')
    expect(plan.enabled).toBe(false)
    expect(plan.error).toBeUndefined()
    expect(plan.config).toBeDefined()
  })

  it('rejects an invalid server name', () => {
    const plan = parseServerEntry('bad name!', { command: 'echo' }, 'user')
    expect(plan.error).toMatch(/invalid server name/)
  })

  it('rejects an entry that is not an object', () => {
    const plan = parseServerEntry('demo', 'echo', 'user')
    expect(plan.error).toMatch(/must be an object/)
  })

  it('rejects an entry with neither command nor url', () => {
    const plan = parseServerEntry('empty', {}, 'user')
    expect(plan.error).toMatch(/require a "command"/)
  })

  it('rejects an entry declaring both command and url', () => {
    const plan = parseServerEntry('both', { command: 'echo', url: 'https://x' }, 'user')
    expect(plan.error).toMatch(/not both/)
  })

  it('rejects non-string args, env, headers, and cwd', () => {
    expect(parseServerEntry('a', { command: 'x', args: [1] }, 'user').error).toMatch(/"args"/)
    expect(parseServerEntry('b', { command: 'x', env: { K: 1 } }, 'user').error).toMatch(/"env"/)
    expect(parseServerEntry('c', { url: 'https://x', headers: ['a'] }, 'user').error).toMatch(/"headers"/)
    expect(parseServerEntry('d', { command: 'x', cwd: 1 }, 'user').error).toMatch(/"cwd"/)
  })

  it('ignores unknown entry keys for forward compatibility', () => {
    const plan = parseServerEntry('future', { command: 'echo', type: 'stdio', autoApprove: [] }, 'user')
    expect(plan.error).toBeUndefined()
  })

  it('validates a would-be saved entry through the same parser', () => {
    expect(validateRegistryEntry('ok', { command: 'echo' }).error).toBeUndefined()
    expect(validateRegistryEntry('bad', {}).error).toMatch(/require a "command"/)
  })
})

describe('SERVER_NAME_PATTERN', () => {
  it('accepts the namespace alphabet and rejects everything else', () => {
    expect(SERVER_NAME_PATTERN.test('github-prod_1')).toBe(true)
    expect(SERVER_NAME_PATTERN.test('a'.repeat(32))).toBe(true)
    expect(SERVER_NAME_PATTERN.test('a'.repeat(33))).toBe(false)
    expect(SERVER_NAME_PATTERN.test('has dot.name')).toBe(false)
  })
})
