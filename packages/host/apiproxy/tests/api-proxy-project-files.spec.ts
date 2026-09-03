/**
 * The project file-tree surface of the gateway: session-addressed
 * listChildren / readTextFile / writeTextFile over a scratch project,
 * including the containment rejection for paths outside the session cwd.
 */

import { mkdtempSync, realpathSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import { RpcId, type RpcRequest } from '../src/api/rpc.ts'
import { createApiProxy } from '../src/api-proxy.ts'
import { afterEach, describe, expect, it } from 'vitest'

let nextRpc = 0
function request<P>(payload: P): RpcRequest<P> {
  return { rpcId: RpcId(`file-${String(nextRpc++)}`), payload }
}

const SIGNAL = new AbortController().signal

describe('project file-tree gateway surface', () => {
  let project: string
  let ctx: Context | undefined

  afterEach(async () => {
    await ctx?.fiber.dispose()
    ctx = undefined
    if (project !== undefined) await rm(project, { recursive: true, force: true })
  })

  async function harness(): Promise<ReturnType<typeof createApiProxy>> {
    project = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-apiproxy-files-')))
    ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(UserQuestionService)
    ctx.sessions.create(SessionId('s1'), { meta: { cwd: project } })
    return createApiProxy(ctx, {
      defaultModelSelection: () => ({ provider: 'test', model: 'test-model' }),
      cwd: project,
    })
  }

  it('lists children, reads, and writes project text files', async () => {
    const api = await harness()
    await writeFile(join(project, 'README.md'), '# Hi\n')
    await mkdir(join(project, 'docs'))

    const listed = await api.host.listChildren(request({ sessionId: SessionId('s1'), path: project }), SIGNAL)
    expect(listed.result.ok).toBe(true)
    if (!listed.result.ok) throw new Error('unreachable')
    expect(listed.result.value.entries.map(entry => entry.name)).toEqual(['docs', 'README.md'])
    expect(listed.result.value.entries[0]).toMatchObject({ kind: 'directory' })
    expect(listed.result.value.entries[1]).toMatchObject({ kind: 'file' })

    const read = await api.host.readTextFile(request({ sessionId: SessionId('s1'), path: join(project, 'README.md') }), SIGNAL)
    expect(read.result.ok).toBe(true)
    if (!read.result.ok) throw new Error('unreachable')
    expect(read.result.value.text).toBe('# Hi\n')

    const written = await api.host.writeTextFile(request({
      sessionId: SessionId('s1'),
      path: join(project, 'docs', 'note.md'),
      text: '# Note\n',
    }))
    expect(written.result.ok).toBe(true)
    const reread = await api.host.readTextFile(request({ sessionId: SessionId('s1'), path: join(project, 'docs', 'note.md') }), SIGNAL)
    if (!reread.result.ok) throw new Error('unreachable')
    expect(reread.result.value.text).toBe('# Note\n')
  })

  it('rejects a path outside the session project with the wire code', async () => {
    const api = await harness()
    const outside = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-outside-api-')))
    const read = await api.host.readTextFile(request({ sessionId: SessionId('s1'), path: join(outside, 'x.md') }), SIGNAL)
    expect(read.result.ok).toBe(false)
    if (read.result.ok) throw new Error('unreachable')
    expect(read.result.error.code).toBe('file-outside-project')
    expect(read.result.error.details).toMatchObject({ path: join(outside, 'x.md') })
    await rm(outside, { recursive: true, force: true })
  })

  it('rejects unknown and cwd-less sessions', async () => {
    const api = await harness()
    const unknown = await api.host.listChildren(request({ sessionId: SessionId('ghost'), path: project }), SIGNAL)
    expect(unknown.result.ok).toBe(false)
    if (unknown.result.ok) throw new Error('unreachable')
    expect(unknown.result.error.code).toBe('session-not-found')

    ctx!.sessions.create(SessionId('cold'), {})
    const cold = await api.host.listChildren(request({ sessionId: SessionId('cold'), path: project }), SIGNAL)
    expect(cold.result.ok).toBe(false)
    if (cold.result.ok) throw new Error('unreachable')
    expect(cold.result.error.code).toBe('internal')
  })
})
