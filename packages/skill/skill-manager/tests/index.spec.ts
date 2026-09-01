import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { apply, Config, inject, name } from '../src/index.ts'
import { registerSkillManageTool } from '../src/tool.ts'
import { SKILL_CREATE_NAME } from '../src/skill-create.ts'

describe('skill-manager plugin', () => {
  it('declares stable plugin metadata and config schema', () => {
    expect(name).toBe('skill-manager')
    expect(inject).toEqual(['skills', 'tools'])
    expect(Config).toBeDefined()
  })

  it('provides the service, registers the tool, and mounts the system skill', async () => {
    const ctx = new Context()
    const registeredSkills: Array<{ name: string }> = []
    const registeredTools: string[] = []
    let registeredTool: {
      execute: (args: Record<string, unknown>, exec: unknown) => Promise<unknown>
      presentCall: (args: Record<string, unknown>) => unknown
      output: { render: (args: Record<string, unknown>, value: unknown) => Array<{ type: 'text'; text: string }> }
    } | undefined
    ctx.provide('skills', {
      register: (skill: { name: string }) => {
        registeredSkills.push(skill)
        return () => {}
      },
      list: async () => [],
      get: async () => undefined,
    } as never)
    ctx.provide('tools', {
      register: (tool: never) => {
        registeredTools.push((tool as { name: string }).name)
        registeredTool = tool as never
      },
    } as never)
    apply(ctx, { dshHome: 'unused' })
    expect(ctx.get('skillManager')).toBeDefined()
    expect(registeredTools).toEqual(['skill_manage'])
    await vi.waitFor(() => {
      expect(registeredSkills.some(skill => skill.name === SKILL_CREATE_NAME)).toBe(true)
    })
    const systemSkill = registeredSkills.find(skill => skill.name === SKILL_CREATE_NAME)
    expect(systemSkill).toMatchObject({ name: SKILL_CREATE_NAME, source: 'bundled' })
    // Exercise the tool's execute, render, and presentCall through the mounted manager.
    const result = await registeredTool?.execute(
      { action: 'validate', content: '---\nname: x\ndescription: d\n---\n\nbody\n' },
      { agent: { session: { header: { cwd: 'cwd' } } }, signal: new AbortController().signal },
    )
    expect(result).toMatchObject({ ok: true })
    const rendered = registeredTool?.output.render({}, { ok: true, message: 'm', data: { a: 1 } })
    expect(rendered?.[0]?.text).toContain('m')
    expect(registeredTool?.presentCall({ action: 'save' })).toBeDefined()
    // Disposing the context unwinds the effect, unregistering the system skill.
    await ctx.fiber.dispose()
  })

  it('fails the tool when the manager is absent or no workspace is attached', async () => {
    // With a mounted manager but no agent workspace, the tool reports the missing cwd.
    const mounted = new Context()
    let mountedTool: { execute: (args: Record<string, unknown>, exec: unknown) => Promise<unknown> } | undefined
    mounted.provide('tools', { register: (registered: never) => { mountedTool = registered as never } } as never)
    mounted.provide('skills', { register: () => () => {}, list: async () => [], get: async () => undefined } as never)
    apply(mounted, {})
    await expect(mountedTool?.execute({ action: 'list' }, { agent: undefined, signal: new AbortController().signal }))
      .rejects.toThrow('no workspace')

    // Without a manager service, the tool reports the missing service.
    const absent = new Context()
    let absentTool: { execute: (args: Record<string, unknown>, exec: unknown) => Promise<unknown> } | undefined
    absent.provide('tools', { register: (registered: never) => { absentTool = registered as never } } as never)
    registerSkillManageTool(absent, () => undefined)
    await expect(absentTool?.execute(
      { action: 'list' },
      { agent: { session: { header: { cwd: 'cwd' } } }, signal: new AbortController().signal },
    )).rejects.toThrow('skill manager service is not mounted')
  })

  it('logs a warning when the system skill asset cannot load', async () => {
    const ctx = new Context()
    ctx.provide('skills', { register: () => () => {}, list: async () => [], get: async () => undefined } as never)
    ctx.provide('tools', { register: () => {} } as never)
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => {})
    const load = await import('../src/skill-create.ts')
    vi.spyOn(load, 'loadSkillCreate').mockRejectedValueOnce(new Error('asset missing'))
    apply(ctx, {})
    await vi.waitFor(() => {
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('failed to load the system skill'))
    })
  })
})
