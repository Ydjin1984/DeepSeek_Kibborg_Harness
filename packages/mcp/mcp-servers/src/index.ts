/**
 * MCP server registry: the deployment-level connector that turns user-declared
 * MCP servers into live `@deepseek-ai/dsh-mcp-client` instances.
 *
 * The registry is a Claude-Code-compatible `mcpServers` document in two
 * scopes: the user registry at `$DSH_HOME/mcpServers.json` (managed through
 * the CLI, the browser API, or by hand) and the project registry at
 * `<cwd>/.mcp.json` (read automatically, exactly like Claude Code reads a
 * project's `.mcp.json`). Each declared server is deployed as one
 * `mcp-client` plugin instance whose tools register on the host's global tool
 * layer under `mcp__<serverName>__<tool>`, so every agent session sees them.
 *
 * The service watches both files and reconciles the deployed set on every
 * change: an added or edited server connects without a Host restart (the
 * `mcp-client` supervisor owns reconnection afterwards), a removed or
 * disabled one disposes cleanly. A server entry is trusted executable code
 * outside the agent sandbox — declaring one is an explicit opt-in, and no
 * server is deployed unless a registry declares it.
 * @module @deepseek-ai/dsh-mcp-servers
 */

import { mkdir, readFile, watch } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { apply as mcpClientApply, inject as mcpClientInject, name as mcpClientName } from '@deepseek-ai/dsh-mcp-client'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
// Side-effect type import: declaration-merges `ctx.tools` onto Context.
import type {} from '@deepseek-ai/dsh-tools'
import {
  parseRegistryDocument,
  validateRegistryEntry,
  type DesiredMcpServer,
  type RegistryDocument,
  type RegistryServerEntry,
  type RegistrySource,
} from './registry.ts'

export {
  expandEnvReferences, parseRegistryDocument, parseServerEntry, validateRegistryEntry,
  DEFAULT_TOOL_CALL_TIMEOUT_MS, SERVER_NAME_PATTERN,
} from './registry.ts'
export type {
  DesiredMcpServer, RegistryDocument, RegistryServerEntry, RegistrySource,
} from './registry.ts'

/** Default user-registry file name under the DeepSeek Harness home. */
export const DEFAULT_USER_REGISTRY_FILE = 'mcpServers.json'
/** Default project-registry file name next to the host working directory. */
export const DEFAULT_PROJECT_REGISTRY_FILE = '.mcp.json'

/** Config for the mcp-servers connector. */
export interface Config {
  /**
   * User-registry file; empty uses `$DSH_HOME/mcpServers.json`, an absolute
   * path is honored verbatim, a relative path resolves against the home.
   */
  userFile: string
  /** Whether the project `.mcp.json` next to the host working directory is read. */
  includeProjectFile: boolean
  /**
   * Project-registry file name resolved against the host working directory;
   * empty uses `.mcp.json`.
   */
  projectFile: string
  /** Whether file changes are watched and reconciled automatically. */
  watch: boolean
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    mcpServers: McpServers
  }
}

/** Live deployment state of one registry server, as reported to CLI and UI. */
export type McpServerState = 'disabled' | 'connected' | 'starting' | 'error'

/** User-visible snapshot of one registry server. */
export interface McpServerStatus {
  /** Registry map key. */
  name: string
  /** Which registry declared this server. */
  source: RegistrySource
  /** Resolved transport; undefined only when the entry failed validation. */
  kind?: 'stdio' | 'streamable-http'
  /** Deployment switch from the entry. */
  enabled: boolean
  /** Interpolated executable (stdio servers). */
  command?: string
  /** Interpolated endpoint URL (HTTP servers). */
  url?: string
  /** Connected means at least one `mcp__<name>__*` tool is registered. */
  state: McpServerState
  /** Number of registered `mcp__<name>__*` tools. */
  toolCount: number
  /** Validation or deployment failure text; present in the `error` state. */
  error?: string
  /** Registry file this server was declared in. */
  file: string
}

/** Handle returned by `ctx.plugin`, narrowed to the two operations this service needs. */
interface PluginHandle {
  await(): Promise<unknown>
  dispose(): Promise<void>
}

/** One deployed server: its plugin handle plus the config signature it was mounted with. */
interface MountedServer {
  readonly handle: PluginHandle
  /** JSON of the client config, used to detect an entry edit that must redeploy. */
  readonly signature: string
}

/**
 * The stable identity of a deployment plan: the complete client config.
 * Registry entries are rebuilt deterministically, so equal configs serialize
 * identically.
 * @param server - validated deployment plan.
 * @returns the comparison signature.
 */
