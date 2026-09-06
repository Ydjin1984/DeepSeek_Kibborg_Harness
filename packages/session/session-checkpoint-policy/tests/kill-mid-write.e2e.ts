import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import SessionStore, {
  SessionId, type SessionEvent,
} from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'

/**
 * Parent-side e2e for the kill-mid-write boundary (Q3 consensus: session
 * durability first). A child process writes session events and is SIGKILLed at
 * a published failpoint; the parent then loads the log and verifies recovery:
 * - `queued`: events still in the write-behind queue when the process dies are
 *   lost by design (≤ batch delay), but the log must stay loadable and
 *   appendable — never corrupt.
 * - `flushed`: checkpoint-policy events already on disk survive and the
 *   interrupted turn is closed with a synthetic `turn/end {interrupted}`.
 *
 * Skipped on win32 like crash-recovery.e2e.ts: SIGKILL/child semantics are
 * exercised on POSIX CI.
 */
const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url))
const childScript = fileURLToPath(new URL('./fixtures/mid-write-child.ts', import.meta.url))
const tsxLoader = fileURLToPath(import.meta.resolve('tsx'))
const roots: string[] = []
const CHILD_FAILPOINT_TIMEOUT_MS = 30_000
const SESSION_ID = SessionId('mid-write-session')

async function waitForMarker(path: string, expected: string): Promise<string> {
  const content = await vi.waitFor(async () => {
    const current = await readFile(path, 'utf8').catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      throw new Error(`mid-write child did not publish failpoint ${JSON.stringify(expected)} at ${path}`, { cause: error })
    })
    if (current === expected || !expected.startsWith(current)) return current
    throw new Error(`mid-write child has not finished publishing failpoint ${JSON.stringify(expected)}`)
  }, { interval: 10, timeout: CHILD_FAILPOINT_TIMEOUT_MS })
  if (content !== expected) {
    throw new Error(`mid-write child wrote unexpected failpoint ${JSON.stringify(content)}`)
  }
  return content
}

async function killMidWrite(mode: 'queued' | 'flushed'): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), `dsh-midwrite-${mode}-`))
  roots.push(root)
  const marker = join(root, 'failpoint')
  await writeFile(marker, '')
  const expectedMarker = mode === 'queued' ? 'queued-appended' : 'flushed-request-dispatched'
  const child = execa(process.execPath, ['--import', tsxLoader, childScript, mode, root, marker], {
    cwd: repoRoot,
    env: { TSX_TSCONFIG_PATH: join(repoRoot, 'tsconfig.json') },
    stdin: 'ignore',
    stdout: 'ignore',
    reject: false,
  })
  try {
    await waitForMarker(marker, expectedMarker)
    child.kill('SIGKILL')
    const exit = await child
    expect(exit.exitCode).toBeNull()
    return root
  } catch (error: unknown) {
    child.kill('SIGKILL')
    await child.catch(() => {})
    throw error
  }
}

async function load(root: string): Promise<SessionEvent[]> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(JsonlSessionPersistence, { root, compression: 'none' })
  try {
    return [...(await ctx.sessionPersistence.load(SESSION_ID)).events]
  } finally {
    await ctx.fiber.dispose()
  }
}

/** Continue a surviving log with the next valid turn/start (exact next seq). */
async function appendNextTurnStart(root: string, events: readonly SessionEvent[]): Promise<void> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(JsonlSessionPersistence, { root, compression: 'none' })
  try {
    const tail = events.at(-1)
    const nextSeq = tail === undefined ? 0 : tail.seq + 1
    const lastTurn = events
      .filter(event => event.type === 'turn/start')
      .map(event => (event.data as { turn: number }).turn)
      .sort((a, b) => b - a)[0] ?? 0
    await ctx.sessionPersistence.append(SESSION_ID, [{
      type: 'turn/start',
      seq: nextSeq,
      time: Date.now(),
      data: { turn: lastTurn + 1 },
    }])
  } finally {
    await ctx.fiber.dispose()
  }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe.skipIf(process.platform === 'win32')('kill mid-write session recovery', () => {
  it('drops never-flushed queued events but keeps the log loadable and appendable', async () => {
    const root = await killMidWrite('queued')
    // Load must not throw on a log whose final batch never reached disk.
    const events = await load(root)
    expect(Array.isArray(events)).toBe(true)
    // The surviving log must accept the next contiguous event: a kill in the
    // write-behind window is data loss, never log corruption.
    await expect(appendNextTurnStart(root, events)).resolves.toBeUndefined()
    // And the extended log still loads.
    const reloaded = await load(root)
    expect(reloaded.length).toBeGreaterThanOrEqual(events.length + 1)
  })

  it('preserves checkpointed events and closes the interrupted turn', async () => {
    const root = await killMidWrite('flushed')
    const events = await load(root)
    const types = events.map(event => event.type)
    // CheckpointPolicy flushes before model dispatch, so request/header must
    // have reached disk before the SIGKILL.
    expect(types).toContain('request/header')
    // The interrupted turn is closed by the synthetic recovery closer.
    const turnEnds = events.filter(event => event.type === 'turn/end')
    const lastTurnEnd = turnEnds[turnEnds.length - 1]
    expect(lastTurnEnd).toBeDefined()
    expect(lastTurnEnd?.data).toMatchObject({ reason: { kind: 'interrupted' } })
  })
})
