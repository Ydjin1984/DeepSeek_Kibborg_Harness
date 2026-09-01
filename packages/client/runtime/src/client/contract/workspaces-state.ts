/**
 * Workspace-list state types shared by the workspaces domain and its outward
 * contract face. Declared in contract so `contract/workspaces.ts` never
 * imports the workspaces domain; the domain modules re-export these for
 * in-domain consumers.
 * @module
 */

import type { RpcError, SessionId, WorkspaceId, WorkspaceView } from '@deepseek-ai/dsh-api-remotes/client'

/** Workspace-list arrival lifecycle; the readiness half of the two-baseline projection. */
export type WorkspaceListPhase = 'pending' | 'ready'

/** Workspace list plus the two-baseline readiness and default-target projection. */
export interface WorkspaceListState {
  items: readonly WorkspaceView[]
  /**
   * Registry-global archive set in Host order: grouping surfaces hide these
   * sessions everywhere (workspace groups and the ungrouped bucket) while
   * their session logs and workspace accounting slots remain. A plain array
   * (store-engine vocabulary; immer drafts reject Sets) — membership lookups
   * build their own transient Set.
   */
  archivedSessionIds: readonly SessionId[]
  state: 'idle' | 'loading' | 'error'
  phase: WorkspaceListPhase
  error: RpcError | null
  /** True only after both workspace.list and session.list have succeeded. */
  baselinesReady: boolean
  /** Most recently active Workspace, derived without changing `items` order. */
  recentWorkspaceId: WorkspaceId | undefined
}
