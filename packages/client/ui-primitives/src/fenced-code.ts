/** Exact UTF-16 offsets for ordinary text and fenced code in a user draft. */
export type FencedSegment =
  | { readonly kind: 'text'; readonly start: number; readonly end: number }
  | {
    readonly kind: 'code'
    readonly start: number
    readonly end: number
    readonly fenceStart: number
    readonly contentStart: number
    readonly contentEnd: number
    readonly fenceEnd: number
    readonly lang: string | null
    readonly closed: boolean
  }

interface SourceLine {
  readonly start: number
  readonly end: number
  readonly contentEnd: number
  readonly next: number
}

/** One line with offsets that retain the source's original newline spelling. */
function sourceLine(text: string, start: number): SourceLine {
  const newline = text.indexOf('\n', start)
  const end = newline < 0 ? text.length : newline
  return {
    start,
    end,
    contentEnd: end > start && text.charCodeAt(end - 1) === 13 ? end - 1 : end,
    next: newline < 0 ? text.length : newline + 1,
  }
}

/** Number of fence marks after at most three leading spaces. */
function fenceMarks(text: string, line: SourceLine): { count: number; after: number } {
  let at = line.start
  while (at < line.contentEnd && text.charCodeAt(at) === 32 && at - line.start < 3) at++
  const marksStart = at
  while (at < line.contentEnd && text.charCodeAt(at) === 96) at++
  return { count: at - marksStart, after: at }
}

/**
 * Split authored text into ordinary and fenced ranges without changing it.
 * @param text - Exact draft or logged user text.
 * @returns Non-overlapping segments covering the complete input.
 */
export function scanFencedSegments(text: string): readonly FencedSegment[] {
  const segments: FencedSegment[] = []
  let plainStart = 0
  let position = 0
  while (position < text.length) {
    const opening = sourceLine(text, position)
    const marks = fenceMarks(text, opening)
    const info = text.slice(marks.after, opening.contentEnd)
    if (marks.count < 3 || info.includes('`')) {
      position = opening.next
      continue
    }
    if (plainStart < opening.start) segments.push({ kind: 'text', start: plainStart, end: opening.start })
    const lang = /^[A-Za-z0-9_+.#-]+/u.exec(info.trimStart())?.[0] ?? null
    const contentStart = opening.next
    let cursor = contentStart
    let closing: SourceLine | null = null
    while (cursor < text.length) {
      const candidate = sourceLine(text, cursor)
      const closeMarks = fenceMarks(text, candidate)
      const remainder = text.slice(closeMarks.after, candidate.contentEnd)
      if (closeMarks.count >= marks.count && /^[ \t]*$/u.test(remainder)) {
        closing = candidate
        break
      }
      cursor = candidate.next
    }
    const end = closing?.end ?? text.length
    segments.push({
      kind: 'code',
      start: opening.start,
      end,
      fenceStart: opening.start,
      contentStart,
      contentEnd: closing?.start ?? text.length,
      fenceEnd: end,
      lang,
      closed: closing !== null,
    })
    plainStart = end
    position = closing?.next ?? text.length
  }
  if (plainStart < text.length || segments.length === 0) {
    segments.push({ kind: 'text', start: plainStart, end: text.length })
  }
  return segments
}

/**
 * Whether the caret lies inside a fence, including an unfinished fence at EOF.
 * @param text - Exact draft text.
 * @param offset - UTF-16 caret offset.
 * @returns True while code formatting owns the caret.
 */
export function isFencedCodeOffset(text: string, offset: number): boolean {
  return scanFencedSegments(text).some(segment => segment.kind === 'code'
    && offset >= segment.fenceStart
    && (segment.closed ? offset < segment.fenceEnd : offset <= segment.fenceEnd))
}
