/**
 * Web session file attachments: the session.prompt file content part becomes
 * a model-visible text block (descriptor + optional inline content) and the
 * bytes are materialized under `<cwd>/.dsh/attachments/` so the session's
 * filesystem tools can read them. Covers the batch caps, canonical-base64
 * rejection, filename sanitization, collision dedupe, and the mixed
 * image+file ordering contract.
 */

import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AttachmentStore from '@deepseek-ai/dsh-attachment'
import LlmRuntime, { LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmModelInfo, LlmProviderInfo, StreamChunk, UserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import type { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import type { RpcRequest } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import { RpcId } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import { createApiProxy } from '../src/api-proxy.ts'
import type { PromptContentPart } from '../src/api/sessions.ts'

let nextRpc = 1
function request<P>(payload: P): RpcRequest<P> {
  return { rpcId: RpcId(`file-attach-${String(nextRpc++)}`), payload }
}

class SilentAdapter extends LlmAdapter {
  override providerInfo(provider: string): LlmProviderInfo {
    return { id: provider, name: 'Silent' }
  }

  override listModels(): Promise<readonly LlmModelInfo[]> {
    return Promise.resolve([{ provider: 'silent', id: 'model', name: 'Model' }])
  }

  override async *stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    // File-attachment tests never enter provider streaming.
  }
}

function base64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64')
}

async function harness(): Promise<{
  ctx: Context
  agent: Agent
  sessionId: SessionId
  cwd: string
}> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt, { persona: '' })
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(UserQuestionService)
  await ctx.plugin(AgentRegistry)
  ctx.llm.registerAdapter(['silent'], new SilentAdapter())
  ctx.provide('attachments', {
    imageLimits: {
      maxImageBytes: 4,
      maxImagesPerMessage: 2,
      maxMessageImageBytes: 4,
      maxImagePixels: 4,
      maxImageDimension: 2000,
      mediaTypes: ['image/png'],
    },
    validateImage: () => Promise.resolve(),
    saveImage: (input: { data: Uint8Array; mediaType: string; name?: string }) => Promise.resolve({
      attachmentId: 'att-1',
      mediaType: input.mediaType,
      bytes: input.data.byteLength,
      width: 1,
      height: 1,
      ...input.name === undefined ? {} : { name: input.name },
    }),
    saveImages(inputs: Parameters<AttachmentStore['saveImages']>[0]) {
      return AttachmentStore.prototype.saveImages.call(this, inputs)
    },
  } as never)
  const session = ctx.sessions.create()
  const agent = {
    id: session.id,
    session,
    status: 'running',
    ctx,
    inbox: { nextTurn: [], nextStep: [] },
  } as unknown as Agent
  ctx.agents.register(agent)
  const cwd = await mkdtemp(join(tmpdir(), 'dsh-file-attach-'))
  return { ctx, agent, sessionId: session.id, cwd }
}

function mount(agent: Agent): ReturnType<typeof vi.fn> {
  const followup = vi.fn()
  Object.assign(agent, { followup })
  return followup
}

async function prompt(
  api: ReturnType<typeof createApiProxy>,
  sessionId: SessionId,
  content: PromptContentPart[],
): Promise<{ result: { ok: boolean; value?: { accepted: true }; error?: { code: string; details: { reason: string } } } }> {
  return api.sessions.prompt(request({
    sessionId,
    mode: 'queue' as const,
    content,
  })) as never
}

function textBlock(content: UserMessage['content'], index: number): { type: 'text'; text: string } {
  const block = content[index]
  if (block === undefined || block.type !== 'text') throw new Error(`expected a text block at ${index}`)
  return block
}

