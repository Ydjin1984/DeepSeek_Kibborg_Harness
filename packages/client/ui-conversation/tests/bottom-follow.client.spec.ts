import { describe, expect, it } from 'vitest'
import {
  INITIAL_FOLLOW_MODE, nextFollowMode,
  type FollowAction, type FollowMode,
} from '../src/client/contract/bottom-follow.ts'

describe('nextFollowMode', () => {
  it('starts following and stops on the first intentional move away from the floor', () => {
    expect(nextFollowMode(INITIAL_FOLLOW_MODE, 'reader-left')).toBe('reading')
  })

  it.each([
    ['following', 'reader-left', 'reading'],
    ['reading', 'reader-left', 'reading'],
    ['jumping', 'reader-left', 'reading'],
    ['following', 'reader-at-floor', 'following'],
    ['reading', 'reader-at-floor', 'following'],
    ['jumping', 'reader-at-floor', 'following'],
    ['following', 'jump', 'jumping'],
    ['reading', 'jump', 'jumping'],
    ['jumping', 'jump', 'jumping'],
    ['following', 'jump-complete', 'following'],
    ['reading', 'jump-complete', 'reading'],
    ['jumping', 'jump-complete', 'following'],
    ['following', 'jump-interrupted', 'following'],
    ['reading', 'jump-interrupted', 'reading'],
    ['jumping', 'jump-interrupted', 'reading'],
  ] satisfies Array<[FollowMode, FollowAction, FollowMode]>)('%s + %s → %s', (mode, action, expected) => {
    expect(nextFollowMode(mode, action)).toBe(expected)
  })

  it('does not resume following when a cancelled jump completes late', () => {
    const jumping = nextFollowMode('reading', 'jump')
    const reading = nextFollowMode(jumping, 'jump-interrupted')
    expect(nextFollowMode(reading, 'jump-complete')).toBe('reading')
  })

  it('only resumes following after a manual return to the floor', () => {
    const reading = nextFollowMode('following', 'reader-left')
    expect(nextFollowMode(reading, 'reader-at-floor')).toBe('following')
  })
})
