/**
 * Dynamic-height virtual window math for the execution timeline. Rows have
 * unknown heights until mounted (default estimate), so the window is computed
 * over cumulative offsets with measured heights replacing the estimate as
 * rows render. Pure functions: the component owns the measurement map and
 * re-runs these on every measurement or scroll change.
 * @module
 */

/** Default height of an unmeasured row (a collapsed one-line event header). */
export const EXECUTION_ROW_ESTIMATE = 36

/** Extra rows mounted above and below the visible window. */
export const EXECUTION_ROW_OVERSCAN = 6

/** Height reader: measured row height by key, or undefined for the estimate. */
export type ExecutionHeightOf = (key: string) => number | undefined

/** Cumulative row offsets plus the total flow height. */
export interface ExecutionLayout {
  /** Offset of each row's top edge from the flow start. */
  readonly offsets: readonly number[]
  /** Total flow height (last offset plus the final row's height). */
  readonly total: number
}

/**
 * Compute cumulative offsets for `keys` in order, using the measured height
 * when present and the estimate otherwise.
 * @param keys - row keys in trace order.
 * @param heightOf - measured height lookup.
 * @returns offsets and the total flow height.
 */
export function executionOffsets(
  keys: readonly string[],
  heightOf: ExecutionHeightOf,
): ExecutionLayout {
  const offsets: number[] = Array.from({ length: keys.length }, () => 0)
  let total = 0
  for (let i = 0; i < keys.length; i++) {
    offsets[i] = total
    total += heightOf(keys[i] as string) ?? EXECUTION_ROW_ESTIMATE
  }
  return { offsets, total }
}

/** Inclusive-first/exclusive-last render window over `count` rows. */
export interface ExecutionWindow {
  readonly start: number
  readonly end: number
}

/**
 * Select the render window for a scroll position. Scans forward from the top
 * (rows are cheap; the scan is linear in the visible prefix) and extends by
 * the overscan on both sides.
 * @param scrollTop - current scrollport offset.
 * @param viewportHeight - visible scrollport height.
 * @param layout - offsets from {@link executionOffsets}.
 * @param count - number of rows.
 * @returns the half-open window to render.
 */
export function executionWindow(
  scrollTop: number,
  viewportHeight: number,
  layout: ExecutionLayout,
  count: number,
): ExecutionWindow {
  if (count === 0) return { start: 0, end: 0 }
  const viewportBottom = scrollTop + Math.max(0, viewportHeight)
  let start = 0
  while (start < count && (layout.offsets[start] ?? 0) + EXECUTION_ROW_ESTIMATE <= scrollTop) start += 1
  start = Math.max(0, start - EXECUTION_ROW_OVERSCAN)
  let end = start
  while (end < count && (layout.offsets[end] ?? 0) <= viewportBottom) end += 1
  end = Math.min(count, end + EXECUTION_ROW_OVERSCAN)
  return { start, end }
}

/** Whether the scrollport sits at its floor (within the follow threshold). */
export function isAtScrollFloor(scrollTop: number, scrollHeight: number, clientHeight: number, threshold = 24): boolean {
  return scrollHeight - scrollTop - clientHeight <= threshold
}
