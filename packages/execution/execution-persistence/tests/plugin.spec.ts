/**
 * Composition tests for `@deepseek-ai/dsh-execution-persistence`: journal
 * lines for both event kinds, disabled/dispose silence, write-error warnings,
 * and serialized concurrent emits.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import ExecutionService from '@deepseek-ai/dsh-execution'
import type { ExecutionEvent } from '@deepseek-ai/dsh-execution/types'
import type { ResourceEvent } from '@deepseek-ai/dsh-execution/src/resources.ts'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as Persistence from '../src/index.ts'
import type { Config, JournalRecord } from '../src/index.ts'
import { JOURNAL_FILENAME, resolveJournalDir } from '../src/index.ts'

/** Type of the fiber returned by `ctx.plugin`. */
type PluginFiber = Awaited<ReturnType<Context['plugin']>>

/** Create an isolated journal root under the OS temp directory. */
async function tempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'dsh-execution-persistence-'))
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

/** Absolute path of the journal file under `root`. */
function journalFile(root: string): string {
  return join(root, JOURNAL_FILENAME)
}

/**
 * Read the journal as parsed records. A missing file is an empty list.
 * @param root - journal directory.
 * @returns parsed JSONL records in file order.
 */
async function readRecords(root: string): Promise<JournalRecord[]> {
  const path = journalFile(root)
  if (!existsSync(path)) return []
  const text = await readFile(path, 'utf8')
  return text.split('\n').filter(line => line.length > 0).map(line => JSON.parse(line) as JournalRecord)
}

/** Minimal `execution.created` event for direct `ctx.emit`. */
function executionEvent(executionId: string, seq: number, time: number): ExecutionEvent {
  return {
    seq,
    executionId,
    type: 'execution.created',
    to: 'CREATED',
    state: {
      executionId,
      kind: 'job',
      status: 'CREATED',
      attempt: 1,
      updatedAt: time,
    },
    time,
  }
}

/** Minimal `resource.acquired` event for direct `ctx.emit`. */
function resourceEvent(resourceId: string, seq: number, time: number): ResourceEvent {
  return {
    seq,
    type: 'resource.acquired',
    resourceId,
    lease: {
      resourceId,
      type: 'chrome',
      lifecycle: 'leased',
      ttlMs: 30_000,
      acquiredAt: time,
      heartbeatAt: time,
      expiresAt: time + 30_000,
      updatedAt: time,
    },
    time,
  }
}

/**
 * Mount the persistence plugin on a fresh context.
 * @param config - plugin config.
 * @returns the context and plugin fiber.
 */
async function mount(config: Config): Promise<[Context, PluginFiber]> {
  const ctx = new Context()
  const fiber = await ctx.plugin(Persistence, config)
  return [ctx, fiber]
}

describe('resolveJournalDir', () => {
  it('resolves an explicit root against the process cwd', async () => {
    const root = await tempRoot()
    expect(resolveJournalDir(root)).toBe(root)
  })

  it('treats whitespace-only root as unset and uses DSH_HOME/executions', async () => {
    const home = await tempRoot()
    vi.stubEnv('DSH_HOME', home)
    expect(resolveJournalDir('   ')).toBe(join(home, 'executions'))
    expect(resolveJournalDir()).toBe(join(home, 'executions'))
  })
})