function serverSignature(server: DesiredMcpServer): string {
  return JSON.stringify(server.config)
}

/**
 * Deployment-level MCP server registry.
 *
 * The service is one host singleton: its registrations land on the global
 * tool layer, so every agent in every session observes the deployed tools
 * (server-scoped tools register per session through presets instead). The
 * service never blocks Host startup on server connectivity — a server that
 * fails to connect logs through its `mcp-client` supervisor and keeps its
 * slot in `list()` as `starting` until tools appear or the entry is removed.
 */
export class McpServers extends Service {
  static inject = ['tools']

  static Config = z.object({
    userFile: z.string().default(''),
    includeProjectFile: z.boolean().default(true),
    projectFile: z.string().default(''),
    watch: z.boolean().default(true),
  }) as z<Config>

  /**
   * The service's own untraced context. Methods invoked through the traceable
   * service proxy see `this.ctx` rebound to the CALLER's context, which
   * carries a shadow; mounted `mcp-client` subtrees must hang off the
   * untraced original (the `agent-presets` selfCtx precedent).
   */
  private readonly selfCtx: Context

  /** Absolute user-registry path. */
  private readonly userFilePath: string
  /** Absolute project-registry path, or undefined when project scope is off. */
  private readonly projectFilePath: string | undefined

  /** Most recently parsed deployment plans, user scope first per name. */
  private desired = new Map<string, DesiredMcpServer>()
  /** Live `mcp-client` plugin handles by server name. */
  private readonly mounts = new Map<string, MountedServer>()
  /** Last deployment error per server name, cleared on successful mount. */
  private readonly mountErrors = new Map<string, string>()
  /** Serialized reconcile chain; every registry change funnels through it. */
  private reconcileChain: Promise<void> = Promise.resolve()
  /** Debounce timer for filesystem-watcher events. */
  private reconcileTimer: NodeJS.Timeout | undefined
  /** Abort signal shared by the filesystem watchers. */
  private readonly watcherAbort = new AbortController()

  constructor(ctx: Context, public config: Config) {
    super(ctx, 'mcpServers')
    this.selfCtx = ctx
    this.userFilePath = this.resolveUserFile(config.userFile)
    this.projectFilePath = config.includeProjectFile
      ? resolve(process.cwd(), config.projectFile === '' ? DEFAULT_PROJECT_REGISTRY_FILE : config.projectFile)
      : undefined
    ctx.effect(() => {
      void this.start()
      return () => { this.stop() }
    }, 'mcpServers.lifecycle')
  }

  /**
   * Resolve the user-registry file path from config.
   * @param configured - `userFile` config value; empty selects the home default.
   * @returns the absolute user-registry path.
   */
  private resolveUserFile(configured: string): string {
    if (configured === '') return dshHomePath(DEFAULT_USER_REGISTRY_FILE)
    return isAbsolute(configured) ? configured : join(dshHomePath(), configured)
  }

  /**
   * Begin watching and run the initial reconciliation. Fire-and-forget: the
   * Host must not wait on server connectivity to become ready.
   */
  private async start(): Promise<void> {
    // The home directory may not exist yet on a fresh machine; the watcher
    // attaches to the registry's parent directory, and the first save must
    // have somewhere to land.
    await mkdir(dirname(this.userFilePath), { recursive: true })
    if (this.config.watch) {
      void this.watchRegistryFile(this.userFilePath)
      if (this.projectFilePath !== undefined) void this.watchRegistryFile(this.projectFilePath)
    }
    await this.requestReconcile()
  }

  /** Cancel watchers and pending debounce on teardown. */
  private stop(): void {
    this.watcherAbort.abort()
    if (this.reconcileTimer !== undefined) clearTimeout(this.reconcileTimer)
    // Mounted `mcp-client` subtrees are children of this fiber and unwind
    // with it; nothing further is required here.
  }

  /**
   * Watch one registry file's directory for creation, replacement, or
   * deletion and re-run reconciliation. Watching the directory rather than
   * the file also observes the file appearing for the first time.
   * @param file - absolute registry path to watch.
   */
  private async watchRegistryFile(file: string): Promise<void> {
    const dir = dirname(file)
    const base = basename(file)
    try {
      const events = watch(dir, { signal: this.watcherAbort.signal })
      for await (const event of events) {
        if (event.filename === null || event.filename === base) this.scheduleReconcile()
      }
    } catch (error) {
      if (!this.watcherAbort.signal.aborted) {
        this.selfCtx.logger.warn(`mcp-servers: registry watcher for ${file} stopped: ${String(error)}`)
      }
    }
  }

