/** Shared fixtures and prop builders for the Claude Code section specs. */

import { vi } from 'vitest'
import type { ManagedSkillSummaryView } from '@deepseek-ai/dsh-host-apiproxy/api'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { CcActions } from '../src/client/claude-code-api.ts'
import { en, type ClaudeCodeLocaleKey } from '../src/client/locales.ts'

/** Translate against the English dictionary, interpolating {params}. */
export const t = ((key: ClaudeCodeLocaleKey, params?: Record<string, unknown>): string => {
  const template = en[key]
  return params === undefined
    ? template
    : template.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match))
}) as TranslateNS<'settings.claudeCode'>

/** One managed skill summary row (defaults to a library skill). */
export function summary(over: Partial<ManagedSkillSummaryView> = {}): ManagedSkillSummaryView {
  return {
    name: 'cc-demo-skill',
    description: 'A converted ECC skill',
    invocation: { modelInvocable: true, userInvocable: true },
    scope: 'project',
    source: 'project-dsh',
    enabled: true,
    status: 'enabled',
    version: 'v1',
    versionsCount: 1,
    ...over,
  }
}

/** Build a fake action table; every method is a vi.fn with a benign default. */
export function fakeActions(over: Partial<CcActions> = {}): CcActions {
  const listManaged = vi.fn<CcActions['listManaged']>()
  const setEnabled = vi.fn<CcActions['setEnabled']>()

  listManaged.mockResolvedValue([summary()])
  setEnabled.mockResolvedValue(undefined)

  const actions: CcActions = { listManaged, setEnabled, ...over }
  return actions
}
