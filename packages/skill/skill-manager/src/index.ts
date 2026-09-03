/**
 * Skill lifecycle manager plugin: provides `ctx.skillManager`, the
 * model-facing `skill_manage` tool, and the bundled `skill-create` system
 * skill. The service owns filesystem CRUD, trash, version history, rollback,
 * enable/disable, validation, security classification, and background
 * benchmark runs over the same roots the filesystem provider discovers.
 *
 * @module @deepseek-ai/dsh-skill-manager
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type Schema from '@deepseek-ai/schemastery'
import { SkillManager } from './manager.ts'
import type { SkillManagerConfig } from './manager.ts'
import { loadSkillCreate } from './skill-create.ts'
import { registerSkillManageTool } from './tool.ts'

export { SkillManager } from './manager.ts'
export { SkillManagerError } from './manager.ts'
export type { SkillRootInfo } from './manager.ts'
export { securityCheck } from './security.ts'
export { adaptiveCaseCount, runAutoImprove, runBenchmark } from './benchmark.ts'
export type { BenchmarkProgress } from './benchmark.ts'
export { SKILL_CREATE_NAME, loadSkillCreate } from './skill-create.ts'
export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    skillManager: SkillManager
  }
}

/** Stable Cordis plugin name. */
export const name = 'skill-manager'
/** Services required by the plugin body. */
export const inject = ['skills', 'tools']

/** Skill manager plugin configuration. */
export const Config: Schema<SkillManagerConfig> = z.object({
  dshHome: z.string(),
  agentsHome: z.string(),
})

/**
 * Mount the skill manager service, the `skill_manage` tool, and the bundled
 * `skill-create` system skill.
 * @param ctx - context carrying the skill registry and tools registry.
 * @param config - optional home overrides.
 */
export function apply(ctx: Context, config: SkillManagerConfig = {}): void {
  // The Service constructor registers `ctx.skillManager`.
  new SkillManager(ctx, config)
  registerSkillManageTool(ctx, () => ctx.get('skillManager'))
  ctx.effect(() => {
    const disposers: Array<() => void> = []
    let disposed = false
    void loadSkillCreate().then((parsed) => {
      // A fiber teardown (HMR) that lands before the async load resolves must
      // not register the skill onto a dead scope.
      // v8 ignore next -- the dispose-race arm needs a teardown before the microtask, which specs cannot schedule deterministically.
      if (disposed) return
      disposers.push(ctx.skills.register({
        name: parsed.name,
        description: parsed.description,
        /* v8 ignore start -- the bundled skill always carries its localized description, metadata, and no whenToUse. */
        ...parsed.localizedDescription !== undefined ? { localizedDescription: parsed.localizedDescription } : {},
        ...parsed.whenToUse !== undefined ? { whenToUse: parsed.whenToUse } : {},
        content: parsed.content,
        ...parsed.metadata !== undefined ? { metadata: parsed.metadata } : {},
        /* v8 ignore stop */
        invocation: { modelInvocable: false, userInvocable: true },
        source: 'bundled',
      }))
    }).catch((error: unknown) => {
      ctx.logger.warn(`skill-manager: failed to load the system skill: ${String(error)}`)
    })
    return () => {
      disposed = true
      for (const dispose of disposers.splice(0)) dispose()
    }
  }, 'skill-manager: bundled system skill')
}
