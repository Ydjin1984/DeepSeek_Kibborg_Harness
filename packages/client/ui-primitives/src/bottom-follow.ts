/** Reader-controlled bottom-follow mode shared by conversation views. */
export type FollowMode = 'following' | 'reading' | 'jumping'

/** Intentional reader and jump-control events; layout writes do not dispatch actions. */
export type FollowAction = 'reader-left' | 'reader-at-floor' | 'jump' | 'jump-complete' | 'jump-interrupted'

/** Initial mode when a session opens. */
export const INITIAL_FOLLOW_MODE: FollowMode = 'following'

/** Transient per-tab reading position held by the mounted Session shell. */
export interface ViewScrollBookmark {
  readonly mode: FollowMode
  readonly anchorKey: string | null
  readonly anchorOffset: number
  readonly scrollTop: number
}

/**
 * Resolve one reader intent without consulting scroll geometry or global state.
 * @param mode - current follow mode.
 * @param action - reader intent or jump lifecycle event.
 * @returns follow mode after the action.
 */
export function nextFollowMode(mode: FollowMode, action: FollowAction): FollowMode {
  switch (action) {
    case 'reader-left': return 'reading'
    case 'reader-at-floor': return 'following'
    case 'jump': return 'jumping'
    case 'jump-complete': return mode === 'jumping' ? 'following' : mode
    case 'jump-interrupted': return mode === 'jumping' ? 'reading' : mode
  }
  const unreachable: never = action
  return unreachable
}