  /** Debounce filesystem events into one reconcile pass. */
  private scheduleReconcile(): void {
    if (this.reconcileTimer !== undefined) return
    this.reconcileTimer = setTimeout(() => {
      this.reconcileTimer = undefined
      void this.requestReconcile()
    }, 100)
  }

  /**
   * Serialize one reconcile pass behind any running one.
   * @returns a promise resolving when the queued pass (and every pass queued
   * behind it) completes.
   */
  requestReconcile(): Promise<void> {
    this.reconcileChain = this.reconcileChain
      .then(() => this.reconcile())
      .catch((error: unknown) => {
        this.selfCtx.logger.error(`mcp-servers: reconcile failed: ${String(error)}`)
      })
    return this.reconcileChain
  }

  /**
   * Re-read both registries and converge the deployed set: dispose servers
   * that disappeared, were disabled, or became invalid; mount servers that
   * are new or were repaired. Never throws — every failure is logged and
   * surfaces in `list()` through the error state.
   */
  private async reconcile(): Promise<void> {
    const next = new Map<string, DesiredMcpServer>()
    await this.collectRegistry('user', this.userFilePath, next)
    if (this.projectFilePath !== undefined) await this.collectRegistry('project', this.projectFilePath, next)
    this.desired = next
    for (const [name, mounted] of [...this.mounts]) {
      const want = next.get(name)
      if (want === undefined || !want.enabled || want.error !== undefined || serverSignature(want) !== mounted.signature) {
        await this.disposeServer(name, mounted.handle)
      }
    }
    for (const [name, want] of next) {
      if (!want.enabled || want.error !== undefined) continue
      if (this.mounts.has(name)) continue
      await this.mountServer(name, want)
    }
  }

  /**
   * Read and parse one registry file into the running plan map. A missing
   * file contributes nothing; an unreadable or malformed one logs a warning
   * and contributes nothing, so one broken file never blanks the other scope.
   * @param source - scope label for diagnostics.
   * @param file - absolute registry path.
   * @param into - running plan map being assembled for this pass.
   */
  private async collectRegistry(source: RegistrySource, file: string, into: Map<string, DesiredMcpServer>): Promise<void> {
    const { document, absent, error } = await readRegistryFile(file)
    if (error !== undefined) {
      this.selfCtx.logger.warn(`mcp-servers: ${source} registry ${file} is not usable: ${error}`)
      return
    }
    if (absent === true) return
    for (const server of parseRegistryDocument(document, source)) {
      const owner = into.get(server.name)
      if (owner !== undefined) {
        if (source === 'project') {
          this.selfCtx.logger.warn(
            `mcp-servers: project server "${server.name}" skipped — the name is already declared in the user registry`,
          )
        }
        continue
      }
      if (server.error !== undefined) {
        this.selfCtx.logger.warn(`mcp-servers: ${source} server "${server.name}" not deployed: ${server.error}`)
      }
      into.set(server.name, server)
    }
  }

  /**
   * Deploy one validated server entry as an `mcp-client` plugin instance.
   * @param name - server name (also the `serverName` namespace).
   * @param want - validated plan carrying the client configuration.
   */
  private async mountServer(name: string, want: DesiredMcpServer): Promise<void> {
    if (want.config === undefined) return // unreachable: error plans are never mounted
    try {
      const handle = this.selfCtx.plugin(
        { name: mcpClientName, inject: mcpClientInject, apply: mcpClientApply },
        want.config,
      ) as PluginHandle
      await handle.await()
      this.mounts.set(name, { handle, signature: serverSignature(want) })
      this.mountErrors.delete(name)
      this.selfCtx.logger.info(
        `mcp-servers: deployed ${want.source} MCP server "${name}" (${want.kind}); tools appear as mcp__${name}__*`,
      )
    } catch (error) {
      this.mountErrors.set(name, error instanceof Error ? error.message : String(error))
      this.selfCtx.logger.error(`mcp-servers: failed to deploy server "${name}": ${this.mountErrors.get(name)}`)
    }
  }

  /**
   * Dispose one mounted server's plugin instance.
   * @param name - server name.
   * @param handle - plugin handle to dispose.
   */
  private async disposeServer(name: string, handle: PluginHandle): Promise<void> {
    this.mounts.delete(name)
    this.mountErrors.delete(name)
    try {
      await handle.dispose()
    } catch (error) {
      this.selfCtx.logger.warn(`mcp-servers: disposal of server "${name}" reported: ${String(error)}`)
    }
  }

