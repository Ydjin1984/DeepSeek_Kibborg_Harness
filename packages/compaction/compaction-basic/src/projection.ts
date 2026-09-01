/**
 * `compaction` session projection unit: the browser-safe compaction policy and
 * lock status folded from the durable log. The threshold ratio is resolved the
 * same way the backend resolves it at request time (`resolveTargetPolicy`), so
 * the UI's "auto-compacts at ~N%" line can never drift from the real trigger.
 *
 * @module @deepseek-ai/dsh-compaction-basic/projection
 */

import { z } from 'zod'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { CompactionProjection } from '@deepseek-ai/dsh-compaction/projection'
import { resolveTargetPolicy } from './config.ts'
import type { ResolvedConfig } from './types.ts'

/** Fold state: the live lock bracket plus the latest routed threshold ratio. */
interface CompactionProjectionState {
  active: boolean
  thresholdRatio?: number
}

const compactionSchema = z.object({
  auto: z.boolean(),
  thresholdRatio: z.number().positive().max(1).optional(),
  active: z.boolean(),
}).strict() as unknown as z.ZodType<CompactionProjection>

/**
 * Build the unit for one validated configuration. The definition closes over
 * the config so `auto` and the per-route threshold resolution stay in lockstep
 * with the engine instance that registered it; registrants sharing the key are
 * ref-counted by the registry, and shipped presets all carry the same defaults.
 * @param config - the owning engine's validated configuration.
 * @returns the `compaction` projection definition.
 */
export function compactProjectionDefinition(config: ResolvedConfig): ProjectionDefinition<'compaction', CompactionProjectionState> {
  const thresholdRatioFor = (provider: string, model: string): number =>
    resolveTargetPolicy(config, { provider, model }).thresholdRatio

  return {
    key: 'compaction',
    schema: compactionSchema,
    init: () => ({ active: false }),
    apply: (state, event) => {
      switch (event.type) {
        case 'compaction/start':
          return state.active ? state : { ...state, active: true }
        case 'compaction/end':
          return state.active ? { ...state, active: false } : state
        case 'session/end-seed':
          // An unmatched `compaction/start` before the constructor seed belongs
          // to an ended lifecycle (the backend's own stale-orphan rule); the
          // fresh lifecycle starts clean.
          return state.active ? { ...state, active: false } : state
        case 'request/context': {
          const ratio = thresholdRatioFor(event.data.provider, event.data.model)
          return state.thresholdRatio === ratio ? state : { ...state, thresholdRatio: ratio }
        }
        default:
          return state
      }
    },
    view: ({ active, thresholdRatio }) => ({
      auto: config.auto,
      ...thresholdRatio === undefined ? {} : { thresholdRatio },
      active,
    }),
    stateVersion: 1,
  }
}
