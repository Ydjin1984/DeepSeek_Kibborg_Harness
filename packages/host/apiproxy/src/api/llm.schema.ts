/**
 * llm domain zod schemas (names derived from map keys: llmProvidersRequestSchema /
 * llmProvidersValueSchema / llmModelsRequestSchema / llmModelsValueSchema).
 */

import { z } from 'zod'
import type { RequestPayload, ResponseValue } from './rpc-map.ts'
import type { Wire } from './rpc.schema.ts'
import type { ConfigurableProviderView, DiscoveredModelView, OAuthDeviceChallengeView } from './llm.ts'
import { modelCatalogFailureSchema, modelProviderGroupSchema } from './sessions.schema.ts'

/** ConfigurableProviderView row of llm.providers. */
export const configurableProviderViewSchema = z.object({
  provider: z.string().min(1),
  displayName: z.string().min(1),
  settingsNs: z.string(),
  settingsPath: z.array(z.string()),
  active: z.boolean(),
  declared: z.boolean().optional(),
  oauth: z.object({
    loginLabel: z.string().min(1),
    credentialRef: z.string().min(1),
  }).optional(),
}) satisfies z.ZodType<Wire<ConfigurableProviderView>>

/** llm.providers request payload. */
export const llmProvidersRequestSchema = z.object({}) satisfies z.ZodType<Wire<RequestPayload<'llm.providers'>>>

/** llm.providers response value. */
export const llmProvidersValueSchema = z.object({
  providers: z.array(configurableProviderViewSchema),
}) satisfies z.ZodType<Wire<ResponseValue<'llm.providers'>>>

/** llm.models request payload. */
export const llmModelsRequestSchema = z.object({}) satisfies z.ZodType<Wire<RequestPayload<'llm.models'>>>

/** llm.models response value. */
export const llmModelsValueSchema = z.object({
  groups: z.array(modelProviderGroupSchema),
  failures: z.array(modelCatalogFailureSchema),
}) satisfies z.ZodType<Wire<ResponseValue<'llm.models'>>>

/** DiscoveredModelView row of llm.discoverModels. */
export const discoveredModelViewSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).optional(),
  contextWindow: z.number().int().positive().optional(),
  maxTokens: z.number().int().positive().optional(),
}) satisfies z.ZodType<Wire<DiscoveredModelView>>

/** llm.discoverModels request payload. */
export const llmDiscoverModelsRequestSchema = z.object({
  settingsNs: z.string().min(1),
  provider: z.string().min(1).optional(),
  baseURL: z.string().min(1).optional(),
  api: z.string().min(1).optional(),
  // Write-only at the host: used for this one interrogation, never stored and
  // never returned. It does ride the client's outgoing envelope like every
  // other secret-bearing payload (`credentials.set`, `settings.update`), which
  // `subscribeEnvelopes()` observers can see — redacting that tap is a
  // configuration-plane-wide change, not this method's to make alone.
  apiKey: z.string().min(1).optional(),
}) satisfies z.ZodType<Wire<RequestPayload<'llm.discoverModels'>>>

/** llm.discoverModels response value. */
export const llmDiscoverModelsValueSchema = z.object({
  models: z.array(discoveredModelViewSchema),
}) satisfies z.ZodType<Wire<ResponseValue<'llm.discoverModels'>>>

/** llm.oauthLoginStart request payload. */
export const llmOauthLoginStartRequestSchema = z.object({
  settingsNs: z.string().min(1),
  provider: z.string().min(1),
}) satisfies z.ZodType<Wire<RequestPayload<'llm.oauthLoginStart'>>>

/** OAuthDeviceChallengeView of llm.oauthLoginStart. */
export const oauthDeviceChallengeViewSchema = z.object({
  loginId: z.string().min(1),
  provider: z.string().min(1),
  userCode: z.string().min(1),
  verificationUri: z.string().min(1),
  expiresInSeconds: z.number().int().positive().optional(),
  loginLabel: z.string().min(1),
}) satisfies z.ZodType<Wire<OAuthDeviceChallengeView>>

/** llm.oauthLoginStart response value. */
export const llmOauthLoginStartValueSchema = oauthDeviceChallengeViewSchema satisfies z.ZodType<Wire<ResponseValue<'llm.oauthLoginStart'>>>

/** llm.oauthLoginWait request payload. */
export const llmOauthLoginWaitRequestSchema = z.object({
  settingsNs: z.string().min(1),
  loginId: z.string().min(1),
}) satisfies z.ZodType<Wire<RequestPayload<'llm.oauthLoginWait'>>>

/** llm.oauthLoginWait response value. */
export const llmOauthLoginWaitValueSchema = z.object({}) satisfies z.ZodType<Wire<ResponseValue<'llm.oauthLoginWait'>>>

/** llm.oauthLoginCancel request payload. */
export const llmOauthLoginCancelRequestSchema = z.object({
  settingsNs: z.string().min(1),
  loginId: z.string().min(1),
}) satisfies z.ZodType<Wire<RequestPayload<'llm.oauthLoginCancel'>>>

/** llm.oauthLoginCancel response value. */
export const llmOauthLoginCancelValueSchema = z.object({}) satisfies z.ZodType<Wire<ResponseValue<'llm.oauthLoginCancel'>>>

/** llm.oauthLogout request payload. */
export const llmOauthLogoutRequestSchema = z.object({
  settingsNs: z.string().min(1),
  provider: z.string().min(1),
}) satisfies z.ZodType<Wire<RequestPayload<'llm.oauthLogout'>>>

/** llm.oauthLogout response value. */
export const llmOauthLogoutValueSchema = z.object({}) satisfies z.ZodType<Wire<ResponseValue<'llm.oauthLogout'>>>
