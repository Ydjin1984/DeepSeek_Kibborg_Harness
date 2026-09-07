/**
 * Bridge plugin that appends `execution/event` and `executions/resource`
 * payloads to a durable JSONL journal. The execution service stays
 * in-memory; this plugin is the persistence side-effect in composition.
 * @module @deepseek-ai/dsh-execution-persistence
 */

import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import type { ExecutionEvent } from '@deepseek-ai/dsh-execution/types'
import type { ResourceEvent } from '@deepseek-ai/dsh-execution/src/resources.ts'
import '@deepseek-ai/dsh-execution'
import { mkdir, open } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

/** Discriminator written on every journal line. */
export type JournalKind = 'execution' | 'resource'

/**
 * One JSONL journal line: the Cordis event plus a persist-time timestamp.
 *
 * `kind` is `"execution"` for `execution/event` and `"resource"` for
 * `executions/resource`. `event` is the inner payload (`payload.event`).
 * `ts` is epoch milliseconds when this plugin queued the line.
 */
export interface JournalRecord {
  kind: JournalKind
  ts: number
  event: ExecutionEvent | ResourceEvent
}

/**
 * Plugin configuration. `enabled` defaults to true. When `root` is omitted
 * or blank, the journal directory is `$DSH_HOME/executions` (then `~/.dsh/executions`).
 */
export interface Config {
  /** When false, the plugin registers no listeners (default `true`). */
  enabled?: boolean
  /** Directory that holds {@link JOURNAL_FILENAME}; resolved against the process cwd when relative. */
  root?: string
}

/** Schemastery schema for {@link Config}. */
export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),
  root: z.string(),
})

/** Basename of the JSONL journal under the resolved root directory. */
export const JOURNAL_FILENAME = 'events.jsonl'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'execution-persistence'

/** No injected services — listeners attach through `ctx.on`. */
export const inject: string[] = []

/**
 * Resolve the directory that holds the execution journal.
 *
 * Precedence: a non-empty `root` argument, otherwise `dshHomePath('executions')`
 * (`$DSH_HOME/executions`, else `~/.dsh/executions`).
 * @param root - optional configured directory; whitespace is treated as unset.
 * @returns the absolute journal directory.
 */
export function resolveJournalDir(root?: string): string {
  const trimmed = root?.trim()
  if (trimmed) return resolve(trimmed)
  return dshHomePath('executions')
}

/**
 * Render a thrown value for the warn log line.
 * @param error - the rejection reason from a journal write.
 * @returns a one-line diagnostic string.
 */
function formatThrown(error: unknown): string {
  return String(error)
}

/**
 * Append one JSON line and fsync. The file is opened, written, synced, and
 * closed per record so a crash cannot leave an unsynced handle.
 * @param filePath - absolute path of the journal file.
 * @param record - the envelope to serialize as one line.
 */
async function appendJournalLine(filePath: string, record: JournalRecord): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
  const handle = await open(filePath, 'a')
  try {
    await handle.writeFile(`${JSON.stringify(record)}\n`)
    await handle.sync()
  } finally {
    await handle.close()
  }
}

/**
 * Subscribe to execution and resource events and append each one to the journal.
 * Write failures are logged with `ctx.logger.warn` and do not reject the emitter.
 * Plugin dispose waits for in-flight writes, then drops further events.
 * @param ctx - Cordis context for listeners, logging, and effect teardown.
 * @param config - validated {@link Config}.
 */
export function apply(ctx: Context, config: Config): void {
  if (config.enabled === false) return

  const filePath = join(resolveJournalDir(config.root), JOURNAL_FILENAME)
  let writes: Promise<void> = Promise.resolve()

  const persist = (kind: JournalKind, event: ExecutionEvent | ResourceEvent): void => {
    const record: JournalRecord = { kind, ts: Date.now(), event }
    writes = writes.then(() =>
      appendJournalLine(filePath, record).catch((error: unknown) => {
        ctx.logger.warn(
          `execution-persistence: failed to append ${kind} journal record: ${formatThrown(error)}`,
        )
      }),
    )
  }

  const stopExecution = ctx.on('execution/event', (payload) => {
    persist('execution', payload.event)
  })
  const stopResource = ctx.on('executions/resource', (payload) => {
    persist('resource', payload.event)
  })

  ctx.effect(() => async () => {
    stopExecution()
    stopResource()
    await writes
  }, 'execution-persistence.quiesce')
}
