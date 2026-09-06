/**
 * Registry parsing for MCP servers: turns a Claude-Code-compatible
 * `mcpServers` document (user `$DSH_HOME/mcpServers.json`, project
 * `.mcp.json`) into validated per-server plans the {@link McpServers} service
 * deploys as `@deepseek-ai/dsh-mcp-client` instances.
 *
 * Pure module: no filesystem or context access, so every decision is unit
 * testable with a plain object and an environment map.
 * @module @deepseek-ai/dsh-mcp-servers/registry
 */

import type { Config as McpClientConfig } from '@deepseek-ai/dsh-mcp-client'

/**
 * Server name namespace contract, mirrored from `dsh-mcp-client`: the name
 * becomes the `mcp__<serverName>__<tool>` prefix, so it must fit the DeepSeek
 * function-name alphabet and the client's 32-character budget.
 */
export const SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/

/** Which registry file a desired server came from. */
export type RegistrySource = 'user' | 'project'

/**
 * One server entry as written in a registry document. The stdio shape
 * (`command`/`args`/`env`/`cwd`) and the HTTP shape (`url`/`headers`) follow
 * the Claude Code `mcpServers` convention; the transport is derived from the
 * presence of `url`. `enabled` is a DeepSeek Harness extension for a
 * temporarily disabled server (other clients ignore unknown keys).
 */
export interface RegistryServerEntry {
  /** Executable that starts the stdio server. */
  command?: string
  /** Arguments passed to the command without shell interpolation. */
  args?: string[]
  /** Extra environment variables passed to the child process. */
  env?: Record<string, string>
  /** Working directory for the child process; relative paths resolve against the host process. */
  cwd?: string
  /** MCP endpoint URL selecting the streamable-HTTP transport. */
  url?: string
  /** Extra headers attached to MCP HTTP requests. */
  headers?: Record<string, string>
  /** Whether this server is deployed; omitted means enabled. */
  enabled?: boolean
}

/** The wire document format shared with Claude Code and other MCP clients. */
export interface RegistryDocument {
  /** Named server entries; the map key is the server name. */
  mcpServers?: Record<string, RegistryServerEntry>
}

/**
 * A validated deployment plan for one registry server, or the diagnostic for
 * a server that failed validation. An `error` plan is never deployed and
 * appears in status listings so a misconfiguration stays user-visible.
 */
export interface DesiredMcpServer {
  /** Registry map key, already validated against {@link SERVER_NAME_PATTERN}. */
  name: string
  /** The registry file this server was declared in. */
  source: RegistrySource
  /** Deployment switch; `false` keeps the entry listed but never starts it. */
  enabled: boolean
  /** Resolved transport; absent on an invalid plan. */
  kind?: 'stdio' | 'streamable-http'
  /** Interpolated executable, present on a valid stdio plan. */
  command?: string
  /** Interpolated endpoint URL, present on a valid HTTP plan. */
  url?: string
  /** Human-readable validation failure; present exactly on an invalid plan. */
  error?: string
  /** `dsh-mcp-client` configuration, present exactly on a valid enabled plan. */
  config?: McpClientConfig
}

/** Default per-tool-call timeout deployed on registry servers, ms. */
export const DEFAULT_TOOL_CALL_TIMEOUT_MS = 60_000

/**
 * Expand `${VAR}` references against an environment map. Only variables that
 * exist are substituted; an unresolved reference stays literal so a server
 * command containing `$` for its own reasons is never corrupted.
 * @param value - string that may contain `${VAR}` references.
 * @param env - environment map (defaults to the process environment).
 * @returns the value with resolvable references substituted.
 */
export function expandEnvReferences(value: string, env: Record<string, string | undefined> = process.env): string {
  return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (match, name: string) => {
    const resolved = env[name]
    return resolved === undefined || resolved.length === 0 ? match : resolved
  })
}

/**
 * Whether a record holds only string values.
 * @param value - candidate environment or header map.
 * @returns true when every own value is a string.
 */
function isStringRecord(value: unknown): value is Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  return Object.values(value).every(item => typeof item === 'string')
}

/**
 * Parse one `mcpServers` document into per-server plans.
 *
 * A missing or empty document yields no plans; a malformed entry yields an
 * `error` plan for that name so a single typo never blanks the whole registry.
 * @param document - parsed JSON value of the registry file.
 * @param source - which registry the document came from.
 * @param env - environment map used for `${VAR}` interpolation.
 * @returns one plan per declared server, invalid entries carrying {@link DesiredMcpServer.error}.
 */
