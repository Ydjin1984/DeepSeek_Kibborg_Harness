// Execution virtual list math: offsets, window selection, floor detection.

import { describe, expect, it } from 'vitest'
import {
  EXECUTION_ROW_ESTIMATE, executionOffsets, executionWindow, isAtScrollFloor,
} from '../src/client/execution/execution-virtual.ts'

describe('executionOffsets', () => {
  it('uses the estimate for unmeasured rows', () => {
    const layout = executionOffsets(['a', 'b', 'c'], () => undefined)
    expect(layout.offsets).toEqual([0, EXECUTION_ROW_ESTIMATE, EXECUTION_ROW_ESTIMATE * 2])
    expect(layout.total).toBe(EXECUTION_ROW_ESTIMATE * 3)
  })

  it('blends measured heights with the estimate', () => {
    const heights = new Map([['b', 100]])
    const layout = executionOffsets(['a', 'b', 'c'], key => heights.get(key))
    expect(layout.offsets).toEqual([0, EXECUTION_ROW_ESTIMATE, EXECUTION_ROW_ESTIMATE + 100])
    expect(layout.total).toBe(EXECUTION_ROW_ESTIMATE + 100 + EXECUTION_ROW_ESTIMATE)
  })

  it('handles the empty list', () => {
    const layout = executionOffsets([], () => undefined)
    expect(layout.offsets).toEqual([])
    expect(layout.total).toBe(0)
  })
})

describe('executionWindow', () => {
  const keys = Array.from({ length: 40 }, (_, i) => `k${i}`)
  const layout = executionOffsets(keys, () => 50)

  it('starts at the visible row with overscan above', () => {
    // Row 20 starts at 1000; viewport shows 1000..1300 → rows 20..26.
    const window = executionWindow(1000, 300, layout, keys.length)
    expect(window.start).toBe(20 - 6)
    expect(window.end).toBeGreaterThanOrEqual(27)
    expect(window.end).toBeLessThanOrEqual(keys.length)
  })

  it('clamps to the list bounds', () => {
    const bottom = executionWindow(layout.total - 100, 300, layout, keys.length)
    expect(bottom.end).toBe(keys.length)
    const top = executionWindow(0, 300, layout, keys.length)
    expect(top.start).toBe(0)
  })

  it('returns an empty window for no rows', () => {
    expect(executionWindow(0, 300, { offsets: [], total: 0 }, 0)).toEqual({ start: 0, end: 0 })
  })
})

describe('isAtScrollFloor', () => {
  it('detects the floor within the follow threshold', () => {
    expect(isAtScrollFloor(100, 200, 50, 24)).toBe(false) // 50 remaining > 24
    expect(isAtScrollFloor(130, 200, 50, 24)).toBe(true) // 20 remaining <= 24
    expect(isAtScrollFloor(140, 200, 50, 24)).toBe(true) // 10 remaining <= 24
  })

  it('follows the configured threshold', () => {
    expect(isAtScrollFloor(140, 200, 50, 5)).toBe(false) // 10 remaining > 5
    expect(isAtScrollFloor(145, 200, 50, 5)).toBe(true) // 5 remaining <= 5
  })
})
