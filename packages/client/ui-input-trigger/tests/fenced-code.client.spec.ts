import { describe, expect, it } from 'vitest'
import { isFencedCodeOffset, scanFencedSegments } from '../src/core/fenced-code.ts'

describe('scanFencedSegments', () => {
  it('keeps ordinary text as one exact range', () => {
    expect(scanFencedSegments('ТЗ: @file')).toEqual([{ kind: 'text', start: 0, end: 9 }])
  })

  it('finds two fenced blocks and preserves offsets around them', () => {
    const source = 'До\n```ts\nconst a = 1\n```\nмежду\n```\nx\n```\nпосле'
    const segments = scanFencedSegments(source)
    expect(segments.map(segment => segment.kind)).toEqual(['text', 'code', 'text', 'code', 'text'])
    expect(segments.map(segment => source.slice(segment.start, segment.end)).join('')).toBe(source)
    const codes = segments.filter(segment => segment.kind === 'code')
    expect(codes.map(segment => [segment.lang, source.slice(segment.contentStart, segment.contentEnd), segment.closed]))
      .toEqual([['ts', 'const a = 1\n', true], [null, 'x\n', true]])
  })

  it('accepts CRLF, indent, and a longer fence containing three backticks in code', () => {
    const source = '  ````tsx\r\nline ``` inside\r\n  ````\r\nend'
    const code = scanFencedSegments(source).find(segment => segment.kind === 'code')
    expect(code).toMatchObject({ lang: 'tsx', closed: true })
    expect(source.slice(code!.contentStart, code!.contentEnd)).toBe('line ``` inside\r\n')
  })

  it('treats an unfinished fence as code through the end of the draft', () => {
    const source = 'intro\n```js\n@file /goal'
    const code = scanFencedSegments(source).find(segment => segment.kind === 'code')
    expect(code).toMatchObject({ lang: 'js', closed: false, contentEnd: source.length, fenceEnd: source.length })
    expect(isFencedCodeOffset(source, source.length)).toBe(true)
  })

  it('does not treat inline backticks as a fenced block', () => {
    const source = 'Use ``` within one line'
    expect(scanFencedSegments(source)).toEqual([{ kind: 'text', start: 0, end: source.length }])
    expect(isFencedCodeOffset(source, source.indexOf('```') + 2)).toBe(false)
  })

  it('suppresses caret positions through a closed fence but not afterward', () => {
    const source = '```\n@file\n```\n@real'
    expect(isFencedCodeOffset(source, source.indexOf('@file') + 5)).toBe(true)
    expect(isFencedCodeOffset(source, source.indexOf('@real') + 5)).toBe(false)
  })
})
