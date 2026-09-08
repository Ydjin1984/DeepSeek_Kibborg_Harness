import { afterEach, describe, expect, it, vi } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { MirrorEngine, type ToolPresenter } from '../src/mirror.ts'
import { RecorderTransport, flushMicrotasks, sessionEvent } from './helpers.ts'

const SESSION = { id: SessionId('s1') }
const noopPresenter: ToolPresenter = {
  presentCall: (name, rawArgs) => name === 'bash'
    ? { title: JSON.parse(rawArgs).command as string, kind: 'execute' }
    : { title: `${name} ${rawArgs.slice(0, 30)}` },
}
const quiet = { warn: () => {} }

function makeEngine(transport = new RecorderTransport(), present = noopPresenter): { engine: MirrorEngine; transport: RecorderTransport } {
  const recorder = transport
  return { engine: new MirrorEngine(recorder, present, quiet), transport: recorder }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('MirrorEngine', () => {
  it('ignores events from sessions that are not attached', async () => {
    const { engine, transport } = makeEngine()
    engine.attach('other')
    engine.onSessionEvent(SESSION as never, sessionEvent('user/message', {
      role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'hi' }],
    }))
    await flushMicrotasks()
    expect(transport.messages).toHaveLength(0)
  })

  it('mirrors user text lines with a user prefix', async () => {
    const { engine, transport } = makeEngine()
    engine.attach(SESSION.id)
    engine.onSessionEvent(SESSION as never, sessionEvent('user/message', {
      role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'продолжай' }],
    }))
    await flushMicrotasks()
    expect(transport.text(1)).toBe('👤 продолжай')
  })

  it('skips injected plugin user messages', async () => {
    const { engine, transport } = makeEngine()
    engine.attach(SESSION.id)
    engine.onSessionEvent(SESSION as never, sessionEvent('user/message', {
      role: 'user', source: { kind: 'plugin', plugin: 'file-watch' }, content: [{ type: 'text', text: 'файл изменён' }],
    }))
    await flushMicrotasks()
    expect(transport.messages).toHaveLength(0)
  })

  it('streams assistant text into one debounced editable message', async () => {
    vi.useFakeTimers()
    const { engine, transport } = makeEngine()
    engine.attach(SESSION.id)
    engine.onSessionEvent(SESSION as never, sessionEvent('assistant/chunk', { turn: 0, step: 0, chunk: { type: 'text-delta', index: 0, text: 'Прив' } }))
    engine.onSessionEvent(SESSION as never, sessionEvent('assistant/chunk', { turn: 0, step: 0, chunk: { type: 'text-delta', index: 0, text: 'ет, мир' } }))
    await vi.advanceTimersByTimeAsync(800)
    expect(transport.text(1)).toBe('Привет, мир')
    // Final event lands the authoritative text.
    engine.onSessionEvent(SESSION as never, sessionEvent('assistant/message', {
      turn: 0, step: 0, message: { content: [{ type: 'text', text: 'Привет, мир!' }] },
    }))
    await flushMicrotasks()
    expect(transport.text(1)).toBe('Привет, мир!')
  })

  it('sends a non-streamed assistant message immediately', async () => {
    const { engine, transport } = makeEngine()
    engine.attach(SESSION.id)
    engine.onSessionEvent(SESSION as never, sessionEvent('assistant/message', {
      turn: 0, step: 0, message: { content: [{ type: 'text', text: 'Готово' }] },
    }))
    await flushMicrotasks()
    expect(transport.text(1)).toBe('Готово')
  })

  it('renders tool calls as compact lines that gain an outcome suffix', async () => {
    const { engine, transport } = makeEngine()
    engine.attach(SESSION.id)
    engine.onSessionEvent(SESSION as never, sessionEvent('tool/call', {
      turn: 0, step: 0, callId: 'c1', name: 'bash', arguments: '{"command":"pnpm test"}',
    }))
    await flushMicrotasks()
    expect(transport.text(1)).toBe('🛠 pnpm test')
    engine.onSessionEvent(SESSION as never, sessionEvent('tool/result', {
      turn: 0, step: 0, message: { source: { kind: 'tool', callId: 'c1' }, content: [{ type: 'text', text: 'ok' }] },
    }))
    await flushMicrotasks()
    expect(transport.text(1)).toBe('🛠 pnpm test — ✅')
  })

  it('does not render ask_user_question as an action line', async () => {
    const { engine, transport } = makeEngine()
    engine.attach(SESSION.id)
    engine.onSessionEvent(SESSION as never, sessionEvent('tool/call', {
      turn: 0, step: 0, callId: 'c2', name: 'ask_user_question',
      arguments: '{"questions":[{"id":"q","question":"Продолжаем?","options":[{"label":"Да"}]}]}',
    }))
    await flushMicrotasks()
    expect(transport.messages).toHaveLength(0)
  })

  it('renders the user answer after ask_user_question settles', async () => {
    const { engine, transport } = makeEngine()
    engine.attach(SESSION.id)
    engine.onSessionEvent(SESSION as never, sessionEvent('tool/call', {
      turn: 0, step: 0, callId: 'c3', name: 'ask_user_question',
      arguments: '{"questions":[{"id":"q","question":"Продолжаем?"}]}',
    }))
    await flushMicrotasks()
    engine.onSessionEvent(SESSION as never, sessionEvent('tool/result', {
      turn: 0, step: 0,
      message: {
        source: { kind: 'tool', callId: 'c3' },
        content: [{ type: 'text', text: '{"answers":[{"id":"q","selected":[],"custom":"давай"}]}' }],
      },
    }))
    await flushMicrotasks()
    expect(transport.text(1)).toBe('👤 Продолжаем?: «давай»')
  })

  it('forgets mirror state on detach', async () => {
    const { engine, transport } = makeEngine()
    engine.attach(SESSION.id)
    engine.detach()
    engine.onSessionEvent(SESSION as never, sessionEvent('user/message', {
      role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'hi' }],
    }))
    await flushMicrotasks()
    expect(transport.messages).toHaveLength(0)
  })
})