describe('Web session file attachments', () => {
  it('materializes a text file and presents its content inline', async () => {
    const { ctx, agent, sessionId, cwd } = await harness()
    const followup = mount(agent)
    const api = createApiProxy(ctx, {
      defaultModelSelection: () => ({ provider: 'silent', model: 'model' }),
      cwd,
    })
    const bytes = new TextEncoder().encode('hello world\n')
    const result = await prompt(api, sessionId, [
      { type: 'text', text: 'read this' },
      { type: 'file', name: 'notes.txt', mediaType: 'text/plain', data: base64(bytes) },
    ])
    expect(result.result).toMatchObject({ ok: true })
    const message = followup.mock.calls[0]?.[0] as UserMessage
    expect(textBlock(message.content, 0).text).toBe('read this')
    expect(textBlock(message.content, 1).text).toBe(
      `Attached file: notes.txt (text/plain, 12 bytes)\nPath: ${join(cwd, '.dsh', 'attachments', 'notes.txt')}\nContent:\nhello world\n`,
    )
    await expect(readFile(join(cwd, '.dsh', 'attachments', 'notes.txt'))).resolves.toEqual(Buffer.from(bytes))
    await rm(cwd, { recursive: true, force: true })
    await ctx.fiber.dispose()
  })

  it('addresses binary files by path alone', async () => {
    const { ctx, agent, sessionId, cwd } = await harness()
    const followup = mount(agent)
    const api = createApiProxy(ctx, {
      defaultModelSelection: () => ({ provider: 'silent', model: 'model' }),
      cwd,
    })
    const bytes = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)
    const result = await prompt(api, sessionId, [
      { type: 'file', name: 'blob.bin', mediaType: 'application/octet-stream', data: base64(bytes) },
    ])
    expect(result.result).toMatchObject({ ok: true })
    const message = followup.mock.calls[0]?.[0] as UserMessage
    expect(textBlock(message.content, 0).text).toBe(
      `Attached file: blob.bin (application/octet-stream, 8 bytes)\nPath: ${join(cwd, '.dsh', 'attachments', 'blob.bin')}`,
    )
    await rm(cwd, { recursive: true, force: true })
    await ctx.fiber.dispose()
  })

  it('preserves message order across text, image, and file parts', async () => {
    const { ctx, agent, sessionId, cwd } = await harness()
    const followup = mount(agent)
    const api = createApiProxy(ctx, {
      defaultModelSelection: () => ({ provider: 'silent', model: 'model' }),
      cwd,
    })
    const textBytes = new TextEncoder().encode('abc')
    const result = await prompt(api, sessionId, [
      { type: 'file', name: 'a.txt', mediaType: 'text/plain', data: base64(textBytes) },
      { type: 'text', text: 'middle' },
      { type: 'image', mediaType: 'image/png', data: 'AQ==' },
      { type: 'file', name: 'b.txt', mediaType: 'text/plain', data: base64(textBytes) },
    ])
    expect(result.result).toMatchObject({ ok: true })
    const message = followup.mock.calls[0]?.[0] as UserMessage
    expect(message.content.map(block => block.type)).toEqual(['text', 'text', 'image', 'text'])
    expect(textBlock(message.content, 0).text).toContain('a.txt')
    expect(textBlock(message.content, 1).text).toBe('middle')
    expect(message.content[2]).toMatchObject({ type: 'image', attachment: { attachmentId: 'att-1' } })
    expect(textBlock(message.content, 3).text).toContain('b.txt')
    await rm(cwd, { recursive: true, force: true })
    await ctx.fiber.dispose()
  })

  it('sanitizes path components and dedupes colliding names', async () => {
    const { ctx, agent, sessionId, cwd } = await harness()
    const followup = mount(agent)
    const api = createApiProxy(ctx, {
      defaultModelSelection: () => ({ provider: 'silent', model: 'model' }),
      cwd,
    })
    const bytes = new TextEncoder().encode('x')
    const result = await prompt(api, sessionId, [
      { type: 'file', name: '../../evil.txt', mediaType: 'text/plain', data: base64(bytes) },
      { type: 'file', name: 'notes.txt', mediaType: 'text/plain', data: base64(bytes) },
      { type: 'file', name: 'notes.txt', mediaType: 'text/plain', data: base64(bytes) },
    ])
    expect(result.result).toMatchObject({ ok: true })
    const message = followup.mock.calls[0]?.[0] as UserMessage
    expect(textBlock(message.content, 0).text).toContain(join(cwd, '.dsh', 'attachments', 'evil.txt'))
    expect(textBlock(message.content, 1).text).toContain(join(cwd, '.dsh', 'attachments', 'notes.txt'))
    expect(textBlock(message.content, 2).text).toContain(join(cwd, '.dsh', 'attachments', 'notes-1.txt'))
    const files = await readdir(join(cwd, '.dsh', 'attachments'))
    expect(files.sort()).toEqual(['evil.txt', 'notes-1.txt', 'notes.txt'])
    await rm(cwd, { recursive: true, force: true })
    await ctx.fiber.dispose()
  })

  it('cites an in-project path without copying under attachments', async () => {
    const { ctx, agent, sessionId, cwd } = await harness()
    const followup = mount(agent)
    const api = createApiProxy(ctx, {
      defaultModelSelection: () => ({ provider: 'silent', model: 'model' }),
      cwd,
    })
    const source = join(cwd, 'docs', 'note.md')
    await mkdir(join(cwd, 'docs'))
    const bytes = new TextEncoder().encode('# Note\n')
    await writeFile(source, bytes)
    const result = await prompt(api, sessionId, [
      { type: 'file', name: 'note.md', mediaType: 'text/markdown', data: base64(bytes), path: source },
    ])
    expect(result.result).toMatchObject({ ok: true })
    const message = followup.mock.calls[0]?.[0] as UserMessage
    expect(textBlock(message.content, 0).text).toContain(`Path: ${source}`)
    expect(textBlock(message.content, 0).text).not.toContain('.dsh')
    await expect(readdir(join(cwd, '.dsh', 'attachments')).catch(() => [])).resolves.toEqual([])
    await rm(cwd, { recursive: true, force: true })
    await ctx.fiber.dispose()
  })

  it('ignores an out-of-project path and materializes a copy', async () => {
    const { ctx, agent, sessionId, cwd } = await harness()
    const followup = mount(agent)
    const api = createApiProxy(ctx, {
      defaultModelSelection: () => ({ provider: 'silent', model: 'model' }),
      cwd,
    })
    const outside = await mkdtemp(join(tmpdir(), 'dsh-file-outside-'))
    const bytes = new TextEncoder().encode('secret')
    const result = await prompt(api, sessionId, [
      {
        type: 'file',
        name: 'secret.txt',
        mediaType: 'text/plain',
        data: base64(bytes),
        path: join(outside, 'secret.txt'),
      },
    ])
    expect(result.result).toMatchObject({ ok: true })
    const message = followup.mock.calls[0]?.[0] as UserMessage
    expect(textBlock(message.content, 0).text).toContain(join(cwd, '.dsh', 'attachments', 'secret.txt'))
    await rm(outside, { recursive: true, force: true })
    await rm(cwd, { recursive: true, force: true })
    await ctx.fiber.dispose()
  })

  it('refuses non-canonical base64 with a file-specific reason', async () => {
    const { ctx, agent, sessionId, cwd } = await harness()
    mount(agent)
    const api = createApiProxy(ctx, {
      defaultModelSelection: () => ({ provider: 'silent', model: 'model' }),
      cwd,
    })
    const result = await prompt(api, sessionId, [
      { type: 'file', name: 'x.bin', mediaType: 'application/octet-stream', data: 'not-base64!!' },
    ])
    expect(result.result).toMatchObject({
      ok: false,
      error: { code: 'attachment-error', details: { reason: 'INVALID_FILE_BASE64' } },
    })
    await expect(readdir(join(cwd, '.dsh', 'attachments'))).rejects.toThrow()
    await rm(cwd, { recursive: true, force: true })
    await ctx.fiber.dispose()
  })

  it('refuses a batch over the per-message file count', async () => {
    const { ctx, agent, sessionId, cwd } = await harness()
    mount(agent)
    const api = createApiProxy(ctx, {
      defaultModelSelection: () => ({ provider: 'silent', model: 'model' }),
      cwd,
    })
    const result = await prompt(api, sessionId, Array.from({ length: 21 }, (_, index) => ({
      type: 'file' as const,
      name: `f${index}.txt`,
      mediaType: 'text/plain',
      data: 'eA==',
    })))
    expect(result.result).toMatchObject({
      ok: false,
      error: { code: 'attachment-error', details: { reason: 'TOO_MANY_FILES' } },
    })
    await rm(cwd, { recursive: true, force: true })
    await ctx.fiber.dispose()
  })

  it('refuses one file over the per-file byte bound', async () => {
    const { ctx, agent, sessionId, cwd } = await harness()
    mount(agent)
    const api = createApiProxy(ctx, {
      defaultModelSelection: () => ({ provider: 'silent', model: 'model' }),
      cwd,
    })
    const over = new Uint8Array(25 * 1024 * 1024 + 1)
    const result = await prompt(api, sessionId, [
      { type: 'file', name: 'big.bin', mediaType: 'application/octet-stream', data: base64(over) },
    ])
    expect(result.result).toMatchObject({
      ok: false,
      error: { code: 'attachment-error', details: { reason: 'FILE_TOO_LARGE' } },
    })
    await rm(cwd, { recursive: true, force: true })
    await ctx.fiber.dispose()
  }, 30000)

  it('refuses a batch over the aggregate file byte bound', async () => {
    const { ctx, agent, sessionId, cwd } = await harness()
    mount(agent)
    const api = createApiProxy(ctx, {
      defaultModelSelection: () => ({ provider: 'silent', model: 'model' }),
      cwd,
    })
    const chunk = new Uint8Array(25 * 1024 * 1024)
    const parts = Array.from({ length: 4 }, (_, index) => ({
      type: 'file' as const,
      name: `f${index}.bin`,
      mediaType: 'application/octet-stream',
      data: base64(chunk),
    }))
    parts.push({ type: 'file', name: 'extra.bin', mediaType: 'application/octet-stream', data: 'eA==' })
    const result = await prompt(api, sessionId, parts)
    expect(result.result).toMatchObject({
      ok: false,
      error: { code: 'attachment-error', details: { reason: 'FILES_TOO_LARGE' } },
    })
    await rm(cwd, { recursive: true, force: true })
    await ctx.fiber.dispose()
  }, 30000)
})
