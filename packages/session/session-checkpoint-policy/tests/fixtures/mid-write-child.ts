import { writeFile } from 'node:fs/promises'
import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { createUserMessage, type GenerateOptions, LlmAdapter, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import * as checkpointPolicy from '../../src/index.ts'

/**
 * Crash victim for the kill-mid-write e2e test. Two modes:
 *
 * - `queued`: no checkpoint policy; the write-behind batch delay is stretched to
 *   5s so turn/user/request events sit in the in-memory queue and are NOT on
 *   disk when the parent SIGKILLs the process. The durable log must stay
 *   loadable and appendable afterwards.
 *
 * - `flushed`: the checkpoint policy is mounted (semantic flush before model
 *   dispatch) and the batch delay is 1ms, so `request/header` reaches disk
 *   before the marker is published. Recovery must then preserve it and close
 *   the interrupted turn.
 */
function waitForCrash(): Promise<never> {
  return new Promise(() => { setInterval(() => {}, 60_000) })
}

const [mode, root, marker] = process.argv.slice(2)
if ((mode !== 'queued' && mode !== 'flushed') || root === undefined || marker === undefined) {
  throw new Error('usage: mid-write-child.ts <queued|flushed> <persistence-root> <marker>')
}
const persistenceRoot = root
const failpoint = marker

class CrashAdapter extends LlmAdapter {
  async * stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    await writeFile(failpoint, mode === 'queued' ? 'queued-appended' : 'flushed-request-dispatched')
    await waitForCrash()
  }
}

const ctx = new Context()
await mountAgentLoopTestDependencies(ctx)
await ctx.plugin(AgentLoop, { agents: [] })
await ctx.plugin(JsonlSessionPersistence, {
  root: persistenceRoot,
  compression: 'none',
  writeBatchMaxDelayMs: mode === 'queued' ? 5_000 : 1,
})
if (mode === 'flushed') {
  await ctx.plugin(checkpointPolicy)
}
ctx.llm.registerAdapter(['mid-write'], new CrashAdapter())

const handle = await ctx.agents.create({
  sessionId: SessionId('mid-write-session'),
  agentOptions: { provider: 'mid-write', model: 'mid-write' },
})
handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'exercise the mid-write boundary' }], source: { kind: 'user' } }))
await waitForCrash()
