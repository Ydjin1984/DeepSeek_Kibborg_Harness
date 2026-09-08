/**
 * REAL-composition test: the Telegram bridge boots inside a real Loader tree
 * (settings + user-questions + the bridge service), pointed at a local mock
 * Bot API server. Asserts user-visible output — the messages the bridge sends
 * to the chat — for (a) a mirrored user line and (b) the /start reply. The
 * only mocked pieces are the external Bot API HTTP surface and the session
 * event stream feeding the mirror.
 */

import { mkdtempSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import SettingsProviderFile from '@deepseek-ai/dsh-settings-file'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import { afterAll, describe, expect, it } from 'vitest'
import TelegramBridgeService from '../src/index.ts'
import type { TelegramSettings } from '../src/types.ts'

interface MockBot {
  url: string
  /** Every non-polling request the bridge made. */
  requests: { method: string; body: Record<string, unknown> }[]
  /** Queue an inbound update the next getUpdates call returns. */
  enqueue(update: unknown): void
  close(): Promise<void>
}

async function startMockBot(): Promise<MockBot> {
  const requests: MockBot['requests'] = []
  const queue: unknown[] = []
  let messageId = 1
  const server = createServer(async (req, res) => {
    let raw = ''
    for await (const chunk of req) raw += String(chunk)
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname
    const method = pathname.split('/')[2] ?? ''
    let body: Record<string, unknown> = {}
    try {
      body = JSON.parse(raw) as Record<string, unknown>
    } catch {
      // empty body
    }
    if (method !== 'getUpdates') requests.push({ method, body })
    let payload: unknown
    if (method === 'getUpdates') {
      requests.push({ method, body })
      payload = { ok: true, result: queue.splice(0) }
    } else if (method === 'sendMessage' || method === 'editMessageText') {
      payload = { ok: true, result: { message_id: messageId++ } }
    } else {
      payload = { ok: true, result: true }
    }
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify(payload))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    enqueue: (update) => { queue.push(update) },
    close: () => new Promise<void>((resolve, reject) => server.close(error => error === undefined ? resolve() : reject(error))),
  }
}

/** Poll `predicate` until it holds or the timeout elapses. */
async function waitFor(predicate: () => boolean, timeoutMs = 5000, label = 'condition'): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${label}`)
    await new Promise(resolve => setTimeout(resolve, 25))
  }
}

const disposers: (() => Promise<void>)[] = []
const mock = await startMockBot()
const dir = mkdtempSync(join(tmpdir(), 'dsh-telegram-bridge-'))

const globals = globalThis as unknown as {
  __dshMountSettings: (ctx: Context) => Promise<void>
  __dshMountQuestions: (ctx: Context) => Promise<void>
  __dshMountBridge: (ctx: Context, config: Record<string, unknown>) => Promise<void>
  __dshBridgeContext: Context | undefined
  __dshBridgeService: { attach(sessionId: string): { ok: boolean; reason?: string } } | undefined
}

afterAll(async () => {
  for (const dispose of disposers.splice(0)) await dispose()
  await mock.close()
})

/** Boot the real Loader tree: settings, user-questions, and the bridge. */
async function bootBridge(): Promise<void> {
  const bridgeFile = join(dir, 'bridge.mjs')
  const settingsFile = join(dir, 'settings.mjs')
  const questionsFile = join(dir, 'questions.mjs')
  writeFileSync(bridgeFile, `
export const name = 'telegram-bridge-fixture'
export async function apply(ctx, config) {
  await globalThis.__dshMountBridge(ctx, config)
  globalThis.__dshBridgeContext = ctx
  globalThis.__dshBridgeService = ctx.get('telegramBridge')
}
`)
  writeFileSync(settingsFile, `
export const name = 'settings-fixture'
export function apply(ctx) { return globalThis.__dshMountSettings(ctx) }
`)
  writeFileSync(questionsFile, `
export const name = 'user-questions-fixture'
export function apply(ctx) { return globalThis.__dshMountQuestions(ctx) }
`)
  const globalsRef = globalThis as unknown as typeof globals
  globalsRef.__dshMountSettings = async (ctx) => {
    await ctx.plugin(SettingsProviderFile, { path: join(dir, 'settings.yaml') })
  }
  globalsRef.__dshMountQuestions = async (ctx) => { await ctx.plugin(UserQuestionService) }
  globalsRef.__dshMountBridge = async (ctx, config) => {
    await ctx.plugin(TelegramBridgeService, config as unknown as TelegramSettings)
  }
  globalsRef.__dshBridgeContext = undefined
  globalsRef.__dshBridgeService = undefined

  writeFileSync(join(dir, 'cordis.yml'), '[]\n')
  const ctx = new Context()
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  await ctx.loader.create({
    name: 'cordis:include',
    config: {
      path: pathToFileURL(join(dir, 'cordis.yml')).href,
      patches: [{
        insert: [
          { id: 'settings', name: pathToFileURL(settingsFile).href },
          { id: 'user-questions', name: pathToFileURL(questionsFile).href },
          {
            id: 'telegram-bridge', name: pathToFileURL(bridgeFile).href,
            config: { botToken: 'test-token', chatId: '42', apiBaseUrl: mock.url },
          },
        ],
      }],
    },
  })
  await ctx.loader.await()
  disposers.push(async () => { await ctx.fiber.dispose() })
}

function sentMessages(): { text?: unknown }[] {
  return mock.requests
    .filter(request => request.method === 'sendMessage')
    .map(request => ({ text: request.body.text }))
}

function emitSessionEvent(type: string, data: unknown): void {
  const ctx = globals.__dshBridgeContext
  if (ctx === undefined) throw new Error('bridge context not booted')
  const session = { id: 's1' }
  ;(ctx as never as { emit(name: string, session: unknown, event: unknown): void })
    .emit('session/event', session, { type, seq: 1, time: Date.now(), data })
}

describe('Telegram bridge (real Loader composition)', () => {
  it('mirrors session events and answers /start through the real Bot API mock', async () => {
    await bootBridge()
    await waitFor(() => mock.requests.some(request => request.method === 'getUpdates'), 20000, 'polling start')

    // 1. Mirror a user line.
    const service = globals.__dshBridgeService
    expect(service).toBeDefined()
    const attach = service?.attach('s1')
    expect(attach?.ok).toBe(true)
    emitSessionEvent('user/message', {
      role: 'user',
      source: { kind: 'user' },
      content: [{ type: 'text', text: 'привет из теста' }],
    })
    await waitFor(() => sentMessages().some(message => message.text === '👤 привет из теста'), 8000, 'mirrored user line')

    // 2. Answer an inbound /start from the chat.
    mock.enqueue({
      update_id: 1,
      message: { message_id: 10, chat: { id: 42 }, text: '/start' },
    })
    await waitFor(() => sentMessages().some(message => typeof message.text === 'string'
      && message.text.includes('зеркало DeepSeek Harness')), 8000, '/start reply')
  })
})
