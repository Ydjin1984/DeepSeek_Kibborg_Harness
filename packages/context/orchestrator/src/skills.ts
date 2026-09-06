/**
 * Bundled `orchestrator-head` and `orchestrator-executor` runtime skills.
 *
 * Orchestrator mode is a product feature: its operating protocol must be
 * available in every project that enables the mode, not only in checkouts that
 * happen to carry `.agents/skills/orchestrator-*`. The bodies therefore ship as
 * SKILL.md assets of this package, parsed with the shared filesystem parser and
 * registered through `ctx.skills.register()` as bundled runtime skills — the
 * same seam `skill-create` uses, so the Skills Manager lists them under
 * «Встроенные» (built-in) on every project.
 *
 * @module @deepseek-ai/dsh-orchestrator/skills
 */

import { readFile } from 'node:fs/promises'
import { parseSkillSource } from '@deepseek-ai/dsh-skill-filesystem'
import type { SkillRegistration } from '@deepseek-ai/dsh-skill'

/** Stable names of the bundled orchestrator companion skills. */
export const ORCHESTRATOR_HEAD_SKILL = 'orchestrator-head'
/** Stable name of the executor-side orchestrator skill body. */
export const ORCHESTRATOR_EXECUTOR_SKILL = 'orchestrator-executor'

const HEAD_BODY_URL = new URL('../assets/orchestrator-head/SKILL.md', import.meta.url)
const EXECUTOR_BODY_URL = new URL('../assets/orchestrator-executor/SKILL.md', import.meta.url)

/**
 * Load and parse one bundled orchestrator skill body. The parse doubles as a
 * build-time-style gate: the shipped assets must pass the shared parser, and
 * each body must declare the name the prompt and the head expect.
 * @param bodyUrl - asset location of the SKILL.md body.
 * @param expectedName - kebab-case name the frontmatter must declare.
 * @returns the runtime skill registration derived from the parsed body.
 */
async function loadSkill(bodyUrl: URL, expectedName: string): Promise<SkillRegistration> {
  const raw = await readFile(bodyUrl, 'utf8')
  const parsed = parseSkillSource(raw)
  /* v8 ignore next -- the shipped asset is validated by the load test; a broken asset fails that test. */
  if (!parsed.ok) throw new Error(`bundled orchestrator skill "${expectedName}" failed the shared parser: ${parsed.reason}`)
  const skill = parsed.skill
  /* v8 ignore next -- the asset frontmatter is validated by the load test; a renamed body fails that test. */
  if (skill.name !== expectedName) throw new Error(`bundled orchestrator skill declares name "${skill.name}", expected "${expectedName}"`)
  return {
    name: skill.name,
    description: skill.description,
    /* v8 ignore start -- the shipped orchestrator assets carry no localized description, whenToUse, or metadata. */
    ...skill.localizedDescription !== undefined ? { localizedDescription: skill.localizedDescription } : {},
    ...skill.whenToUse !== undefined ? { whenToUse: skill.whenToUse } : {},
    ...skill.metadata !== undefined ? { metadata: skill.metadata } : {},
    /* v8 ignore stop */
    content: skill.content,
    source: 'bundled',
  }
}

/**
 * Load both bundled orchestrator companion skills. The head skill must stay
 * model-invocable so the head can load it through the `skill` tool after the
 * prompt section tells it to; the executor skill is its protocol companion.
 * @returns the two runtime skill registrations, head first.
 */
export async function loadOrchestratorSkills(): Promise<SkillRegistration[]> {
  return [
    await loadSkill(HEAD_BODY_URL, ORCHESTRATOR_HEAD_SKILL),
    await loadSkill(EXECUTOR_BODY_URL, ORCHESTRATOR_EXECUTOR_SKILL),
  ]
}
