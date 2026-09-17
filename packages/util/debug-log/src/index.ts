/**
 * Process-local UI diagnostics tracer. Host and browser each hold their own
 * enable flag; when on, every record is one stdout/console.info line prefixed
 * `[dsh-debug]` so the web Host console (start-menu 9) and DevTools share a
 * grep key. Disabled calls are a boolean check and return.
 * @module @deepseek-ai/dsh-debug-log
 */

/** Line prefix shared by Host stdout and the browser console. */
export const UI_DEBUG_PREFIX = '[dsh-debug]'

/** Flush sampled mux/event meters at this interval while the tracer is on. */
const TICK_FLUSH_MS = 1_000

type DebugSink = (line: string) => void

interface Meter {
  count: number
  byType: Map<string, number>
  started: number
  timer: ReturnType<typeof setTimeout> | undefined
}

interface DebugStore {
  enabled: boolean
  sink: DebugSink
  meters: Map<string, Meter>
}

/** Shared across inlined client copies of this module in one JavaScript realm. */
const STORE_KEY = Symbol.for('@deepseek-ai/dsh-debug-log')

function store(): DebugStore {
  const holder = globalThis as unknown as Record<symbol, DebugStore | undefined>
  let current = holder[STORE_KEY]
  if (current === undefined) {
    current = { enabled: false, sink: defaultSink, meters: new Map() }
    holder[STORE_KEY] = current
  }
  return current
}

function defaultSink(line: string): void {
  console.info(line)
}

function nowMs(): number {
  return performance.now()
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0')
}

function formatClock(): string {
  const date = new Date()
  return `${pad(date.getHours(), 2)}:${pad(date.getMinutes(), 2)}:${pad(date.getSeconds(), 2)}.${pad(date.getMilliseconds(), 3)}`
}

function formatValue(value: unknown): string {
  if (typeof value === 'string') {
    return value.length > 80 ? JSON.stringify(`${value.slice(0, 77)}...`) : JSON.stringify(value)
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value === null || value === undefined) return String(value)
  if (Array.isArray(value)) return `[${value.length}]`
  if (typeof value === 'object') return `{${Object.keys(value).length}}`
  return String(value)
}

function formatData(data: Record<string, unknown> | undefined): string {
  if (data === undefined) return ''
  const parts: string[] = []
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue
    parts.push(`${key}=${formatValue(value)}`)
  }
  return parts.length === 0 ? '' : ` ${parts.join(' ')}`
}

function emit(
  area: string,
  action: string,
  data?: Record<string, unknown>,
  durationMs?: number,
): void {
  const duration = durationMs === undefined ? '' : ` +${durationMs.toFixed(1)}ms`
  store().sink(`${UI_DEBUG_PREFIX} ${formatClock()}${duration} ${area}.${action}${formatData(data)}`)
}

function meterKey(area: string, action: string): string {
  return `${area}\0${action}`
}

function splitMeterKey(key: string): { area: string; action: string } {
  const split = key.indexOf('\0')
  return { area: key.slice(0, split), action: key.slice(split + 1) }
}

function flushMeter(key: string): void {
  const meter = store().meters.get(key)
  /* v8 ignore next -- the timer is only armed while this key is in `meters`. */
  if (meter === undefined) return
  if (meter.timer !== undefined) {
    clearTimeout(meter.timer)
    meter.timer = undefined
  }
  if (meter.count === 0) return
  const { area, action } = splitMeterKey(key)
  emit(area, action, {
    count: meter.count,
    windowMs: nowMs() - meter.started,
    byType: Object.fromEntries(meter.byType),
  })
  meter.count = 0
  meter.byType.clear()
  meter.started = nowMs()
}

function flushAllMeters(): void {
  for (const key of [...store().meters.keys()]) flushMeter(key)
}

/**
 * Whether this process currently writes diagnostics.
 * @returns true after {@link setUiDebugEnabled}(true) until it is turned off.
 */
export function isUiDebugEnabled(): boolean {
  return store().enabled
}

/**
 * Turn the tracer on or off for this process. A false→true edge writes a
 * banner; a true→false edge flushes sampled meters then writes `disabled`.
 * @param next - the desired enablement.
 */
