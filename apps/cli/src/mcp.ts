/**
 * `dsh mcp` — manage the MCP server registry files that
 * `@deepseek-ai/dsh-mcp-servers` deploys from: add, remove, enable, disable,
 * and list servers in the user registry (`$DSH_HOME/mcpServers.json`) and the
 * project registry (`<cwd>/.mcp.json`, via `--project`). The command only
 * edits the registry documents; a running Host watches the files and
 * reconciles live, so no restart is needed for the change to take effect.
 * @module @deepseek-ai/dsh/mcp
 */

import { Command, CommanderError } from 'commander'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import {
  parseServerEntry, validateRegistryEntry, type RegistryDocument, type RegistryServerEntry,
} from '@deepseek-ai/dsh-mcp-servers'

/** Default user-registry file name under the harness home (mirrors the server package). */
const USER_REGISTRY_FILE = 'mcpServers.json'
/** Default project-registry file name next to the working directory. */
const PROJECT_REGISTRY_FILE = '.mcp.json'

/** I/O seam so the runner is testable without touching process globals. */
export interface McpIo {
  /** Working directory anchoring the project registry. */
  readonly cwd: string
  /** Harness home anchoring the user registry; default resolves `$DSH_HOME`. */
  readonly dshHome?: string
  /** stdout sink; defaults to `process.stdout.write`. */
  readonly stdout?: (line: string) => void
  /** stderr sink; defaults to `process.stderr.write`. */
  readonly stderr?: (line: string) => void
}

/**
 * Resolve the user-registry absolute path.
 * @param io - invocation I/O carrying the optional home override.
 * @returns the user-registry path.
 */
function userRegistryPath(io: McpIo): string {
  const home = io.dshHome ?? resolveDshHome()
  return join(home, USER_REGISTRY_FILE)
}

/**
 * Resolve the project-registry absolute path.
 * @param io - invocation I/O carrying the working directory.
 * @returns the project-registry path.
 */
function projectRegistryPath(io: McpIo): string {
  return resolve(io.cwd, PROJECT_REGISTRY_FILE)
}

/**
 * Parse a key=value pair list into a string record, failing loud on a pair
 * without an `=`.
 * @param pairs - raw `K=V` tokens.
 * @param kind - option name for diagnostics.
 * @param error - commander error sink.
 * @returns the parsed record.
 */
function parsePairs(pairs: string[] | undefined, kind: string, error: (message: string) => never): Record<string, string> {
  const out: Record<string, string> = {}
  for (const pair of pairs ?? []) {
    const index = pair.indexOf('=')
    if (index <= 0) error(`error: --${kind} expects KEY=VALUE, got ${JSON.stringify(pair)}`)
    out[pair.slice(0, index)] = pair.slice(index + 1)
  }
  return out
}

/**
 * Read a registry document, treating a missing file as an empty document.
 * @param file - absolute registry path.
 * @param error - commander error sink.
 * @returns the parsed document (or a fresh one) to mutate.
 */
