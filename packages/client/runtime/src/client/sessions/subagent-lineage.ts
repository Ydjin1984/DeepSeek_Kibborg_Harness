/**
 * Pure subagent-lineage aggregation over the retained session-list mirror.
 * Ordinary forks terminate propagation so each visible session owns only its
 * uninterrupted subagent subtree.
 * @module @deepseek-ai/dsh-client-runtime/client/sessions/subagent-lineage
 */
import type { SessionId } from '@deepseek-ai/dsh-api-remotes/client'
import type { SubagentCatalogSnapshot } from '../contract/session-list.ts'
import type { SessionSummary } from './service.ts'

/** Descendant counts projected for one possible parent session. */
export interface SubagentDescendantSummary {
  /** All descendants connected through uninterrupted subagent-origin lineage. */
  readonly count: number
  /** Descendants whose exact session summary is currently running. */
  readonly runningCount: number
}

/**
 * Index every subagent descendant under each ancestor it reaches through an
 * uninterrupted subagent-origin chain. Cycles fail soft and orphan owners
 * remain harmless map keys until their summaries arrive.
 * @param summaries - retained session summaries keyed by id.
 * @returns descendant totals and running totals keyed by possible parent id.
 */
export function indexSubagentDescendants(
  summaries: Readonly<Record<SessionId, SessionSummary>>,
): ReadonlyMap<SessionId, SubagentDescendantSummary> {
  const indexed = new Map<SessionId, { count: number; runningCount: number }>()
  for (const descendant of Object.values(summaries)) {
    if (descendant.origin !== 'subagent') continue
    const seen = new Set<SessionId>()
    let current: SessionSummary | undefined = descendant
    while (current?.origin === 'subagent' && current.parentId !== undefined
      && !seen.has(current.id)) {
      seen.add(current.id)
      const aggregate = indexed.get(current.parentId)
      if (aggregate === undefined) {
        indexed.set(current.parentId, {
          count: 1,
          runningCount: descendant.running ? 1 : 0,
        })
      } else {
        aggregate.count += 1
        if (descendant.running) aggregate.runningCount += 1
      }
      current = summaries[current.parentId]
    }
  }
  return indexed
}

/** One live direct-child row surfaced beside the parent's delegation call. */
export interface RunningSubagentActivityRow {
  /** The running child session. */
  readonly sessionId: SessionId
  /** Durable child label: catalog label, own descriptor label, then the id. */
  readonly label: string
  /** Last folded activity: a tool call name or a bounded reply snippet. */
  readonly detail: string
}

/**
 * Structural read of the subagent projection values retained on the client
 * for a running child. Their keys are declared by the owning subagent package
 * through `SessionProjectionMap` merging, which is not a dependency of this
 * layer; the values themselves are plain JSON either way.
 */
interface ChildProjectionValues {
  readonly subagent?: { readonly label?: string } | null
  readonly subagentActivity?: { readonly detail?: string }
}

/**
 * Project the currently running direct subagent children of one parent into
 * strip rows. Activity detail rides the child's projection mirror the client
 * retains while the child runs; a mirror that has not landed yet degrades to
 * the label alone.
 * @param parentSessionId - the owning session whose delegation calls surface rows.
 * @param summaries - retained session summaries keyed by id.
 * @param catalogs - loaded child catalogs keyed by parent id, when present.
 * @returns running children in retained order, oldest first.
 */
export function runningSubagentActivityRows(
  parentSessionId: SessionId,
  summaries: Readonly<Record<SessionId, SessionSummary>>,
  catalogs?: Readonly<Record<SessionId, SubagentCatalogSnapshot>>,
): readonly RunningSubagentActivityRow[] {
  const rows: RunningSubagentActivityRow[] = []
  const entries = catalogs?.[parentSessionId]?.entries
  for (const summary of Object.values(summaries)) {
    if (summary.origin !== 'subagent' || summary.parentId !== parentSessionId || !summary.running) continue
    const entry = entries?.find(candidate => candidate.kind === 'child' && candidate.id === summary.id)
    const catalogLabel = entry?.kind === 'child' ? entry.label : undefined
    const values = summary.projectionValues as unknown as ChildProjectionValues | undefined
    const identityLabel = values?.subagent?.label
    rows.push({
      sessionId: summary.id,
      label: catalogLabel ?? identityLabel ?? summary.id,
      detail: values?.subagentActivity?.detail ?? '',
    })
  }
  return rows
}