export function setUiDebugEnabled(next: boolean): void {
  const current = store()
  if (current.enabled === next) return
  current.enabled = next
  if (next) {
    emit('debug', 'enabled', { sink: 'console.info' })
    return
  }
  flushAllMeters()
  emit('debug', 'disabled')
}

/**
 * Replace the write destination. Tests install an array sink; production
 * keeps `console.info`.
 * @param write - receives each formatted line.
 * @returns disposer restoring the previous sink.
 */
export function installUiDebugSink(write: DebugSink): () => void {
  const current = store()
  const previous = current.sink
  current.sink = write
  return () => { current.sink = previous }
}

/**
 * Write one instant record when the tracer is on.
 * @param area - subsystem (`rpc`, `history`, `mux`, `session`, `ui`).
 * @param action - verb inside that subsystem.
 * @param data - compact fields; arrays become `[n]`, objects `{n}`.
 */
export function uiDebug(area: string, action: string, data?: Record<string, unknown>): void {
  if (!store().enabled) return
  emit(area, action, data)
}

/**
 * Time one async action. Disabled, this is `fn()` with no allocation.
 * @param area - subsystem.
 * @param action - verb.
 * @param data - fields known before `fn` runs.
 * @param fn - the timed work.
 * @param resultData - extra fields from the resolved value (not called when `fn` throws).
 * @returns `fn`'s result.
 */
export function uiDebugSpan<T>(
  area: string,
  action: string,
  data: Record<string, unknown> | undefined,
  fn: () => Promise<T>,
  resultData?: (value: T) => Record<string, unknown>,
): Promise<T> {
  if (!store().enabled) return fn()
  const started = nowMs()
  return fn().then(
    (value) => {
      emit(area, action, { ...data, ...resultData?.(value) }, nowMs() - started)
      return value
    },
    (error: unknown) => {
      emit(area, action, { ...data, ok: false, error: String(error) }, nowMs() - started)
      throw error
    },
  )
}

/**
 * Time one synchronous action. Disabled, this is `fn()` with no allocation.
 * @param area - subsystem.
 * @param action - verb.
 * @param data - fields known before `fn` runs.
 * @param fn - the timed work.
 * @param resultData - extra fields from the return value (not called when `fn` throws).
 * @returns `fn`'s result.
 */
export function uiDebugSpanSync<T>(
  area: string,
  action: string,
  data: Record<string, unknown> | undefined,
  fn: () => T,
  resultData?: (value: T) => Record<string, unknown>,
): T {
  if (!store().enabled) return fn()
  const started = nowMs()
  try {
    const value = fn()
    emit(area, action, { ...data, ...resultData?.(value) }, nowMs() - started)
    return value
  } catch (error: unknown) {
    emit(area, action, { ...data, ok: false, error: String(error) }, nowMs() - started)
    throw error
  }
}

/**
 * Count a high-frequency event (mux frames, live session events) into a
 * one-second summary instead of one line per occurrence.
 * @param area - subsystem.
 * @param action - verb.
 * @param data - optional `type` field aggregated into `byType`.
 */
export function uiDebugTick(area: string, action: string, data?: Record<string, unknown>): void {
  const current = store()
  if (!current.enabled) return
  const key = meterKey(area, action)
  let meter = current.meters.get(key)
  if (meter === undefined) {
    meter = { count: 0, byType: new Map(), started: nowMs(), timer: undefined }
    current.meters.set(key, meter)
  }
  meter.count += 1
  const type = typeof data?.type === 'string' ? data.type : 'other'
  meter.byType.set(type, (meter.byType.get(type) ?? 0) + 1)
  if (meter.timer !== undefined) return
  meter.timer = setTimeout(() => { flushMeter(key) }, TICK_FLUSH_MS)
}

/**
 * Restore the default-off tracer, default sink, and empty meters. Tests call
 * this in `afterEach` so enablement cannot leak across files.
 */
export function resetUiDebugForTests(): void {
  const current = store()
  current.enabled = false
  current.sink = defaultSink
  for (const meter of current.meters.values()) {
    if (meter.timer !== undefined) clearTimeout(meter.timer)
  }
  current.meters.clear()
}