export function parseRegistryDocument(
  document: unknown,
  source: RegistrySource,
  env: Record<string, string | undefined> = process.env,
): DesiredMcpServer[] {
  if (typeof document !== 'object' || document === null || Array.isArray(document)) {
    return [{
      name: '(document)', source, enabled: false,
      error: 'registry document must be a JSON object with an "mcpServers" member',
    }]
  }
  const declared = (document as { mcpServers?: unknown }).mcpServers
  if (declared === undefined) return []
  if (typeof declared !== 'object' || declared === null || Array.isArray(declared)) {
    return [{
      name: '(document)', source, enabled: false,
      error: '"mcpServers" must be an object mapping server names to entries',
    }]
  }
  const servers: DesiredMcpServer[] = []
  for (const [name, raw] of Object.entries(declared as Record<string, unknown>)) {
    servers.push(parseServerEntry(name, raw, source, env))
  }
  return servers
}

/**
 * Parse and validate one named server entry into a deployment plan.
 * @param name - registry map key; must match {@link SERVER_NAME_PATTERN}.
 * @param raw - the entry value.
 * @param source - which registry the entry came from.
 * @param env - environment map used for `${VAR}` interpolation.
 * @returns the validated plan or an `error` plan naming the exact failure.
 */
export function parseServerEntry(
  name: string,
  raw: unknown,
  source: RegistrySource,
  env: Record<string, string | undefined> = process.env,
): DesiredMcpServer {
  if (!SERVER_NAME_PATTERN.test(name)) {
    return {
      name, source, enabled: false,
      error: `invalid server name "${name}" (must match ${SERVER_NAME_PATTERN.source} so tool names stay valid)`,
    }
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { name, source, enabled: false, error: 'server entry must be an object' }
  }
  const entry = raw as Record<string, unknown>
  const enabled = entry.enabled !== false

  // An HTTP endpoint is selected by a non-empty `url`; anything else must be
  // a stdio `command`. A server that declares both fails loud: the transport
  // the user sees in listings would be ambiguous.
  const urlValue = typeof entry.url === 'string' ? entry.url.trim() : ''
  const commandValue = typeof entry.command === 'string' ? entry.command : ''
  if (urlValue.length > 0 && commandValue.length > 0) {
    return { name, source, enabled, error: 'server must declare either "command" (stdio) or "url" (streamable HTTP), not both' }
  }
  if (urlValue.length > 0) {
    if (typeof entry.headers !== 'undefined' && !isStringRecord(entry.headers)) {
      return { name, source, enabled, error: '"headers" must be an object mapping header names to strings' }
    }
    const headers = entry.headers === undefined ? {} : entry.headers
    return {
      name, source, enabled, kind: 'streamable-http',
      url: expandEnvReferences(urlValue, env),
      config: {
        transport: 'streamable-http',
        serverName: name,
        url: expandEnvReferences(urlValue, env),
        headers: mapValues(headers, value => expandEnvReferences(value, env)),
        toolCallTimeoutMs: DEFAULT_TOOL_CALL_TIMEOUT_MS,
        failOnStartupError: false,
      },
    }
  }
  if (commandValue.length === 0) {
    return { name, source, enabled, error: 'stdio servers require a "command" string (or a "url" for streamable HTTP)' }
  }
  if (typeof entry.args !== 'undefined' && (!Array.isArray(entry.args) || !entry.args.every(item => typeof item === 'string'))) {
    return { name, source, enabled, error: '"args" must be an array of strings' }
  }
  if (typeof entry.env !== 'undefined' && !isStringRecord(entry.env)) {
    return { name, source, enabled, error: '"env" must be an object mapping variable names to strings' }
  }
  if (typeof entry.cwd !== 'undefined' && typeof entry.cwd !== 'string') {
    return { name, source, enabled, error: '"cwd" must be a string' }
  }
  const args = entry.args === undefined ? [] : entry.args
  const envOverlay = entry.env === undefined ? {} : entry.env
  const cwd = entry.cwd === undefined ? '' : entry.cwd
  return {
    name, source, enabled, kind: 'stdio',
    command: expandEnvReferences(commandValue, env),
    config: {
      transport: 'stdio',
      serverName: name,
      command: expandEnvReferences(commandValue, env),
      args: args.map(value => expandEnvReferences(value, env)),
      env: mapValues(envOverlay, value => expandEnvReferences(value, env)),
      cwd: cwd === '' ? '' : expandEnvReferences(cwd, env),
      toolCallTimeoutMs: DEFAULT_TOOL_CALL_TIMEOUT_MS,
      failOnStartupError: false,
    },
  }
}

/**
 * Map every value of a string record, keeping the key order stable.
 * @param record - source record.
 * @param map - per-value transform.
 * @returns a fresh record with transformed values.
 */
function mapValues(record: Record<string, string>, map: (value: string) => string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(record)) out[key] = map(value)
  return out
}

/**
 * Validate one entry the user is about to save, reusing the parse path so
 * save and deploy agree on what is legal.
 * @param name - proposed server name.
 * @param entry - proposed entry body.
 * @param env - environment map used for interpolation checks.
 * @returns the parsed plan; an `error` plan means the entry must not be saved.
 */
export function validateRegistryEntry(
  name: string,
  entry: unknown,
  env: Record<string, string | undefined> = process.env,
): DesiredMcpServer {
  return parseServerEntry(name, entry, 'user', env)
}
