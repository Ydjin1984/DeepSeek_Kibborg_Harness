import { describe, expect, it, vi } from 'vitest'
import type {
  ManagedSkillSummaryView, RpcResponse, SecurityVerdictView,
} from '@deepseek-ai/dsh-host-apiproxy/api'
import type { RpcId } from '@deepseek-ai/dsh-client-connection/client'
import { createSkillsActions, SkillApiError } from '../src/client/skills-api.ts'

const rpcId = 'rpc-1' as unknown as RpcId

function ok<T>(value: T): RpcResponse<T> {
  return { rpcId, result: { ok: true, value } }
}

function fail(code: string, message: string, details: Record<string, unknown> = {}): RpcResponse<never> {
  return { rpcId, result: { ok: false, error: { code, message, details } as never } }
}

const SUMMARY: ManagedSkillSummaryView = {
  name: 'demo-skill',
  description: 'A demo skill',
  invocation: { modelInvocable: true, userInvocable: true },
  scope: 'user',
  source: 'user',
  enabled: true,
  status: 'enabled',
  version: 'v1',
  versionsCount: 1,
}

const VERDICT: SecurityVerdictView = { status: 'valid', findings: [] }

function bench() {
  const skills = {
    listManaged: vi.fn(),
    trash: vi.fn(),
    read: vi.fn(),
    save: vi.fn(),
    remove: vi.fn(),
    restore: vi.fn(),
    permanentDelete: vi.fn(),
    setEnabled: vi.fn(),
    versions: vi.fn(),
    rollback: vi.fn(),
    validate: vi.fn(),
    securityCheck: vi.fn(),
    benchmarkStart: vi.fn(),
    benchmarkPoll: vi.fn(),
    benchmarkCancel: vi.fn(),
    benchmarkBatchStart: vi.fn(),
    autoImprove: vi.fn(),
  }
  const llm = { models: vi.fn() }
  const api = { skills, llm } as never
  return { skills, llm, actions: createSkillsActions(api) }
}

describe('createSkillsActions', () => {
  it('unwraps every success value', async () => {
    const { skills, llm, actions } = bench()
    skills.listManaged.mockResolvedValue(ok({ skills: [SUMMARY] }))
    skills.trash.mockResolvedValue(ok({ entries: [] }))
    skills.read.mockResolvedValue(ok({ skill: undefined }))
    skills.save.mockResolvedValue(ok({
      result: { name: 'demo-skill', scope: 'user', path: '/p', created: true, version: 'v1', security: VERDICT },
    }))
    skills.remove.mockResolvedValue(ok({}))
    skills.restore.mockResolvedValue(ok({}))
    skills.permanentDelete.mockResolvedValue(ok({}))
    skills.setEnabled.mockResolvedValue(ok({}))
    skills.versions.mockResolvedValue(ok({ versions: [] }))
    skills.rollback.mockResolvedValue(ok({ activeVersion: 'v2' }))
    skills.validate.mockResolvedValue(ok({ ok: true }))
    skills.securityCheck.mockResolvedValue(ok(VERDICT))
    skills.benchmarkStart.mockResolvedValue(ok({ run: { id: 'r1' } }))
    skills.benchmarkPoll.mockResolvedValue(ok({ run: { id: 'r1' } }))
    skills.benchmarkCancel.mockResolvedValue(ok({ run: { id: 'r1' } }))
    skills.benchmarkBatchStart.mockResolvedValue(ok({ runs: [{ id: 'b1' }, { id: 'b2' }] }))
    llm.models.mockResolvedValue(ok({ groups: [], failures: [] }))

    await expect(actions.listManaged('s' as never)).resolves.toEqual([SUMMARY])
    await expect(actions.trash('s' as never)).resolves.toEqual([])
    await expect(actions.read('s' as never, 'demo-skill')).resolves.toBeUndefined()
    await expect(actions.save({
      sessionId: 's' as never, name: 'demo-skill', content: 'body', scope: 'user',
    })).resolves.toMatchObject({ created: true })
    await expect(actions.remove('s' as never, 'demo-skill')).resolves.toBeUndefined()
    await expect(actions.restore('s' as never, 'demo-skill')).resolves.toBeUndefined()
    await expect(actions.permanentDelete('s' as never, 'demo-skill')).resolves.toBeUndefined()
    await expect(actions.setEnabled('s' as never, 'demo-skill', false)).resolves.toBeUndefined()
    await expect(actions.versions('s' as never, 'demo-skill')).resolves.toEqual([])
    await expect(actions.rollback('s' as never, 'demo-skill', 'v1')).resolves.toBe('v2')
    await expect(actions.validate('body')).resolves.toEqual({ ok: true })
    await expect(actions.securityCheck('body')).resolves.toEqual(VERDICT)
    await expect(actions.benchmarkStart({
      sessionId: 's' as never, name: 'demo-skill', taskModel: { provider: 'deepseek', model: 'x' },
    })).resolves.toEqual({ id: 'r1' })
    await expect(actions.benchmarkPoll('r1')).resolves.toEqual({ id: 'r1' })
    await expect(actions.benchmarkCancel('r1')).resolves.toEqual({ id: 'r1' })
    await expect(actions.benchmarkBatchStart({
      sessionId: 's' as never, names: ['a', 'b'], taskModel: { provider: 'deepseek', model: 'x' },
    })).resolves.toEqual([{ id: 'b1' }, { id: 'b2' }])
    await expect(actions.listModels()).resolves.toEqual([])
  })

  it('throws SkillApiError with the manager code when the host wraps it', async () => {
    const { skills, actions } = bench()
    skills.save.mockResolvedValue(fail('skill-manager-error', 'already exists', { code: 'skill-conflict' }))

    await expect(actions.save({
      sessionId: 's' as never, name: 'demo-skill', content: 'body', scope: 'user',
    })).rejects.toMatchObject({ name: 'SkillApiError', code: 'skill-conflict', message: 'already exists' })
  })

  it('throws SkillApiError with the RPC code when no manager code is wrapped', async () => {
    const { skills, actions } = bench()
    skills.setEnabled.mockResolvedValue(fail('session-not-found', 'no session', { sessionId: 's' }))

    await expect(actions.setEnabled('s' as never, 'demo-skill', true)).rejects
      .toMatchObject({ name: 'SkillApiError', code: 'session-not-found' })
  })

  it('throws SkillApiError for an internal failure with empty details', async () => {
    const { llm, actions } = bench()
    llm.models.mockResolvedValue(fail('internal', 'boom'))

    await expect(actions.listModels()).rejects.toMatchObject({ code: 'internal', message: 'boom' })
  })
})

describe('SkillApiError', () => {
  it('carries its routed code and message', () => {
    const error = new SkillApiError('skill-blocked', 'blocked')
    expect(error.code).toBe('skill-blocked')
    expect(error.message).toBe('blocked')
    expect(error.name).toBe('SkillApiError')
    expect(error).toBeInstanceOf(Error)
  })
})
