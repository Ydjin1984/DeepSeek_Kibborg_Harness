/**
 * Unit tests for the head/executor tool-policy decision.
 * @module @deepseek-ai/dsh-orchestrator/policy.spec
 */

import { describe, expect, it } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { filterHeadToolSchemas, headToolDeny } from '../src/policy.ts'

/** Agent stub whose delegation depth comes from options (as delegationDepthOf reads). */
function agentAt(depth: number): Agent {
  return {
    options: { subagentDepth: depth },
    session: { header: {} },
  } as unknown as Agent
}

describe('headToolDeny', () => {
  const deny = new Set(['pwsh', 'idat', 'nmap'])

  it('denies a listed tool to a depth-0 (head) planner', () => {
    const reason = headToolDeny(agentAt(0), 'pwsh', deny)
    expect(reason).toMatch(/denied to the head planner/)
    expect(reason).toContain('"pwsh"')
    expect(reason).toContain('executor')
  })

  it('allows an unlisted tool to the head planner', () => {
    expect(headToolDeny(agentAt(0), 'read', deny)).toBeUndefined()
  })

  it('is disabled for an empty deny set', () => {
    expect(headToolDeny(agentAt(0), 'pwsh', new Set())).toBeUndefined()
  })

  it('never restricts delegated workers (depth >= 1)', () => {
    expect(headToolDeny(agentAt(1), 'pwsh', deny)).toBeUndefined()
    expect(headToolDeny(agentAt(2), 'idat', deny)).toBeUndefined()
  })

  it('allows non-agent callers', () => {
    expect(headToolDeny(undefined, 'pwsh', deny)).toBeUndefined()
  })
})

describe('filterHeadToolSchemas', () => {
  const deny = new Set(['pwsh', 'idat'])
  const tools = [{ name: 'read' }, { name: 'pwsh' }, { name: 'skill' }]

  it('hides listed tools from a depth-0 (head) planner', () => {
    expect(filterHeadToolSchemas(agentAt(0), tools, deny).map(tool => tool.name))
      .toEqual(['read', 'skill'])
  })

  it('keeps the full list for delegated workers', () => {
    expect(filterHeadToolSchemas(agentAt(1), tools, deny)).toEqual(tools)
  })

  it('keeps the full list for non-agent assemblies', () => {
    expect(filterHeadToolSchemas(undefined, tools, deny)).toEqual(tools)
  })

  it('is a no-op for an empty deny set', () => {
    expect(filterHeadToolSchemas(agentAt(0), tools, new Set())).toEqual(tools)
  })
})
