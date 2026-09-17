/**
 * OpenRouter free-model pool plugin. The package's whole public surface is its
 * service class plus the schema and pure readers a configuration surface or a
 * consumer needs; the service itself is the plugin's default export.
 *
 * @module @deepseek-ai/dsh-llm-openrouter-free
 */

export {
  Config,
  FREE_MODELS_TOOL,
  LLM_SETTINGS_NS,
  OpenRouterFreePool,
  SETTINGS_NS,
  assertServiceable,
  settingsOf,
} from './service.ts'
export {
  applyOutcome, dayKey, emptyUsage, hasCapacity, isFreeEntry, minuteKey, nextUtcMidnight,
  parseFreeModels, requestsRemaining, reserveRequest, rollUsage, selectModel, stateOf, tokensRemaining,
} from './service.ts'
export type {
  FreeModelEntry,
  FreeModelLease,
  FreeModelsToolRow,
  FreeModelsToolValue,
  FreePoolSnapshot,
  LeaseOutcome,
  ModelState,
  ModelUsage,
  OpenRouterFreeConfig,
  OpenRouterFreeSettings,
  OpenRouterFreeStatusRow,
  PooledModel,
  PublishedRouteModel,
  PublishedRouteProfile,
} from './service.ts'
export { OpenRouterFreePool as default } from './service.ts'
