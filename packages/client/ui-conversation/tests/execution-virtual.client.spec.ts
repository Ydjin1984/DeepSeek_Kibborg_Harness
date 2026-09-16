// Execution scroll-floor detection.

import { describe, expect, it } from 'vitest'
import { isAtScrollFloor } from '../src/client/execution/execution-virtual.ts'

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
