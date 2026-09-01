import { describe, expect, it } from 'vitest'
import { formatDateTime, formatNumber, formatPercent } from '../src/client/formats.ts'

describe('formatDateTime', () => {
  it('formats a valid ISO timestamp for the given locale', () => {
    // Fixed output for the en locale so the assertion is locale-independent.
    const value = formatDateTime('2026-01-02T03:04:05.000Z', 'en')
    expect(value).toContain('2026')
    expect(value).toContain('Jan')
  })

  it('returns empty for an absent timestamp', () => {
    expect(formatDateTime(undefined, 'en')).toBe('')
  })

  it('returns empty for an unparseable timestamp', () => {
    expect(formatDateTime('not-a-date', 'en')).toBe('')
  })
})

describe('formatNumber', () => {
  it('groups a large value and keeps one fractional digit', () => {
    expect(formatNumber(1234.56, 'en')).toBe('1,234.6')
  })

  it('renders a whole number without a fraction', () => {
    expect(formatNumber(42, 'en')).toBe('42')
  })
})

describe('formatPercent', () => {
  it('signs positive values explicitly', () => {
    expect(formatPercent(12.34, 'en')).toBe('+12.3%')
  })

  it('signs negative values explicitly', () => {
    expect(formatPercent(-4.2, 'en')).toBe('-4.2%')
  })

  it('renders zero with a plus sign', () => {
    expect(formatPercent(0, 'en')).toBe('+0%')
  })
})
