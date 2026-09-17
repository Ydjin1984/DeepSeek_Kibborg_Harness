/** Host loader entry for the browser implementation exported from `./client`. */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { setUiDebugEnabled } from '@deepseek-ai/dsh-debug-log'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import {
  UI_DEBUG_SETTINGS_NAMESPACE, UiDebugSettingsSchema, type UiDebugSettings,
} from './debug-settings.ts'

export {
  UI_DEBUG_ENABLED_FIELD, UI_DEBUG_SETTINGS_NAMESPACE, UiDebugSettingsSchema,
  decodeUiDebugSettings, type UiDebugSettings,
} from './debug-settings.ts'

/** Durable settings namespace for product-wide GUI onboarding facts. */
const ONBOARDING_SETTINGS_NAMESPACE = 'ui-onboarding'

const UI_DEBUG_NS = settingsNamespace(UI_DEBUG_SETTINGS_NAMESPACE)

interface OnboardingSettings {
  /** Last version acknowledged by the current product welcome step. */
  welcomeNoticeVersion?: string
}

const OnboardingSettingsSchema: z<OnboardingSettings> = z.object({
  welcomeNoticeVersion: z.string(),
})

/** Register the durable GUI-onboarding and UI-diagnostics sections when a settings provider exists. */
export function apply(ctx: Context): void {
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.register(
      settingsNamespace(ONBOARDING_SETTINGS_NAMESPACE),
      OnboardingSettingsSchema,
    )
    const debug = settingsCtx.settings.register(UI_DEBUG_NS, UiDebugSettingsSchema)
    const sync = (section: UiDebugSettings): void => {
      setUiDebugEnabled(section.enabled === true)
    }
    settingsCtx.effect(() => {
      sync(debug.get())
      const stop = debug.watch((next) => { sync(next) })
      return () => {
        stop()
        setUiDebugEnabled(false)
      }
    }, 'ui-settings-general: ui-debug enablement')
  })
}
