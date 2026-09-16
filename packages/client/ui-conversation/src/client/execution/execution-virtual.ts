/** Scroll-floor math for the execution timeline scrollport. */

/** Whether the scrollport sits at its floor (within the follow threshold).
 * @param scrollTop - current vertical scroll offset.
 * @param scrollHeight - total scrollable content height.
 * @param clientHeight - visible viewport height.
 * @param threshold - maximum pixels from the bottom to consider at floor.
 * @returns true when the scroll position is within threshold of the scroll height.
 */
export function isAtScrollFloor(scrollTop: number, scrollHeight: number, clientHeight: number, threshold = 24): boolean {
  return scrollHeight - scrollTop - clientHeight <= threshold
}
