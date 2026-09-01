/**
 * Device-code OAuth for catalog routes that pi-ai ships with an OAuth method.
 * Tokens live in the credential seam as JSON under `<ROUTE>_OAUTH`. Login never
 * reads another product's auth file.
 *
 * @module dsh-llm-pi-ai/oauth
 */

import { randomUUID } from 'node:crypto'
import type { AuthEvent, AuthInteraction, OAuthAuth, OAuthCredential } from '@earendil-works/pi-ai'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import { LlmError } from '@deepseek-ai/dsh-llm'
import type { LlmOAuthDeviceChallenge } from '@deepseek-ai/dsh-llm'

/**
 * Credential reference that stores one route's OAuth JSON. The stem matches
 * the API-key derivation so a settings card can name both without a second
 * naming rule.
 * @param provider - provider route key.
 * @returns a POSIX-identifier credential reference.
 */
export function oauthRef(provider: string): ReturnType<typeof credentialRef> {
  return credentialRef(`${provider.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_OAUTH`)
}

/**
 * Parse a stored OAuth JSON value. An unreadable value is absent rather than
 * a thrown error so a corrupt slot cannot take the whole adapter down.
 * @param value - the stored credential string.
 * @returns the credential, or `undefined` when it is not a usable OAuth blob.
 */
export function parseOAuthCredential(value: string): OAuthCredential | undefined {
  try {
    const parsed: unknown = JSON.parse(value)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
    const record = parsed as Record<string, unknown>
    if (record.type !== 'oauth') return undefined
    if (typeof record.access !== 'string' || record.access.length === 0) return undefined
    if (typeof record.refresh !== 'string' || record.refresh.length === 0) return undefined
    if (typeof record.expires !== 'number' || !Number.isFinite(record.expires)) return undefined
    return {
      type: 'oauth',
      access: record.access,
      refresh: record.refresh,
      expires: record.expires,
    }
  } catch {
    // JSON.parse throws only SyntaxError here; a corrupt slot is treated as
    // unconfigured so the next login can overwrite it.
    return undefined
  }
}

/**
 * Serialize one OAuth credential for the credential seam.
 * @param credential - the pi-ai OAuth credential.
 * @returns the JSON value stored under the route's OAuth reference.
 */
export function serializeOAuthCredential(credential: OAuthCredential): string {
  return JSON.stringify({
    type: 'oauth',
    access: credential.access,
    refresh: credential.refresh,
    expires: credential.expires,
  })
}

/** Host callbacks the login registry needs beyond pi-ai's OAuth method. */
export interface OAuthLoginHost {
  /** Resolve one credential reference to its current value. */
  resolve: (ref: ReturnType<typeof credentialRef>) => Promise<string | undefined>
  /** Store one credential value. */
  set: (ref: ReturnType<typeof credentialRef>, value: string) => Promise<void>
  /** Remove one stored credential. */
  unset: (ref: ReturnType<typeof credentialRef>) => Promise<void>
  /**
   * Ensure the route exists in the user settings section so the adapter
   * registers it. A no-op when the profile is already present.
   */
  ensureRoute: (provider: string) => Promise<void>
}

/** One in-flight device-code login. */
interface PendingLogin {
  id: string
  provider: string
  abort: AbortController
  done: Promise<OAuthCredential>
}

/**
 * Device-code login, token refresh, and credential I/O for one adapter
 * instance. Pending logins are process-local; stored tokens are durable.
 */
export class OAuthLoginRegistry {
  private readonly pending = new Map<string, PendingLogin>()
  private readonly refreshing = new Map<string, Promise<string | undefined>>()

  /**
   * @param oauthOf - the catalog OAuth method for one route, when it has one.
   * @param host - credential and settings callbacks.
   */
  constructor(
    private readonly oauthOf: (provider: string) => OAuthAuth | undefined,
    private readonly host: OAuthLoginHost,
  ) {}

  /**
   * Start device-code login for one catalog route. A previous in-flight login
   * for the same route is cancelled first.
   * @param provider - provider route key.
   * @param signal - cancels obtaining the device code, not the later wait.
   * @returns the device challenge the UI must show.
   */
  async start(provider: string, signal?: AbortSignal): Promise<LlmOAuthDeviceChallenge> {
    const oauth = this.oauthOf(provider)
    if (oauth === undefined) {
      throw new LlmError(
        `llm-pi-ai: provider route "${provider}" has no OAuth login`,
        'NO_OAUTH',
      )
    }
    this.cancelProvider(provider)
    const abort = new AbortController()
    const onAbort = (): void => { abort.abort() }
    signal?.addEventListener('abort', onAbort, { once: true })
    let challenge: LlmOAuthDeviceChallenge | undefined
    const got = Promise.withResolvers<LlmOAuthDeviceChallenge>()
    const interaction: AuthInteraction = {
      signal: abort.signal,
      prompt: () => Promise.reject(new Error('llm-pi-ai: OAuth login does not take a prompt')),
      notify: (event: AuthEvent) => {
        if (event.type !== 'device_code') return
        const next: LlmOAuthDeviceChallenge = {
          loginId: '',
          provider,
          userCode: event.userCode,
          verificationUri: event.verificationUri,
          ...event.expiresInSeconds === undefined ? {} : { expiresInSeconds: event.expiresInSeconds },
          loginLabel: oauth.loginLabel ?? oauth.name,
        }
        challenge = next
        got.resolve(next)
      },
    }
    const done = oauth.login(interaction)
    try {
      const first = await Promise.race([
        got.promise,
        done.then(() => {
          throw new LlmError(
            `llm-pi-ai: OAuth login for "${provider}" finished before issuing a device code`,
            'OAUTH_LOGIN_FAILED',
          )
        }),
      ])
      const id = randomUUID()
      first.loginId = id
      // `first` and `challenge` alias the same object, so the guard is a
      // defensive check that can never be false at this point.
      /* v8 ignore next -- the device-code notify resolves both references together */
      if (challenge !== undefined) challenge.loginId = id
      this.pending.set(id, { id, provider, abort, done })
      return first
    } catch (error) {
      abort.abort()
      throw error
    } finally {
      signal?.removeEventListener('abort', onAbort)
    }
  }

