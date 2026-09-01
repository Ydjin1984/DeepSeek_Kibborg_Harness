/**
 * Client-safe compaction policy and status projection vocabulary. Pure types
 * plus the `SessionProjectionMap` merge — no cordis imports, so the browser
 * half of the compaction UI can name the key without loading the host plugin's
 * Context merges (the `dsh-compaction/checkpoint` pattern).
 *
 * @module @deepseek-ai/dsh-compaction/projection
 */

/**
 * Per-session compaction facts the browser reads: whether automatic compaction
 * is enabled, the resolved pressure threshold for the current model route, and
 * whether a compaction transaction is in flight. The value is derived from the
 * durable log (the `compaction/*` bracket events and `request/context` route
 * records) plus the backend's validated configuration, so it is model-invisible
 * read-side state — never a session event of its own.
 */
export interface CompactionProjection {
  /**
   * Whether automatic step-pressure and context-overflow compaction is enabled
   * for this deployment (`BasicCompactionConfig.auto`). Absent key means the
   * compaction backend is not mounted for the session.
   */
  auto: boolean
  /**
   * Resolved pressure threshold ratio for the current route (a
   * `modelPolicies` override or the top-level default); absent until the
   * route is known. Occupancy at or above this fraction is where automatic
   * compaction fires, so a UI can surface "auto-compacts at ~N%".
   */
  thresholdRatio?: number
  /** A compaction transaction is currently in flight (`compaction/start` without its `compaction/end`). */
  active: boolean
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /** Compaction policy and lock status for the current route. */
    compaction: CompactionProjection
  }
}
