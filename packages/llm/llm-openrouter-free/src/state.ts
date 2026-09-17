/**
 * Durable ledger for the free-model pool.
 *
 * The counters have to survive a restart: OpenRouter's daily allowance is
 * per-account, so a harness that forgot what it already spent would walk
 * straight back into `429`s after every restart and report a pool it cannot
 * actually use. The file is rewritten atomically (temp file plus rename) so a
 * crash mid-write cannot leave a truncated ledger that reads as an empty,
 * fully-spent quota.
 *
 * @module @deepseek-ai/dsh-llm-openrouter-free/state
 */

import { readFile } from 'node:fs/promises'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import type { ModelUsage } from './limits.ts'

/** On-disk format version; a mismatch discards the ledger rather than guessing. */
const LEDGER_VERSION = 1

/** Absolute path of the pool ledger under the harness home. */
export function ledgerPath(): string {
  return dshHomePath('storages', 'openrouter-free', 'ledger.json')
}

/** Whether one unknown value is a record. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Read one finite non-negative number, or a fallback. */
function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback
}

/**
 * Read one ledger entry, discarding anything the current format cannot describe.
 * @param value - raw entry from the file.
 * @returns the entry, or `undefined` when it is unusable.
 */
function readUsage(value: unknown): ModelUsage | undefined {
  if (!isRecord(value)) return undefined
  const day = value['day']
  const minute = value['minute']
  if (typeof day !== 'string' || typeof minute !== 'string' || day === '' || minute === '') return undefined
  const lastError = value['lastError']
  return {
    day,
    minute,
    requestsToday: numberOr(value['requestsToday'], 0),
    requestsMinute: numberOr(value['requestsMinute'], 0),
    tokensToday: numberOr(value['tokensToday'], 0),
    cooldownUntil: numberOr(value['cooldownUntil'], 0),
    failures: numberOr(value['failures'], 0),
    ...typeof lastError === 'string' && lastError !== '' ? { lastError } : {},
  }
}

/**
 * Load the persisted ledger.
 *
 * An absent file is an empty ledger; an unreadable or malformed one is also
 * empty, because the only cost of forgetting is re-learning the ceiling from a
 * `429`, while a crash loop on a broken file would take the pool down with it.
 * @param path - ledger path; defaults to {@link ledgerPath}.
 * @returns usage by model id, possibly empty.
 */
export async function loadLedger(path: string = ledgerPath()): Promise<Record<string, ModelUsage>> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error: unknown) {
    // Absent or unreadable ledger: start empty and re-learn ceilings from 429s.
    if ((error as NodeJS.ErrnoException | null)?.code === 'ENOENT') return {}
    return {}
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    // Malformed JSON cannot be repaired; a fresh ledger is safer than crashing the pool.
    return {}
  }
  if (!isRecord(parsed) || parsed['version'] !== LEDGER_VERSION) return {}
  const models = parsed['models']
  if (!isRecord(models)) return {}
  const ledger: Record<string, ModelUsage> = {}
  for (const [id, raw] of Object.entries(models)) {
    const usage = readUsage(raw)
    if (usage !== undefined) ledger[id] = usage
  }
  return ledger
}

/**
 * Persist the ledger atomically, creating its directory on first write.
 * @param models - usage by model id.
 * @param path - ledger path; defaults to {@link ledgerPath}.
 */
export async function saveLedger(
  models: Readonly<Record<string, ModelUsage>>,
  path: string = ledgerPath(),
): Promise<void> {
  const payload = `${JSON.stringify({ version: LEDGER_VERSION, models }, null, 2)}\n`
  await writeFileAtomic(path, payload, { mode: 0o600, dirMode: 0o700 })
}
