import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { CallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'

import * as tool from '../src/index.ts'

const testToolSignal = new AbortController().signal

async function setup(config: Record<string, unknown> = {}): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(tool, { apiKey: 'test-key', ...config })
  return ctx
}

function fetchArgs(call: unknown): [string, RequestInit] {
  const [url, init] = (call as [string, RequestInit])
  return [url, init]
}

describe('dsh-typesafe-tool', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('registers a `typesafe_evaluate` tool with state/model/questions', async () => {
    const ctx = await setup()
    const schema = ctx.tools.schemas().find(s => s.name === 'typesafe_evaluate')
    expect(schema).toBeDefined()
    const props = (schema!.parameters as { properties?: Record<string, unknown> }).properties ?? {}
    expect(Object.keys(props).sort()).toEqual(['model', 'questions', 'state'])
    const questions = props.questions as { type: string; items?: { properties?: Record<string, unknown> } }
    expect(questions.type).toBe('array')
    const itemProps = questions.items?.properties ?? {}
    expect(Object.keys(itemProps).sort()).toEqual(['criteria', 'id', 'instructions', 'levels', 'type'])
  })

  it('posts the state and questions to /v1/systemone and returns the parsed JSON', async () => {
    const ctx = await setup()
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({ model: 'jev-1.13.0', answers: { ok: { type: 'noul', noul: 0.9 } } }),
      { status: 200 },
    ))
    vi.stubGlobal('fetch', fetchMock)

    const result = await ctx.tools.execute({
      signal: testToolSignal,
      callId: CallId('call-1'),
      name: 'typesafe_evaluate',
      arguments: { state: 'is this a test?', questions: [{ id: 'ok', type: 'noul', instructions: 'Is it?' }] },
    })
    expect(result.isError).toBe(false)
    if (result.isError) throw new Error('expected typesafe_evaluate success')
    expect(result.value).toEqual({ model: 'jev-1.13.0', answers: { ok: { type: 'noul', noul: 0.9 } } })

    const [url, init] = fetchArgs(fetchMock.mock.calls[0])
    expect(url).toBe('https://api.typesafe.ai/v1/systemone')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer test-key')
    const body = JSON.parse(init.body as string) as {
      model: string
      questions: Record<string, Record<string, unknown>>
    }
    expect(body.model).toBe('jev-latest')
    expect(body.questions).toEqual({ ok: { type: 'noul', instructions: 'Is it?' } })
  })

  it('sends score levels as a criteria array and choice criteria as an object', async () => {
    const ctx = await setup()
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await ctx.tools.execute({
      signal: testToolSignal,
      callId: CallId('call-2'),
      name: 'typesafe_evaluate',
      arguments: {
        state: 'x',
        questions: [
          { id: 'team', type: 'choice', instructions: 'team?', criteria: { a: 'one', b: 'two' } },
          { id: 'mood', type: 'score', instructions: 'mood?', levels: ['Low', 'High'] },
        ],
      },
    })
    const [, init] = fetchArgs(fetchMock.mock.calls[0])
    const body = JSON.parse(init.body as string) as { questions: Record<string, Record<string, unknown>> }
    expect(body.questions.team).toEqual({ type: 'choice', instructions: 'team?', criteria: { a: 'one', b: 'two' } })
    expect(body.questions.mood).toEqual({ type: 'score', instructions: 'mood?', criteria: ['Low', 'High'] })
  })

  it('throws on a non-2xx response', async () => {
    const ctx = await setup()
    vi.stubGlobal('fetch', vi.fn(async () => new Response('bad request', { status: 422 })))
    const result = await ctx.tools.execute({
      signal: testToolSignal,
      callId: CallId('call-3'),
      name: 'typesafe_evaluate',
      arguments: { state: 'x', questions: [{ id: 'q', type: 'noul', instructions: 'y?' }] },
    })
    expect(result.isError).toBe(true)
  })

  it('throws when no API key is resolvable', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(tool, {})
    const result = await ctx.tools.execute({
      signal: testToolSignal,
      callId: CallId('call-4'),
      name: 'typesafe_evaluate',
      arguments: { state: 'x', questions: [{ id: 'q', type: 'noul', instructions: 'y?' }] },
    })
    expect(result.isError).toBe(true)
  })

  it('unregisters the tool when its contributing fiber is disposed (HMR-safety)', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    const fiber = await ctx.plugin(tool, { apiKey: 'k' })
    expect(ctx.tools.schemas().some(s => s.name === 'typesafe_evaluate')).toBe(true)
    await fiber.dispose()
    expect(ctx.tools.schemas().some(s => s.name === 'typesafe_evaluate')).toBe(false)
  })

  it('has the namespace-plugin export shape (no stray default)', () => {
    expect('default' in tool).toBe(false)
    expect(tool.name).toBe('tool-typesafe')
    expect(tool.inject).toEqual(['tools'])

    const loader = Object.create(Loader.prototype) as Loader
    const unwrapped = loader.unwrapExports(tool) as Record<string, unknown>
    expect(unwrapped).toBe(tool)
    expect(unwrapped.name).toBe('tool-typesafe')
    expect(unwrapped.inject).toEqual(['tools'])
    expect(typeof unwrapped.apply).toBe('function')
  })
})