  /**
   * Wait for an in-flight login to finish, store the tokens, and ensure the
   * route is configured.
   * @param loginId - the id {@link start} returned.
   * @param signal - cancels this wait and the underlying login.
   */
  async wait(loginId: string, signal?: AbortSignal): Promise<void> {
    const pending = this.pending.get(loginId)
    if (pending === undefined) {
      throw new LlmError(`llm-pi-ai: unknown OAuth login "${loginId}"`, 'OAUTH_LOGIN_UNKNOWN')
    }
    const onAbort = (): void => { pending.abort.abort() }
    signal?.addEventListener('abort', onAbort, { once: true })
    try {
      const credential = await pending.done
      if (pending.abort.signal.aborted) {
        throw new LlmError(
          `llm-pi-ai: OAuth login for "${pending.provider}" was cancelled`,
          'OAUTH_LOGIN_CANCELLED',
        )
      }
      await this.host.set(oauthRef(pending.provider), serializeOAuthCredential(credential))
      await this.host.ensureRoute(pending.provider)
    } catch (error) {
      if (signal?.aborted || pending.abort.signal.aborted) {
        throw new LlmError(
          `llm-pi-ai: OAuth login for "${pending.provider}" was cancelled`,
          'OAUTH_LOGIN_CANCELLED',
          { cause: error },
        )
      }
      throw new LlmError(
        `llm-pi-ai: OAuth login for "${pending.provider}" failed`,
        'OAUTH_LOGIN_FAILED',
        { cause: error },
      )
    } finally {
      signal?.removeEventListener('abort', onAbort)
      this.pending.delete(loginId)
    }
  }

  /**
   * Cancel one in-flight login. Unknown ids are a no-op.
   * @param loginId - the id {@link start} returned.
   */
  cancel(loginId: string): void {
    const pending = this.pending.get(loginId)
    if (pending === undefined) return
    pending.abort.abort()
    this.pending.delete(loginId)
  }

  /**
   * Forget the stored OAuth credential for one route. The settings profile is
   * left in place so the row remains editable.
   * @param provider - provider route key.
   */
  async logout(provider: string): Promise<void> {
    this.cancelProvider(provider)
    await this.host.unset(oauthRef(provider))
  }

  /**
   * Resolve a usable access token for one route, refreshing when expired.
   * @param provider - provider route key.
   * @returns the access token, or `undefined` when no OAuth credential is stored.
   */
  accessToken(provider: string): Promise<string | undefined> {
    const existing = this.refreshing.get(provider)
    if (existing !== undefined) return existing
    const work = this.accessTokenUnlocked(provider)
    this.refreshing.set(provider, work)
    return work.finally(() => {
      this.refreshing.delete(provider)
    })
  }

  /** Refresh-serialized token resolution. */
  private async accessTokenUnlocked(provider: string): Promise<string | undefined> {
    const oauth = this.oauthOf(provider)
    if (oauth === undefined) return undefined
    const raw = await this.host.resolve(oauthRef(provider))
    if (raw === undefined) return undefined
    const stored = parseOAuthCredential(raw)
    if (stored === undefined) {
      throw new LlmError(
        `llm-pi-ai: stored OAuth credential for "${provider}" is unusable; sign in again`,
        'INVALID_CREDENTIAL',
      )
    }
    if (Date.now() < stored.expires) return stored.access
    try {
      const refreshed = await oauth.refresh(stored)
      await this.host.set(oauthRef(provider), serializeOAuthCredential(refreshed))
      return refreshed.access
    } catch (error) {
      throw new LlmError(
        `llm-pi-ai: OAuth refresh for "${provider}" failed; sign in again`,
        'OAUTH_REFRESH_FAILED',
        { cause: error },
      )
    }
  }

  /** Abort every in-flight login for one route. */
  private cancelProvider(provider: string): void {
    for (const [id, pending] of this.pending) {
      if (pending.provider !== provider) continue
      pending.abort.abort()
      this.pending.delete(id)
    }
  }
}

/**
 * Bind {@link OAuthLoginRegistry} to the live credential service when one is
 * mounted; without it, OAuth tokens cannot be stored and login fails loud.
 * @param credentials - the optional credential service.
 * @returns the resolve/set/unset host methods.
 */
export function credentialHost(credentials: CredentialProvider | undefined): Pick<OAuthLoginHost, 'resolve' | 'set' | 'unset'> {
  return {
    resolve: async (ref) => {
      if (credentials === undefined) return undefined
      return (await credentials.resolve(ref))?.value
    },
    set: async (ref, value) => {
      if (credentials === undefined) {
        throw new LlmError(
          'llm-pi-ai: OAuth login needs the credentials service',
          'MISSING_CREDENTIAL',
        )
      }
      await credentials.set(ref, value)
    },
    unset: async (ref) => {
      if (credentials === undefined) return
      await credentials.unset(ref)
    },
  }
}