async function readRegistry(file: string, error: (message: string) => never): Promise<RegistryDocument> {
  let text: string
  try {
    text = await readFile(file, 'utf8')
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return {}
    error(`error: cannot read ${file}: ${String(cause)}`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (cause) {
    error(`error: ${file} is not valid JSON (${cause instanceof Error ? cause.message : String(cause)}); fix or remove it first`)
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    error(`error: ${file} must contain a JSON object`)
  }
  const document = parsed as RegistryDocument
  if (document.mcpServers !== undefined
    && (typeof document.mcpServers !== 'object' || Array.isArray(document.mcpServers))) {
    error(`error: ${file}: "mcpServers" must be an object`)
  }
  return document
}

/**
 * Persist a registry document atomically.
 * @param file - absolute registry path.
 * @param document - next content.
 */
async function writeRegistry(file: string, document: RegistryDocument): Promise<void> {
  await writeFileAtomic(file, `${JSON.stringify(document, null, 2)}\n`, { mode: 0o600, dirMode: 0o700 })
}

/**
 * Render one line of `dsh mcp list` output for a declared server.
 * @param name - registry key.
 * @param entry - raw entry value.
 * @param scope - which registry declared the server.
 * @returns the rendered line.
 */
function renderListRow(name: string, entry: unknown, scope: 'user' | 'project'): string {
  const plan = parseServerEntry(name, entry, scope)
  const target = plan.kind === 'stdio' ? `${plan.command ?? ''} ${plan.config && 'args' in plan.config
    ? (plan.config as { args: string[] }).args.join(' ')
    : ''}`.trim() : plan.url ?? ''
  const enabled = plan.enabled ? 'yes' : 'no'
  if (plan.error !== undefined) return `${name}\t${scope}\tinvalid\tenabled=${enabled}\t(${plan.error})`
  return `${name}\t${scope}\t${plan.kind}\t${enabled}\t${target}`
}

/** Repeatable single-value collector for repeated option flags. */
const collect = (value: string, previous: string[] = []): string[] => [...previous, value]

/**
 * Implement the `dsh mcp` command family.
 * @param argv - tokens after `mcp`, verbatim.
 * @param io - invocation I/O.
 * @returns the process exit code.
 */
export async function runMcp(argv: readonly string[], io: McpIo = { cwd: process.cwd() }): Promise<number> {
  const stdout = io.stdout ?? ((line: string) => process.stdout.write(line))
  const stderr = io.stderr ?? ((line: string) => process.stderr.write(line))
  const fail = (message: string): never => {
    throw new CommanderError(1, 'commander.mcp', message)
  }
  const selectFile = (project: boolean): string => project ? projectRegistryPath(io) : userRegistryPath(io)

  const program = new Command('mcp')
    .description('manage MCP servers in the registry the running Host deploys from')
    .exitOverride()
    .showHelpAfterError()

  program.configureHelp({ showGlobalOptions: false })

  program.command('add <name>')
    .description('add or replace a server in the registry (stdio via --command, or streamable HTTP via --url)')
    .option('--command <cmd>', 'executable that starts the stdio server')
    .option('--arg <value>', 'argument passed to the command (repeatable)', collect)
    .option('--env <key=value>', 'environment variable for the child (repeatable)', collect)
    .option('--cwd <dir>', 'working directory for the child process')
    .option('--url <url>', 'MCP endpoint URL selecting the streamable-HTTP transport')
    .option('--header <key=value>', 'HTTP header for the endpoint (repeatable)', collect)
    .option('--project', 'edit the project .mcp.json instead of the user registry')
    .option('--disable', 'add the server disabled (enabled: false)')
    .action(async (name: string, options: Record<string, unknown>) => {
      if (typeof options.command !== 'string' && typeof options.url !== 'string') {
        fail('error: add requires --command <cmd> (stdio) or --url <url> (streamable HTTP)')
      }
      if (typeof options.command === 'string' && typeof options.url === 'string') {
        fail('error: add accepts either --command or --url, not both')
      }
      const entry: RegistryServerEntry = {}
      if (typeof options.command === 'string') entry.command = options.command
      if (typeof options.url === 'string') entry.url = options.url
      const args = options.arg as string[] | undefined
      if (args !== undefined && args.length > 0) entry.args = args
      const env = parsePairs(options.env as string[] | undefined, 'env', fail)
      if (Object.keys(env).length > 0) entry.env = env
      if (typeof options.cwd === 'string') entry.cwd = options.cwd
      const headers = parsePairs(options.header as string[] | undefined, 'header', fail)
      if (Object.keys(headers).length > 0) entry.headers = headers
      if (options.disable === true) entry.enabled = false
      const plan = validateRegistryEntry(name, entry)
      if (plan.error !== undefined) fail(`error: cannot add server "${name}": ${plan.error}`)
      const file = selectFile(options.project === true)
      const document = await readRegistry(file, fail)
      document.mcpServers = { ...(document.mcpServers ?? {}), [name]: entry }
      await writeRegistry(file, document)
      stdout(`added server "${name}" to ${file} (${plan.kind}); it deploys on the next Host reconcile\n`)
    })

  program.command('remove <name>')
    .description('remove a server from the registry')
    .option('--project', 'edit the project .mcp.json instead of the user registry')
    .action(async (name: string, options: { project?: boolean }) => {
      const file = selectFile(options.project === true)
      const document = await readRegistry(file, fail)
      if (document.mcpServers === undefined || document.mcpServers[name] === undefined) {
        fail(`error: server "${name}" is not declared in ${file}`)
        return
      }
      const { [name]: _removed, ...rest } = document.mcpServers
      document.mcpServers = rest
      await writeRegistry(file, document)
      stdout(`removed server "${name}" from ${file}\n`)
    })

  for (const verb of ['enable', 'disable'] as const) {
    program.command(`${verb} <name>`)
      .description(verb === 'enable' ? 'enable a server (removes enabled: false)' : 'disable a server (sets enabled: false)')
      .option('--project', 'edit the project .mcp.json instead of the user registry')
      .action(async (name: string, options: { project?: boolean }) => {
        const file = selectFile(options.project === true)
        const document = await readRegistry(file, fail)
        const entry = document.mcpServers?.[name]
        if (entry === undefined) {
          fail(`error: server "${name}" is not declared in ${file}`)
          return
        }
        if (verb === 'enable') {
          delete entry.enabled
        } else {
          entry.enabled = false
        }
        await writeRegistry(file, document)
        stdout(`${verb}d server "${name}" in ${file}\n`)
      })
  }

  program.command('list')
    .description('list servers in the user registry and (by default) the project registry')
    .option('--project', 'list only the project registry')
    .option('--user', 'list only the user registry')
    .option('--json', 'emit the listing as JSON instead of aligned rows')
    .action(async (options: { project?: boolean; user?: boolean; json?: boolean }) => {
      const scopes: Array<'user' | 'project'> = options.project === true
        ? ['project']
        : options.user === true
          ? ['user']
          : ['user', 'project']
      const rows: string[] = []
      const records: Array<Record<string, unknown>> = []
      for (const scope of scopes) {
        const file = scope === 'user' ? userRegistryPath(io) : projectRegistryPath(io)
        const document = await readRegistry(file, fail)
        for (const [name, entry] of Object.entries(document.mcpServers ?? {})) {
          const plan = parseServerEntry(name, entry, scope)
          records.push({
            name, scope, kind: plan.kind ?? null, enabled: plan.enabled,
            command: plan.command ?? null, url: plan.url ?? null, error: plan.error ?? null,
          })
          rows.push(renderListRow(name, entry, scope))
        }
      }
      rows.sort()
      if (options.json === true) {
        records.sort((left, right) => String(left.name).localeCompare(String(right.name)))
        stdout(`${JSON.stringify(records, null, 2)}\n`)
      } else {
        stdout(rows.length === 0 ? '(no MCP servers declared)\n' : `${rows.join('\n')}\n`)
      }
    })

  try {
    await program.parseAsync(argv, { from: 'user' })
    return 0
  } catch (error) {
    if (error instanceof CommanderError) {
      if (error.code === 'commander.helpDisplayed' || error.code === 'commander.version') return 0
      stderr(`${error.message}\n`)
      return error.exitCode === 0 ? 0 : 1
    }
    stderr(`error: ${String(error)}\n`)
    return 1
  }
}
