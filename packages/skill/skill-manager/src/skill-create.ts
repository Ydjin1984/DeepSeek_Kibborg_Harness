/**
 * Bundled `skill-create` system skill: the model-facing instructions the user
 * invocation `/skill-create` injects through the existing tool-skill gesture
 * boundary. The body lives as a real SKILL.md asset, parsed with the shared
 * filesystem parser, and registered as a user-invocable runtime skill so the
 * model never discovers it on its own.
 * @module @deepseek-ai/dsh-skill-manager/skill-create
 */

import { readFile } from 'node:fs/promises'
import { parseSkillSource, type ParsedSkill } from '@deepseek-ai/dsh-skill-filesystem'

export const SKILL_CREATE_NAME = 'skill-create'
export const SKILL_CREATE_DESCRIPTION = 'Create, validate, benchmark, and improve reusable agent Skills through an interactive guided workflow. Use when the user invokes /skill-create or asks to create or improve a Skill.'

const BODY_URL = new URL('../assets/skill-create/SKILL.md', import.meta.url)

/**
 * Load and parse the bundled `skill-create` skill body. The parse doubles as a
 * build-time-style gate: the system skill must itself pass the shared parser.
 * @returns the parsed system skill body.
 */
export async function loadSkillCreate(): Promise<ParsedSkill> {
  const raw = await readFile(BODY_URL, 'utf8')
  const result = parseSkillSource(raw)
  /* v8 ignore next -- the bundled asset is validated by the load test; a broken asset fails that test. */
  if (!result.ok) throw new Error(`system skill "${SKILL_CREATE_NAME}" failed the shared parser: ${result.reason}`)
  return result.skill
}