  /**
   * Report the current registry and deployment state.
   *
   * The read is live: connection state derives from the tools currently
   * registered under each server's namespace, so an `mcp-client` reconnect
   * that re-registers tools flips a server back to `connected` without this
   * service observing the supervisor directly.
   * @returns one status per declared server, user scope first.
   */
  list(): McpServerStatus[] {
    const toolNames = this.selfCtx.tools.schemas().map(schema => schema.name)
    const statuses: McpServerStatus[] = []
    for (const [name, server] of this.desired) {
      const prefix = `mcp__${name}__`
      const toolCount = toolNames.reduce((count, toolName) => count + (toolName.startsWith(prefix) ? 1 : 0), 0)
      let state: McpServerState
      let error: string | undefined
      if (!server.enabled) {
        state = 'disabled'
      } else if (server.error !== undefined) {
        state = 'error'
        error = server.error
      } else if (this.mounts.has(name)) {
        state = toolCount > 0 ? 'connected' : 'starting'
      } else {
        state = 'error'
        error = this.mountErrors.get(name)
      }
      const status: McpServerStatus = {
        name,
        source: server.source,
        enabled: server.enabled,
        state,
        toolCount,
        file: server.source === 'user' ? this.userFilePath : this.projectFilePath ?? this.userFilePath,
      }
      if (server.kind !== undefined) status.kind = server.kind
      if (server.command !== undefined) status.command = server.command
      if (server.url !== undefined) status.url = server.url
      if (error !== undefined) status.error = error
      statuses.push(status)
    }
    return statuses
  }

  /**
   * Add or replace one server in the user registry and reconcile.
   * @param name - server name; must match the `serverName` namespace contract.
   * @param entry - Claude-Code-compatible server entry.
   * @returns the status after the change is deployed.
   * @throws when the name or entry fails validation or the registry file
   * cannot be updated.
   */
  async saveUserServer(name: string, entry: RegistryServerEntry): Promise<McpServerStatus> {
    const plan = validateRegistryEntry(name, entry)
    if (plan.error !== undefined) throw new Error(`cannot save server "${name}": ${plan.error}`)
    const next = await this.readUserDocumentForWrite()
    next.mcpServers = { ...next.mcpServers, [name]: entry }
    await this.writeUserDocument(next)
    await this.requestReconcile()
    const status = this.list().find(item => item.name === name && item.source === 'user')
    if (status === undefined) throw new Error(`server "${name}" did not appear in the user registry after saving`)
    return status
  }

  /**
   * Remove one server from the user registry and reconcile.
   * @param name - server name to remove.
   * @throws when the registry file cannot be updated.
   */
  async removeUserServer(name: string): Promise<void> {
    const next = await this.readUserDocumentForWrite()
    if (next.mcpServers !== undefined) {
      const { [name]: _removed, ...rest } = next.mcpServers
      next.mcpServers = rest
    }
    await this.writeUserDocument(next)
    await this.requestReconcile()
  }

  /**
   * Read the user registry as a writable document, refusing to silently
   * overwrite a file this service cannot parse.
   * @returns the current document, or an empty one when the file does not exist.
   * @throws when the file exists but is not a valid JSON object.
   */
  private async readUserDocumentForWrite(): Promise<RegistryDocument> {
    const { document, absent, error } = await readRegistryFile(this.userFilePath)
    if (error !== undefined) {
      throw new Error(`cannot update ${this.userFilePath}: ${error}`)
    }
    if (absent === true) return {}
    if (typeof document !== 'object' || Array.isArray(document)) {
      throw new Error(`cannot update ${this.userFilePath}: the file must be a JSON object`)
    }
    const doc = document as RegistryDocument
    if (doc.mcpServers !== undefined && (typeof doc.mcpServers !== 'object' || Array.isArray(doc.mcpServers))) {
      throw new Error(`cannot update ${this.userFilePath}: "mcpServers" must be an object`)
    }
    return doc
  }

  /**
   * Persist a user-registry document atomically.
   * @param document - next document content.
   */
  private async writeUserDocument(document: RegistryDocument): Promise<void> {
    await writeFileAtomic(this.userFilePath, `${JSON.stringify(document, null, 2)}\n`, { mode: 0o600, dirMode: 0o700 })
  }
}

/**
 * Read a registry file without locking.
 * @param file - absolute path.
 * @returns the parsed JSON value, `absent: true` when the file does not
 * exist, and a human-readable `error` when reading or parsing failed.
 */
async function readRegistryFile(
  file: string,
): Promise<{ document: unknown; absent?: boolean; error?: string }> {
  let text: string
  try {
    text = await readFile(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { document: undefined, absent: true }
    return { document: undefined, error: String(error) }
  }
  try {
    return { document: JSON.parse(text) }
  } catch (error) {
    return { document: undefined, error: `not valid JSON: ${error instanceof Error ? error.message : String(error)}` }
  }
}

export default McpServers
