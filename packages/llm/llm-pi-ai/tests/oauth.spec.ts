import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AuthInteraction, OAuthAuth, OAuthCredential } from '@earendil-works/pi-ai'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import { LlmError } from '@deepseek-ai/dsh-llm'
import {
  OAuthLoginRegistry, credentialHost, oauthRef, parseOAuthCredential, serializeOAuthCredential,
} from '../src/oauth.ts'

function credential(overrides: Partial<OAuthCredential> = {}): OAuthCredential {
  return {
    type: 'oauth',
    access: 'access-token',
    refresh: 'refresh-token',
    expires: Date.now() + 60_000,
    ...overrides,
  }
}

function auth(overrides: Partial<OAuthAuth> = {}): OAuthAuth {
  return {
    name: 'xAI (Grok/X subscription)',
    loginLabel: 'Sign in with SuperGrok or X Premium',
    login: () => Promise.resolve(credential()),
    refresh: current => Promise.resolve(credential({ access: 'refreshed', refresh: current.refresh })),
    toAuth: current => Promise.resolve({ apiKey: current.access }),
    ...overrides,
  }
}

describe('oauth credential codec', () => {
  it('round-trips a pi-ai OAuth credential', () => {
    const stored = credential({ expires: 1_700_000_000_000 })
    expect(parseOAuthCredential(serializeOAuthCredential(stored))).toEqual({
      type: 'oauth',
      access: 'access-token',
      refresh: 'refresh-token',
      expires: 1_700_000_000_000,
    })
  })

  it('treats corrupt JSON as absent', () => {
    expect(parseOAuthCredential('{')).toBeUndefined()
    expect(parseOAuthCredential('[]')).toBeUndefined()
    expect(parseOAuthCredential('"string"')).toBeUndefined()
    expect(parseOAuthCredential('42')).toBeUndefined()
    expect(parseOAuthCredential('null')).toBeUndefined()
    expect(parseOAuthCredential('{"type":"api_key"}')).toBeUndefined()
    expect(parseOAuthCredential('{"type":"oauth","access":"","refresh":"r","expires":1}')).toBeUndefined()
    expect(parseOAuthCredential('{"type":"oauth","access":"a","refresh":"","expires":1}')).toBeUndefined()
    expect(parseOAuthCredential('{"type":"oauth","access":"a","refresh":"r","expires":"soon"}')).toBeUndefined()
    expect(parseOAuthCredential('{"type":"oauth","access":"a","refresh":"r","expires":1e999}')).toBeUndefined()
  })

  it('derives a POSIX OAuth credential reference from the route id', () => {
    expect(oauthRef('xai')).toBe(credentialRef('XAI_OAUTH'))
    expect(oauthRef('minimax-cn')).toBe(credentialRef('MINIMAX_CN_OAUTH'))
  })
})