describe('plugin: enabled journal', () => {
  it('appends execution/event and executions/resource as JSONL records with kind', async () => {
    const root = await tempRoot()
    const [ctx, fiber] = await mount({ root })
    const now = 1_700_000_000_000
    ctx.emit('execution/event', { event: executionEvent('job:1', 1, now) })
    ctx.emit('executions/resource', { event: resourceEvent('chrome:1', 1, now) })
    await fiber.dispose()

    const records = await readRecords(root)
    expect(records).toHaveLength(2)
    expect(records[0]!.kind).toBe('execution')
    expect(records[0]!.event).toEqual(executionEvent('job:1', 1, now))
    expect(typeof records[0]!.ts).toBe('number')
    expect(records[1]!.kind).toBe('resource')
    expect(records[1]!.event).toEqual(resourceEvent('chrome:1', 1, now))
  })

  it('writes through the live ExecutionService emit path', async () => {
    const root = await tempRoot()
    const ctx = new Context()
    await ctx.plugin(ExecutionService)
    const fiber = await ctx.plugin(Persistence, { root })
    ctx.executions.register('job', 'live:1')
    ctx.executions.resources.acquire({ resourceId: 'pty:1', type: 'pty' })
    await fiber.dispose()

    const records = await readRecords(root)
    expect(records.map(record => record.kind)).toEqual(['execution', 'resource'])
    expect(records[0]!.event).toMatchObject({ executionId: 'live:1', type: 'execution.created' })
    expect(records[1]!.event).toMatchObject({ resourceId: 'pty:1', type: 'resource.acquired' })
  })

  it('serializes concurrent emits into two complete JSON lines', async () => {
    const root = await tempRoot()
    const [ctx, fiber] = await mount({ root })
    const now = 1_700_000_000_001
    ctx.emit('execution/event', { event: executionEvent('job:a', 1, now) })
    ctx.emit('execution/event', { event: executionEvent('job:b', 2, now) })
    await fiber.dispose()

    const text = await readFile(journalFile(root), 'utf8')
    const lines = text.split('\n').filter(line => line.length > 0)
    expect(lines).toHaveLength(2)
    expect(text.endsWith('\n')).toBe(true)
    const parsed = lines.map(line => JSON.parse(line) as JournalRecord)
    expect(parsed[0]!.event).toMatchObject({ executionId: 'job:a' })
    expect(parsed[1]!.event).toMatchObject({ executionId: 'job:b' })
  })

  it('creates $DSH_HOME/executions/events.jsonl when root is omitted', async () => {
    const home = await tempRoot()
    vi.stubEnv('DSH_HOME', home)
    const [ctx, fiber] = await mount({})
    ctx.emit('execution/event', { event: executionEvent('job:home', 1, 10) })
    await fiber.dispose()

    const records = await readRecords(join(home, 'executions'))
    expect(records).toHaveLength(1)
    expect(records[0]!.kind).toBe('execution')
  })
})

describe('plugin: disabled and dispose', () => {
  it('writes nothing when enabled is false', async () => {
    const root = await tempRoot()
    const [ctx, fiber] = await mount({ enabled: false, root })
    ctx.emit('execution/event', { event: executionEvent('job:off', 1, 10) })
    ctx.emit('executions/resource', { event: resourceEvent('chrome:off', 1, 10) })
    await fiber.dispose()
    expect(existsSync(journalFile(root))).toBe(false)
  })

  it('stops writing after the plugin fiber is disposed', async () => {
    const root = await tempRoot()
    const [ctx, fiber] = await mount({ root })
    ctx.emit('execution/event', { event: executionEvent('job:1', 1, 10) })
    await fiber.dispose()
    ctx.emit('execution/event', { event: executionEvent('job:2', 2, 20) })
    expect(await readRecords(root)).toHaveLength(1)
  })
})

describe('plugin: write failures', () => {
  it('warns and does not throw when the journal directory cannot be created', async () => {
    const root = await tempRoot()
    const blocker = join(root, 'not-a-dir')
    await writeFile(blocker, 'file')
    const [ctx, fiber] = await mount({ root: join(blocker, 'journal') })
    const warnings: string[] = []
    ctx.logger.warn = ((message: unknown) => {
      warnings.push(String(message))
    }) as typeof ctx.logger.warn

    ctx.emit('execution/event', { event: executionEvent('job:fail', 1, 10) })
    await fiber.dispose()

    expect(warnings.some(line => line.includes('execution-persistence') && line.includes('failed to append'))).toBe(true)
  })
})

describe('plugin exports', () => {
  it('exports the plugin name, empty inject list, and journal filename', () => {
    expect(Persistence.name).toBe('execution-persistence')
    expect(Persistence.inject).toEqual([])
    expect(JOURNAL_FILENAME).toBe('events.jsonl')
  })
})
