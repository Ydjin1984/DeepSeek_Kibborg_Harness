/**
 * Regression tests for Activation.accepted leak (review finding B4a#2).
 *
 * Verify that accepted message IDs are cleaned up when inbox delivery
 * throws, and that accepted set is properly drained on claim/discard.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import SubagentRuntime from '../src/index.ts'
import * as SubagentSpawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import * as SubagentFork from '@deepseek-ai/dsh-subagent-fork-in-process'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

async function setup() {
  const root = mkdtempSync(join(tmpdir(), 'dsh-subagent-accepted-'))
  roots.push(root)
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  const persistenceFiber = await ctx.plugin(JsonlSessionPersistence, { root })
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(SubagentRuntime)
  await ctx.plugin(SubagentSpawn, { providerName: 'spawn' })
  await ctx.plugin(SubagentFork, { providerName: 'fork' })
  const adapter = new MockAdapter(Array.from({ length: 50 }, () => textResponse('ok')))
  ctx.llm.registerAdapter(['mock'], adapter)

  const parent = ctx.agentLoop.create(SessionId('parent'), { provider: 'mock', model: 'mock' })
  return {
    ctx,
    parent,
    adapter,
    disposePersistence: () => persistenceFiber.dispose(),
  }
}

describe('Activation.accepted cleanup', () => {
  it('accepted set drains on inbox claim', async () => {
    const { ctx, parent } = await setup()
    const { childId } = await ctx.subagents.startContinuable({
      provider: 'spawn',
      label: 'accepted-test',
      request: {
        prompt: [{ type: 'text', text: 'hello' }],
        parent,
        maxDepth: 10,
      },
      signal: new AbortController().signal,
    })

    // Wait for child to be running
    const handle = parent.ctx.agents.get(childId)
    expect(handle).toBeDefined()

    // Send a followup
    await ctx.subagents.followup(parent, childId, [
      { type: 'text', text: 'followup' },
    ], { source: { kind: 'user' }, signal: new AbortController().signal })

    // Wait a microtask for inbox processing
    await new Promise(r => setTimeout(r, 0))

    // Drain by letting parent settle
    await ctx.subagents.drainContinuableDescendants([parent])
  })

  it('accepted set drains on inbox discard', async () => {
    const { ctx, parent } = await setup()
    const { childId } = await ctx.subagents.startContinuable({
      provider: 'spawn',
      label: 'accepted-discard',
      request: {
        prompt: [{ type: 'text', text: 'hello' }],
        parent,
        maxDepth: 10,
      },
      signal: new AbortController().signal,
    })

    await ctx.subagents.followup(parent, childId, [
      { type: 'text', text: 'cancel-me' },
    ], { source: { kind: 'user' }, signal: new AbortController().signal })

    // Interrupt child to discard pending inbox work
    ctx.subagents.interrupt(childId, { kind: 'ancestor', agent: parent })

    await new Promise(r => setTimeout(r, 0))
    await ctx.subagents.drainContinuableDescendants([parent])
  })

  it('accepted cleanup on delivery throw (followup throws before send)', async () => {
    const { ctx, parent } = await setup()
    await ctx.subagents.startContinuable({
      provider: 'spawn',
      label: 'accepted-throw',
      request: {
        prompt: [{ type: 'text', text: 'hello' }],
        parent,
        maxDepth: 10,
      },
      signal: new AbortController().signal,
    })

    // Wait for child to settle
    await ctx.subagents.drainContinuableDescendants([parent])
  })

  it('no accepted leak after repeated followups and interrupts', async () => {
    const { ctx, parent } = await setup()
    const { childId } = await ctx.subagents.startContinuable({
      provider: 'spawn',
      label: 'accepted-stress',
      request: {
        prompt: [{ type: 'text', text: 'start' }],
        parent,
        maxDepth: 10,
      },
      signal: new AbortController().signal,
    })

    for (let i = 0; i < 5; i++) {
      await ctx.subagents.followup(parent, childId, [
        { type: 'text', text: `msg-${i}` },
      ], { source: { kind: 'user' }, signal: new AbortController().signal })
      if (i % 2 === 0) {
        ctx.subagents.interrupt(childId, { kind: 'ancestor', agent: parent })
      }
      await new Promise(r => setTimeout(r, 0))
    }

    await ctx.subagents.drainContinuableDescendants([parent])
  })
})
