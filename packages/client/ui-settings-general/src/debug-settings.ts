/** UI diagnostics preference stored in the Host user-settings document. */

import z from '@deepseek-ai/schemastery'

/** Settings namespace owned by the General diagnostics row. */
export const UI_DEBUG_SETTINGS_NAMESPACE = 'ui-debug'

/** Field carrying whether the process tracer is on. */
export const UI_DEBUG_ENABLED_FIELD = 'enabled'

/** Durable diagnostics section shared by the Host schema and the browser scope. */
export interface UiDebugSettings {
  /** When true, Host stdout and the browser console write `[dsh-debug]` timings. */
  enabled: boolean
}

/** Durable diagnostics schema; also the wire envelope the browser scope validates against. */
export const UiDebugSettingsSchema: z<UiDebugSettings> = z.object({
  [UI_DEBUG_ENABLED_FIELD]: z.boolean().default(false),
})

/**
 * Narrow one wire section to the diagnostics fields this row understands.
 * @param section - value crossing the settings boundary.
 * @returns the accepted section, or undefined when the wire value is not an object.
 */
export function decodeUiDebugSettings(section: unknown): UiDebugSettings | undefined {
  if (typeof section !== 'object' || section === null) return undefined
  return { enabled: (section as { enabled?: unknown }).enabled === true }
}