describe('OAuthLoginRegistry', () => {
  const stored = new Map<string, string>()
  const routes = new Set<string>()
  const registry = (providers: readonly string[] = ['xai']): OAuthLoginRegistry => new OAuthLoginRegistry(
    provider => providers.includes(provider) ? oauth : undefined,
    {
      resolve: ref => Promise.resolve(stored.get(ref)),
      set: (ref, value) => {
        stored.set(ref, value)
        return Promise.resolve()
      },
      unset: (ref) => {
        stored.delete(ref)
        return Promise.resolve()
      },
      ensureRoute: (provider) => {
        routes.add(provider)
        return Promise.resolve()
      },
    },
  )
  let oauth = auth()

  afterEach(() => {
    stored.clear()
    routes.clear()
    oauth = auth()
  })

  it('refuses a route with no catalog OAuth method', async () => {
    const logins = registry()
    await expect(logins.start('openai')).rejects.toMatchObject({ code: 'NO_OAUTH' })
  })

  it('rejects a login that never issues a device code', async () => {
    oauth = auth({ login: () => Promise.resolve(credential()) })
    const logins = registry()
    await expect(logins.start('xai')).rejects.toMatchObject({ code: 'OAUTH_LOGIN_FAILED' })
  })

  it('propagates a login rejection without a device code', async () => {
    oauth = auth({ login: () => Promise.reject(new Error('network down')) })
    const logins = registry()
    await expect(logins.start('xai')).rejects.toThrow('network down')
  })

  it('ignores non-device-code events and forwards cancellation to the login', async () => {
    let interactionSeen: AuthInteraction | undefined
    oauth = auth({
      login: (interaction: AuthInteraction) => {
        interactionSeen = interaction
        interaction.notify({ type: 'other' } as never)
        return new Promise<OAuthCredential>((_resolve, reject) => {
          interaction.signal?.addEventListener('abort', () => {
            reject(new Error('Login cancelled'))
          })
        })
      },
    })
    const logins = registry()
    const controller = new AbortController()
    const starting = logins.start('xai', controller.signal)
    await vi.waitFor(() => {
      expect(interactionSeen).toBeDefined()
    })
    controller.abort()
    await expect(starting).rejects.toThrow('Login cancelled')
  })

  it('rejects a prompt request with a loud no-prompt error', async () => {
    let interactionSeen: AuthInteraction | undefined
    oauth = auth({
      login: (interaction: AuthInteraction) => {
        interactionSeen = interaction
        interaction.notify({
          type: 'device_code',
          userCode: 'WDJB-MJHT',
          verificationUri: 'https://auth.x.ai/activate',
        })
        return new Promise<OAuthCredential>(() => {})
      },
    })
    const logins = registry()
    const challenge = await logins.start('xai')
    await expect(interactionSeen?.prompt({ type: 'text', message: 'test' })).rejects.toThrow('does not take a prompt')
    logins.cancel(challenge.loginId)
  })

  it('falls back to the catalog name when the OAuth method ships no login label', async () => {
    let finish!: (value: OAuthCredential) => void
    const authNoLabel = auth({
      login: (interaction: AuthInteraction) => {
        interaction.notify({
          type: 'device_code',
          userCode: 'WDJB-MJHT',
          verificationUri: 'https://auth.x.ai/activate',
        })
        return new Promise<OAuthCredential>(resolve => { finish = resolve })
      },
    })
    delete authNoLabel.loginLabel
    oauth = authNoLabel
    const logins = registry()
    const challenge = await logins.start('xai')
    expect(challenge.loginLabel).toBe('xAI (Grok/X subscription)')
    finish(credential())
    await logins.wait(challenge.loginId)
  })

  it('waits for an unknown login id as OAUTH_LOGIN_UNKNOWN', async () => {
    const logins = registry()
    await expect(logins.wait('missing')).rejects.toMatchObject({ code: 'OAUTH_LOGIN_UNKNOWN' })
  })

  it('reports a failed login wait as OAUTH_LOGIN_FAILED', async () => {
    oauth = auth({
      login: (interaction: AuthInteraction) => {
        interaction.notify({
          type: 'device_code',
          userCode: 'WDJB-MJHT',
          verificationUri: 'https://auth.x.ai/activate',
        })
        return Promise.reject(new Error('verification failed'))
      },
    })
    const logins = registry()
    const challenge = await logins.start('xai')
    await expect(logins.wait(challenge.loginId)).rejects.toMatchObject({ code: 'OAUTH_LOGIN_FAILED' })
  })

  it('cancel of an unknown login id is a no-op', async () => {
    const logins = registry()
    expect(() => logins.cancel('missing')).not.toThrow()
  })

  it('a second start for the same provider cancels the first login', async () => {
    const started: string[] = []
    oauth = auth({
      login: (interaction: AuthInteraction) => {
        interaction.notify({
          type: 'device_code',
          userCode: 'WDJB-MJHT',
          verificationUri: 'https://auth.x.ai/activate',
        })
        return new Promise<OAuthCredential>((_resolve, reject) => {
          interaction.signal?.addEventListener('abort', () => {
            started.push('cancelled')
            reject(new Error('Login cancelled'))
          })
        })
      },
    })
    const logins = registry()
    const first = await logins.start('xai')
    const waiting = logins.wait(first.loginId)
    await logins.start('xai')
    await expect(waiting).rejects.toMatchObject({ code: 'OAUTH_LOGIN_CANCELLED' })
    expect(started).toContain('cancelled')
  })

  it('resolves no token for a route with no OAuth method or no stored credential', async () => {
    const logins = registry()
    await expect(logins.accessToken('openai')).resolves.toBeUndefined()
    await expect(logins.accessToken('xai')).resolves.toBeUndefined()
  })

  it('logout leaves the route profile in place', async () => {
    stored.set(oauthRef('xai'), serializeOAuthCredential(credential()))
    await registry().logout('xai')
    expect(stored.has(oauthRef('xai'))).toBe(false)
  })

  it('returns a device challenge then stores tokens on wait', async () => {
    let finish!: (value: OAuthCredential) => void
    oauth = auth({
      login: (interaction: AuthInteraction) => {
        interaction.notify({
          type: 'device_code',
          userCode: 'WDJB-MJHT',
          verificationUri: 'https://auth.x.ai/activate',
          expiresInSeconds: 600,
        })
        return new Promise<OAuthCredential>((resolve) => { finish = resolve })
      },
    })
    const logins = registry()
    const challenge = await logins.start('xai')
    expect(challenge.userCode).toBe('WDJB-MJHT')
    expect(challenge.verificationUri).toBe('https://auth.x.ai/activate')
    expect(challenge.loginLabel).toBe('Sign in with SuperGrok or X Premium')
    expect(challenge.provider).toBe('xai')
    const waiting = logins.wait(challenge.loginId)
    finish(credential({ access: 'live-access' }))
    await waiting
    expect(parseOAuthCredential(stored.get(oauthRef('xai')) ?? '')?.access).toBe('live-access')
    expect(routes.has('xai')).toBe(true)
  })

  it('cancels an in-flight login', async () => {
    oauth = auth({
      login: (interaction: AuthInteraction) => {
        interaction.notify({
          type: 'device_code',
          userCode: 'AAAA-BBBB',
          verificationUri: 'https://auth.x.ai/activate',
        })
        return new Promise<OAuthCredential>((_resolve, reject) => {
          interaction.signal?.addEventListener('abort', () => {
            reject(new Error('Login cancelled'))
          })
        })
      },
    })
    const logins = registry()
    const challenge = await logins.start('xai')
    const waiting = logins.wait(challenge.loginId)
    logins.cancel(challenge.loginId)
    await expect(waiting).rejects.toMatchObject({ code: 'OAUTH_LOGIN_CANCELLED' })
    expect(stored.size).toBe(0)
  })

  it('a caller abort while waiting cancels the login', async () => {
    oauth = auth({
      login: (interaction: AuthInteraction) => {
        interaction.notify({
          type: 'device_code',
          userCode: 'AAAA-BBBB',
          verificationUri: 'https://auth.x.ai/activate',
        })
        return new Promise<OAuthCredential>((_resolve, reject) => {
          interaction.signal?.addEventListener('abort', () => {
            reject(new Error('Login cancelled'))
          })
        })
      },
    })
    const logins = registry()
    const challenge = await logins.start('xai')
    const controller = new AbortController()
    const waiting = logins.wait(challenge.loginId, controller.signal)
    controller.abort()
    await expect(waiting).rejects.toMatchObject({ code: 'OAUTH_LOGIN_CANCELLED' })
    expect(stored.size).toBe(0)
  })

  it('a settled login that was aborted mid-wait reports cancellation', async () => {
    oauth = auth({
      login: (interaction: AuthInteraction) => {
        interaction.notify({
          type: 'device_code',
          userCode: 'AAAA-BBBB',
          verificationUri: 'https://auth.x.ai/activate',
        })
        return new Promise<OAuthCredential>(resolve => {
          interaction.signal?.addEventListener('abort', () => {
            resolve(credential({ access: 'late' }))
          })
        })
      },
    })
    const logins = registry()
    const challenge = await logins.start('xai')
    const controller = new AbortController()
    const waiting = logins.wait(challenge.loginId, controller.signal)
    controller.abort()
    await expect(waiting).rejects.toMatchObject({ code: 'OAUTH_LOGIN_CANCELLED' })
    expect(stored.size).toBe(0)
  })

  it('a second start for a different provider leaves the first login untouched', async () => {
    const finishes: Array<(value: OAuthCredential) => void> = []
    oauth = auth({
      login: (interaction: AuthInteraction) => {
        interaction.notify({
          type: 'device_code',
          userCode: 'WDJB-MJHT',
          verificationUri: 'https://auth.x.ai/activate',
        })
        return new Promise<OAuthCredential>(resolve => { finishes.push(resolve) })
      },
    })
    const logins = registry(['xai', 'other'])
    const first = await logins.start('xai')
    const waiting = logins.wait(first.loginId)
    await logins.start('other')
    finishes[0]?.(credential())
    await waiting
    expect(stored.size).toBe(1)
    expect(routes.has('xai')).toBe(true)
  })

  it('refreshes an expired access token under one in-flight refresh', async () => {
    stored.set(oauthRef('xai'), serializeOAuthCredential(credential({
      access: 'stale',
      expires: Date.now() - 1,
    })))
    const refresh = vi.fn((current: OAuthCredential) => Promise.resolve(credential({
      access: 'fresh',
      refresh: current.refresh,
      expires: Date.now() + 60_000,
    })))
    oauth = auth({ refresh })
    const logins = registry()
    const [first, second] = await Promise.all([logins.accessToken('xai'), logins.accessToken('xai')])
    expect(first).toBe('fresh')
    expect(second).toBe('fresh')
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('returns a still-valid access token without refreshing', async () => {
    stored.set(oauthRef('xai'), serializeOAuthCredential(credential({ access: 'live' })))
    const refresh = vi.fn()
    oauth = auth({ refresh })
    await expect(registry().accessToken('xai')).resolves.toBe('live')
    expect(refresh).not.toHaveBeenCalled()
  })

  it('maps a failed refresh to OAUTH_REFRESH_FAILED', async () => {
    stored.set(oauthRef('xai'), serializeOAuthCredential(credential({ expires: Date.now() - 1 })))
    oauth = auth({ refresh: () => Promise.reject(new Error('invalid_grant')) })
    await expect(registry().accessToken('xai')).rejects.toMatchObject({ code: 'OAUTH_REFRESH_FAILED' })
  })

  it('rejects an unreadable stored blob as INVALID_CREDENTIAL', async () => {
    stored.set(oauthRef('xai'), '{')
    await expect(registry().accessToken('xai')).rejects.toBeInstanceOf(LlmError)
    await expect(registry().accessToken('xai')).rejects.toMatchObject({ code: 'INVALID_CREDENTIAL' })
  })

  it('logout forgets the stored credential', async () => {
    stored.set(oauthRef('xai'), serializeOAuthCredential(credential()))
    await registry().logout('xai')
    expect(stored.has(oauthRef('xai'))).toBe(false)
  })
})

describe('credentialHost', () => {
  it('degrades to absent reads and no-op writes without a credentials service', async () => {
    const host = credentialHost(undefined)
    await expect(host.resolve(oauthRef('xai'))).resolves.toBeUndefined()
    await host.unset(oauthRef('xai'))
    await expect(host.set(oauthRef('xai'), 'v')).rejects.toMatchObject({ code: 'MISSING_CREDENTIAL' })
  })

  it('forwards reads and writes to a mounted credentials service', async () => {
    const calls: string[] = []
    const provider = {
      resolve: vi.fn(async () => ({ value: 'stored', source: 'test' as const })),
      set: vi.fn(async () => { calls.push('set') }),
      unset: vi.fn(async () => { calls.push('unset') }),
    } as unknown as CredentialProvider
    const host = credentialHost(provider)
    await expect(host.resolve(oauthRef('xai'))).resolves.toBe('stored')
    await host.set(oauthRef('xai'), 'v')
    await host.unset(oauthRef('xai'))
    expect(calls).toEqual(['set', 'unset'])
  })
})
