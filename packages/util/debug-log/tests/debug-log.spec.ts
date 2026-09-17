import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  installUiDebugSink, isUiDebugEnabled, resetUiDebugForTests, setUiDebugEnabled,
  UI_DEBUG_PREFIX, uiDebug, uiDebugSpan, uiDebugSpanSync, uiDebugTick,
} from '../src/index.ts'

afterEach(() => {
  vi.useRealTimers()
  resetUiDebugForTests()
})

function capture(): { lines: string[]; dispose: () => void } {
  const lines: string[] = []
  const dispose = installUiDebugSink((line) => { lines.push(line) })
  return { lines, dispose }
}

describe('ui-debug tracer', () => {
  it('starts disabled and ignores writes', () => {
    const { lines, dispose } = capture()
    uiDebug('rpc', 'session.list')
    uiDebugTick('mux', 'downlink')
    expect(isUiDebugEnabled()).toBe(false)
    expect(lines).toEqual([])
    dispose()
  })

  it('writes a banner on enable and a disabled record on disable', () => {
    const { lines, dispose } = capture()
    setUiDebugEnabled(true)
    setUiDebugEnabled(true)
    expect(isUiDebugEnabled()).toBe(true)
    setUiDebugEnabled(false)
    setUiDebugEnabled(false)
    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain(`${UI_DEBUG_PREFIX} `)
    expect(lines[0]).toContain('debug.enabled sink="console.info"')
    expect(lines[1]).toContain('debug.disabled')
    dispose()
  })

  it('logs instant records with compact fields', () => {
    const { lines, dispose } = capture()
    setUiDebugEnabled(true)
    lines.length = 0
    uiDebug('rpc', 'bare')
    expect(lines[0]?.endsWith(' rpc.bare')).toBe(true)
    lines.length = 0
    uiDebug('session', 'installWindow', {
      sessionId: 'abc',
      events: 50,
      hasMore: true,
      empty: undefined,
      missing: null,
      tags: ['a', 'b'],
      meta: { k: 1 },
      note: 'x'.repeat(90),
      fn: () => 1,
    })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('session.installWindow')
    expect(lines[0]).toContain('sessionId="abc"')
    expect(lines[0]).toContain('events=50')
    expect(lines[0]).toContain('hasMore=true')
    expect(lines[0]).toContain('missing=null')
    expect(lines[0]).toContain('tags=[2]')
    expect(lines[0]).toContain('meta={1}')
    expect(lines[0]).toContain('...')
    expect(lines[0]).not.toContain('empty=')
    expect(lines[0]).toContain('fn=')
    dispose()
  })

  it('omits the fields suffix when every value is undefined', () => {
    const { lines, dispose } = capture()
    setUiDebugEnabled(true)
    lines.length = 0
    uiDebug('rpc', 'noop', { skip: undefined })
    expect(lines[0]?.endsWith(' rpc.noop')).toBe(true)
    dispose()
  })

  it('times a successful async span and a throwing one', async () => {
    const { lines, dispose } = capture()
    setUiDebugEnabled(true)
    lines.length = 0
    const value = await uiDebugSpan(
      'rpc',
      'session.history',
      { sessionId: 's1' },
      async () => ({ events: [1, 2] }),
      result => ({ events: result.events.length }),
    )
    expect(value.events).toHaveLength(2)
    expect(lines[0]).toMatch(/\+[\d.]+ms rpc\.session\.history sessionId="s1" events=2/)
    await expect(uiDebugSpan('rpc', 'boom', undefined, async () => {
      throw new Error('nope')
    })).rejects.toThrow('nope')
    expect(lines[1]).toContain('ok=false')
    expect(lines[1]).toContain('error="Error: nope"')
    dispose()
  })

  it('passes through when disabled without calling resultData', async () => {
    const resultData = vi.fn()
    await expect(uiDebugSpan('rpc', 'x', undefined, async () => 7, resultData)).resolves.toBe(7)
    expect(uiDebugSpanSync('rpc', 'x', undefined, () => 8, resultData)).toBe(8)
    expect(resultData).not.toHaveBeenCalled()
  })

  it('times a successful sync span and a throwing one', () => {
    const { lines, dispose } = capture()
    setUiDebugEnabled(true)
    lines.length = 0
    expect(uiDebugSpanSync('history', 'paginate', { total: 10 }, () => ({ page: 3 }), v => ({ page: v.page }))).toEqual({ page: 3 })
    expect(lines[0]).toContain('history.paginate')
    expect(lines[0]).toContain('page=3')
    expect(() => uiDebugSpanSync('history', 'paginate', undefined, () => {
      throw new Error('cut')
    })).toThrow('cut')
    expect(lines[1]).toContain('ok=false')
    dispose()
  })

  it('samples ticks into a one-second summary and flushes on disable', () => {
    vi.useFakeTimers()
    const { lines, dispose } = capture()
    setUiDebugEnabled(true)
    lines.length = 0
    uiDebugTick('mux', 'downlink', { type: 'session/event' })
    uiDebugTick('mux', 'downlink', { type: 'session/event' })
    uiDebugTick('mux', 'downlink', { type: 'assistant/chunk' })
    uiDebugTick('mux', 'downlink')
    expect(lines).toEqual([])
    vi.advanceTimersByTime(1_000)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('mux.downlink')
    expect(lines[0]).toContain('count=4')
    expect(lines[0]).toContain('byType={3}')
    lines.length = 0
    uiDebugTick('mux', 'downlink', { type: 'session/event' })
    setUiDebugEnabled(false)
    expect(lines[0]).toContain('mux.downlink')
    expect(lines[0]).toContain('count=1')
    expect(lines[1]).toContain('debug.disabled')
    dispose()
  })

  it('swallows a timer flush after reset and a zero-count disable flush', () => {
    vi.useFakeTimers()
    const { lines, dispose } = capture()
    setUiDebugEnabled(true)
    uiDebugTick('mux', 'downlink', { type: 'session/event' })
    resetUiDebugForTests()
    vi.advanceTimersByTime(1_000)
    expect(lines.some(line => line.includes('mux.downlink'))).toBe(false)
    const again = capture()
    setUiDebugEnabled(true)
    uiDebugTick('session', 'live', { type: 'assistant/chunk' })
    vi.advanceTimersByTime(1_000)
    again.lines.length = 0
    setUiDebugEnabled(false)
    expect(again.lines.some(line => line.includes('session.live'))).toBe(false)
    expect(again.lines.some(line => line.includes('debug.disabled'))).toBe(true)
    again.dispose()
    dispose()
  })

  it('restores the previous sink and uses console.info by default', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    setUiDebugEnabled(true)
    expect(info.mock.calls[0]?.[0]).toContain('debug.enabled')
    const { dispose } = capture()
    uiDebug('rpc', 'inner')
    dispose()
    uiDebug('rpc', 'outer')
    expect(info.mock.calls.some(call => String(call[0]).includes('rpc.outer'))).toBe(true)
    info.mockRestore()
  })
})
