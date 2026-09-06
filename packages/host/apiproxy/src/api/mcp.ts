/**
 * mcp domain contract: the MCP server registry a browser manages — list the
 * declared servers with their live deployment state, save (add or replace)
 * one user-registry server, and remove one. The registry itself is owned by
 * the Host (`@deepseek-ai/dsh-mcp-servers`); this domain carries ids and
 * entry bodies only, never Host paths.
 */

import type { RpcRequest, RpcResponse } from './rpc.ts'

/** Which registry a server was declared in. */
export type McpServerSource = 'user' | 'project'

/** Live deployment state of one server. */
export type McpServerState = 'disabled' | 'connected' | 'starting' | 'error'

/** One declared server as the browser lists it. */
export interface McpServerView {
  /** Registry key; also the `mcp__<name>__*` tool namespace. */
  readonly name: string
  /** Which registry declared this server. */
  readonly source: McpServerSource
  /** Resolved transport; absent only when the entry failed validation. */
  readonly kind?: 'stdio' | 'streamable-http'
  /** Deployment switch. */
  readonly enabled: boolean
  /** Interpolated executable (stdio servers). */
  readonly command?: string
  /** Interpolated endpoint URL (HTTP servers). */
  readonly url?: string
  /** Live deployment state. */
  readonly state: McpServerState
  /** Number of registered `mcp__<name>__*` tools. */
  readonly toolCount: number
  /** Validation or deployment failure text; present in the `error` state. */
  readonly error?: string
}

/** One server entry body the browser saves, Claude-Code-compatible. */
export interface McpServerEntryView {
  /** Executable that starts the stdio server. */
  readonly command?: string
  /** Arguments passed without shell interpolation. */
  readonly args?: string[]
  /** Extra child environment variables. */
  readonly env?: Record<string, string>
  /** Working directory for the child process. */
  readonly cwd?: string
  /** MCP endpoint URL selecting the streamable-HTTP transport. */
  readonly url?: string
  /** Extra headers attached to MCP HTTP requests. */
  readonly headers?: Record<string, string>
  /** Deployment switch; omitted means enabled. */
  readonly enabled?: boolean
}

/** mcp-domain unary methods (the map keys mcp.* of RpcMethodMap). */
export interface McpApi {
  /**
   * List every declared server with its live deployment state, user scope
   * first. Servers declared by a project `.mcp.json` are included with
   * `source: 'project'` and are read-only here — project entries are edited
   * as files.
   */
  list(request: RpcRequest<{}>): Promise<RpcResponse<{ servers: McpServerView[] }>>

  /**
   * Add or replace one server in the user registry. The body follows the
   * Claude Code `mcpServers` convention; `url` selects the streamable-HTTP
   * transport, otherwise `command` starts a stdio child. The Host validates
   * the name and the entry, writes the registry atomically, and deploys the
   * server before answering.
   */
  save(request: RpcRequest<{ name: string; entry: McpServerEntryView }>):
  Promise<RpcResponse<{ server: McpServerView }>>

  /** Remove one server from the user registry and undeploy it. */
  remove(request: RpcRequest<{ name: string }>): Promise<RpcResponse<{}>>
}
