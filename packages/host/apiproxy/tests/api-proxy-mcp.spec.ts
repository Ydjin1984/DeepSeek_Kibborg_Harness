/**
 * The mcp domain answers over the registry service the Host provides: list
 * reports declared servers (empty when the deployment composes no registry),
 * save persists and deploys one user-registry server, and remove undeploys
 * it. The registry itself is faked here; the real registry deployment is
 * covered by the real-composition test in `packages/mcp/mcp-servers`.
 */

import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import SessionStore, { type Session } from '@deepseek-ai/dsh-session'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import { RpcId, type RpcRequest } from '../src/api/rpc.ts'
import type { McpServerEntryView, McpServerView } from '../src/api/mcp.ts'
import { createApiProxy } from '../src/api-proxy.ts'
import { describe, expect, it } from 'vitest'

let nextRpc = 0
function request<P>(payload: P): RpcRequest<P> {
  return { rpcId: RpcId(`mcp-${String(nextRpc++)}`), payload }
}

function stubAgent(session: Session): Agent {
  return { id: session.id, session, status: 'idle' } as unknown as Agent
}

interface FakeServerRecord {
  name: string
  entry: McpServerEntryView
}

function fakeRegistry(records: Map<string, FakeServerRecord>) {
  const viewOf = (record: FakeServerRecord): McpServerView => ({
    name: record.name,
    source: 'user',
    kind: record.entry.url !== undefined ? 'streamable-http' : 'stdio',
    enabled: record.entry.enabled !== false,
    ...record.entry.url === undefined ? { command: record.entry.command ?? '' } : { url: record.entry.url },
    state: 'connected',
    toolCount: 1,
  })
  return {
    list: () => [...records.values()].map(viewOf),
    saveUserServer: async (name: string, entry: McpServerEntryView) => {
      if (!/^[A-Za-z0-9_-]{1,32}$/.test(name)) throw new Error(`invalid server name "${name}"`)
      records.set(name, { name, entry })
      return viewOf({ name, entry })
    },
    removeUserServer: async (name: string) => {
      if (!records.delete(name)) throw new Error(`server "${name}" is not declared`)
    },
  }
}

async function harness() {
  const cwd = mkdtempSync(join(tmpdir(), 'dsh-mcp-api-'))
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(UserQuestionService)
  ctx.provide('sessionPersistence', { list: () => Promise.resolve([]) } as never)
  ctx.agents.setFactory({
    async createAgent(_ownerCtx, options) {
      const session = ctx.sessions.create(options.sessionId, {})
      const agent = stubAgent(session)
      const agentCtx = ctx.extend({ agent })
      ;(agent as { ctx?: Context }).ctx = agentCtx
      const unregister = ctx.agents.register(agent)
      return { agent, dispose: () => { unregister(); return Promise.resolve() } }
    },
    async resume() {
      throw new Error('test harness has no persisted sessions')
    },
  })
  const api = createApiProxy(ctx, { defaultModelSelection: () => ({ provider: 'test', model: 'test-model' }), cwd })
  return { ctx, api }
}

describe('mcp domain', () => {
  it('answers an empty list when the deployment composes no registry', async () => {
    const { api } = await harness()
    const response = await api.mcp.list(request({}))
    expect(response.result.ok).toBe(true)
    if (response.result.ok) expect(response.result.value.servers).toEqual([])
  })

  it('lists, saves, and removes user-registry servers', async () => {
    const { ctx, api } = await harness()
    const records = new Map<string, FakeServerRecord>()
    ctx.provide('mcpServers', fakeRegistry(records) as never)

    const save = await api.mcp.save(request({ name: 'demo', entry: { command: 'node', args: ['run'] } }))
    expect(save.result.ok).toBe(true)
    if (save.result.ok) {
      expect(save.result.value.server).toMatchObject({ name: 'demo', source: 'user', kind: 'stdio', state: 'connected', toolCount: 1 })
    }

    const listed = await api.mcp.list(request({}))
    expect(listed.result.ok).toBe(true)
    if (listed.result.ok) {
      expect(listed.result.value.servers).toHaveLength(1)
      expect(listed.result.value.servers[0]?.name).toBe('demo')
    }

    const removed = await api.mcp.remove(request({ name: 'demo' }))
    expect(removed.result.ok).toBe(true)
    const after = await api.mcp.list(request({}))
    if (after.result.ok) expect(after.result.value.servers).toEqual([])
  })

  it('reports registry failures as domain errors', async () => {
    const { ctx, api } = await harness()
    const records = new Map<string, FakeServerRecord>()
    ctx.provide('mcpServers', fakeRegistry(records) as never)

    const removeMissing = await api.mcp.remove(request({ name: 'ghost' }))
    expect(removeMissing.result.ok).toBe(false)
    if (!removeMissing.result.ok) {
      expect(removeMissing.result.error.code).toBe('mcp-server-remove-failed')
    }

    const failSave = await api.mcp.save(request({ name: 'bad name!', entry: { command: 'node' } }))
    expect(failSave.result.ok).toBe(false)
  })
})
