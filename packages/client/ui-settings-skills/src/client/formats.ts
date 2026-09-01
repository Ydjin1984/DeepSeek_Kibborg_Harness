/** Presentation formatting helpers for the Skills Manager surfaces. */

/**
 * Format an ISO timestamp for display; empty for absent or unparseable input.
 * @param iso - ISO-8601 string (or undefined for "never").
 * @param locale - BCP-47 locale tag.
 * @returns the formatted date-time, or '' when absent/unparseable.
 */
export function formatDateTime(iso: string | undefined, locale: string): string {
  if (iso === undefined) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

/**
 * Format a number with grouping for display.
 * @param value - numeric value.
 * @param locale - BCP-47 locale tag.
 * @returns the grouped number text.
 */
export function formatNumber(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value)
}

/**
 * Format a signed percentage (benchmark improvement) with an explicit sign.
 * @param value - percentage points (e.g. 12.34).
 * @param locale - BCP-47 locale tag.
 * @returns e.g. `+12.3%` / `-4%`.
 */
export function formatPercent(value: number, locale: string): string {
  const sign = value >= 0 ? '+' : ''
  return `${sign}${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value)}%`
}
