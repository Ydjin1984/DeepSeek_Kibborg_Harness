/**
 * Bundled `dsh-badge` skill provider.
 *
 * @module @deepseek-ai/dsh-skill-badge
 */

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import {
  BUNDLED_SKILL_RANK,
  type SkillCandidate,
  type SkillDefinition,
  type SkillProvider,
} from '@deepseek-ai/dsh-skill'

const PROVIDER_NAME = 'dsh-badge'
const SKILL_BODY_URL = new URL('../assets/dsh-badge.md', import.meta.url)
const RESOURCE_BASE = {
  kind: 'directory',
  path: fileURLToPath(new URL('../assets/', import.meta.url)),
} as const
const INVOCATION = { modelInvocable: true, userInvocable: true } as const
const DESCRIPTION = 'Add the official “powered by dsh” badge to documents, pull requests, merge requests, and other content produced with DeepSeek Harness. Use whenever creating a pull request or merge request. Also use when the user asks for a dsh badge, powered-by-dsh attribution, or a reusable dsh badge asset or snippet.'
const LOCALIZED_DESCRIPTION = {
  zh: '将官方的「powered by dsh」徽章添加到文档、pull request、merge request 以及使用 DeepSeek Harness 制作的其他内容中。在创建 pull request 或 merge request 时使用。当用户索要 dsh 徽章、powered-by-dsh 署名或可复用的 dsh 徽章资源或片段时也使用。',
  ru: 'Добавляйте официальный значок «powered by dsh» в документы, pull request, merge request и другой контент, созданный с помощью DeepSeek Harness. Используйте при создании pull request или merge request. Также используйте, когда пользователь просит значок dsh, атрибуцию powered-by-dsh или переиспользуемый ресурс или фрагмент значка dsh.',
} as const
const CANDIDATE: SkillCandidate = {
  name: 'dsh-badge',
  description: DESCRIPTION,
  localizedDescription: LOCALIZED_DESCRIPTION,
  invocation: INVOCATION,
  provider: PROVIDER_NAME,
  source: 'bundled',
  resourceBase: RESOURCE_BASE,
  rank: BUNDLED_SKILL_RANK,
  locator: SKILL_BODY_URL,
}

const provider: SkillProvider = {
  name: PROVIDER_NAME,
  list: () => Promise.resolve([CANDIDATE]),
  async get(_candidate): Promise<SkillDefinition> {
    return {
      name: CANDIDATE.name,
      description: CANDIDATE.description,
      ...CANDIDATE.localizedDescription !== undefined
        ? { localizedDescription: CANDIDATE.localizedDescription }
        : {},
      invocation: CANDIDATE.invocation,
      provider: CANDIDATE.provider,
      source: CANDIDATE.source,
      resourceBase: RESOURCE_BASE,
      content: await readFile(SKILL_BODY_URL, 'utf8'),
    }
  },
}

/** Cordis plugin name. */
export const name = 'skill-badge'
/** Service required by the bundled provider. */
export const inject = ['skills']

/** Register the bundled `dsh-badge` provider on `ctx.skills`. */
export function apply(ctx: Context): void {
  ctx.skills.registerProvider(() => provider)
}
