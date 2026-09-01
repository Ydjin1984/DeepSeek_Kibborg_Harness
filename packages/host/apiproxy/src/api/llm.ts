/**
 * llm domain contract: host-scoped provider topology for configuration
 * surfaces. `llm.providers` merges the configurable-provider directory
 * (which providers CAN be configured, and where their settings live) with the
 * live route registry; `llm.models` is the session-independent model catalog
 * (the same groups as `session.models`, without a per-session selection).
 * Clients invalidate from the forwarded `llm/adapters-updated` and
 * `settings/document-updated` owner events.
 */

import type { RpcRequest, RpcResponse } from './rpc.ts'
import type { ModelCatalogFailure, ModelProviderGroup } from './sessions.ts'

/** Wire view of one configurable provider. */
export interface ConfigurableProviderView {
  /** Provider route key (`deepseek-official`, `openai`, …). */
  provider: string
  /** Human-readable name for configuration surfaces. */
  displayName: string
  /** Settings namespace whose section configures this provider. */
  settingsNs: string
  /** Path from that section's root to the provider's profile object (empty = whole section). */
  settingsPath: string[]
  /** Whether the route is currently registered (its models are requestable). */
  active: boolean
  /**
   * Whether the owning adapter knows this route only because configuration
   * declared it. Absent when the adapter draws no such distinction, so a
   * surface must treat absence as "unknown", not as "shipped".
   */
  declared?: boolean
  /**
   * Device-code OAuth this adapter offers for the route. Absent when the
   * Models page should not show a subscription sign-in.
   */
  oauth?: {
    /** Button label, e.g. "Sign in with SuperGrok or X Premium". */
    loginLabel: string
    /** Credential reference holding the OAuth JSON for this route. */
    credentialRef: string
  }
}

/** Llm-domain unary methods (the map keys llm.* of RpcMethodMap). */
export interface LlmApi {
  /**
   * List every configurable provider with its live/dormant state, in
   * directory declaration order. Routes registered outside the directory
   * (an adapter that never declared configurability) are appended with their
   * registration identity and no settings address.
   */
  providers(request: RpcRequest<{}>): Promise<RpcResponse<{ providers: ConfigurableProviderView[] }>>

  /**
   * Host-scoped model catalog over every registered provider route: the
   * settings surface's models view, needing no session. Per-provider listing
   * failures ride `failures` without failing the sound groups.
   */
  models(request: RpcRequest<{}>): Promise<RpcResponse<{ groups: ModelProviderGroup[]; failures: ModelCatalogFailure[] }>>

  /**
   * Interrogate a provider endpoint the configuration surface is still
   * drafting, and return the models it advertises for the user to adopt.
   *
   * The payload is the draft, not a stored route: `settingsNs` selects the
   * adapter family that answers, and the rest comes from the form. `provider`
   * names the route being edited when there is one — an adapter that already
   * describes that route answers from its own registry, with better metadata
   * and no network call, and needs no endpoint. A route it does not describe is
   * asked over the wire, which is what `baseURL`, `api`, and `apiKey` are for.
   *
   * Nothing is written — the reply is candidates, and only a later
   * `settings.mutate` decides what a route serves. `apiKey` is accepted here
   * but never stored or returned; a provider whose key is already stored omits
   * it and the endpoint answers unauthenticated or refuses.
   */
  discoverModels(
    request: RpcRequest<{
      settingsNs: string
      provider?: string
      baseURL?: string
      api?: string
      apiKey?: string
    }>,
    signal?: AbortSignal,
  ): Promise<RpcResponse<{ models: DiscoveredModelView[] }>>

  /**
   * Start device-code OAuth for one catalog route. Returns the user code and
   * verification URL immediately; {@link oauthLoginWait} stores tokens after
   * the user approves. Privileged: the Host talks to the issuer.
   */
  oauthLoginStart(
    request: RpcRequest<{ settingsNs: string; provider: string }>,
    signal?: AbortSignal,
  ): Promise<RpcResponse<OAuthDeviceChallengeView>>

  /**
   * Wait for an in-flight OAuth login to finish. Caller-paced: device-code
   * approval can outlive the default unary deadline.
   */
  oauthLoginWait(
    request: RpcRequest<{ settingsNs: string; loginId: string }>,
    signal?: AbortSignal,
  ): Promise<RpcResponse<{}>>

  /**
   * Cancel an in-flight OAuth login. Unknown ids succeed as a no-op.
   */
  oauthLoginCancel(
    request: RpcRequest<{ settingsNs: string; loginId: string }>,
  ): Promise<RpcResponse<{}>>

  /**
   * Forget the stored OAuth credential for one route. The settings profile is
   * left in place.
   */
  oauthLogout(
    request: RpcRequest<{ settingsNs: string; provider: string }>,
  ): Promise<RpcResponse<{}>>
}

/** Wire view of one OAuth device-code challenge. */
export interface OAuthDeviceChallengeView {
  /** Opaque id for wait/cancel. */
  loginId: string
  /** Provider route this login authenticates. */
  provider: string
  /** Short code the user confirms on the verification page. */
  userCode: string
  /** HTTPS verification URL. */
  verificationUri: string
  /** Device-code lifetime in seconds, when the issuer supplied one. */
  expiresInSeconds?: number
  /** Button/dialog label. */
  loginLabel: string
}

/** Wire view of one model an interrogated endpoint advertises. */
export interface DiscoveredModelView {
  /** Model id the endpoint accepts. */
  id: string
  /** Human-readable name when the endpoint supplies one. */
  name?: string
  /** Maximum combined request and response context, when disclosed. */
  contextWindow?: number
  /** Maximum output tokens, when disclosed. */
  maxTokens?: number
}
