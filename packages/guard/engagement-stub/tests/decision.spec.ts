/**
 * Unit tests for `@deepseek-ai/dsh-engagement-stub/decision`: `extractHost`
 * URL parsing and normalisation, `engagementDecision` blocked-tools, allowlist,
 * localhost bypass, fail-open, exact-match semantics, and subdomain
 * distinction.
 */

import { describe, expect, it } from 'vitest'
import { engagementDecision, extractHost, type EngagementDecision, type EngagementDecisionInput } from '../src/decision.ts'

/** Narrow a decision to its deny reason, failing the test on an allow. */
function denyReason(decision: EngagementDecision): string {
  if (decision.kind !== 'deny') throw new Error('expected a deny decision')
  return decision.reason
}

// ───────────────────────────────────────────
// extractHost
// ───────────────────────────────────────────

describe('extractHost', () => {
  it('returns undefined for null', () => {
    expect(extractHost(null)).toBeUndefined()
  })

  it('returns undefined for non-object', () => {
    expect(extractHost('string')).toBeUndefined()
    expect(extractHost(42)).toBeUndefined()
    expect(extractHost([])).toBeUndefined()
  })

  it('parses url key with https protocol', () => {
    const result = extractHost({ url: 'https://example.com/path?query=1' })
    expect(result).toBe('example.com')
  })

  it('parses url key with http protocol', () => {
    const result = extractHost({ url: 'http://example.com:8080/path' })
    expect(result).toBe('example.com')
  })

  it('strips port from URL', () => {
    const result = extractHost({ url: 'http://example.com:443' })
    expect(result).toBe('example.com')
  })

  it('strips userinfo from URL', () => {
    const result = extractHost({ url: 'http://user:pass@example.com/' })
    expect(result).toBe('example.com')
  })

  it('strips path after domain', () => {
    const result = extractHost({ url: 'https://example.com/deep/nested/path' })
    expect(result).toBe('example.com')
  })

  it('lowercases the host', () => {
    const result = extractHost({ url: 'https://EXAMPLE.COM/' })
    expect(result).toBe('example.com')
  })

  it('reads host key directly as bare hostname', () => {
    const result = extractHost({ host: 'Example.COM' })
    expect(result).toBe('example.com')
  })

  it('handles host key with port as URL', () => {
    const result = extractHost({ host: 'example.com:8080' })
    expect(result).toBe('example.com')
  })

  it('falls through to endpoint key when url is absent', () => {
    const result = extractHost({ endpoint: 'https://api.test.com/v1' })
    expect(result).toBe('api.test.com')
  })

  it('falls through to target key', () => {
    const result = extractHost({ target: 'http://target.local' })
    expect(result).toBe('target.local')
  })

  it('falls through to uri key', () => {
    const result = extractHost({ uri: 'https://uri.example.org/' })
    expect(result).toBe('uri.example.org')
  })

  it('falls through to domain key', () => {
    const result = extractHost({ domain: 'domain.example.net' })
    expect(result).toBe('domain.example.net')
  })

  it('falls through to link key', () => {
    const result = extractHost({ link: 'https://link.example.io/page' })
    expect(result).toBe('link.example.io')
  })

  it('falls through to input key', () => {
    const result = extractHost({ input: 'https://input.example.com/' })
    expect(result).toBe('input.example.com')
  })

  it('prefers url over endpoint (first-match)', () => {
    const result = extractHost({ url: 'https://first.com/', endpoint: 'https://second.com/' })
    expect(result).toBe('first.com')
  })

  it('returns undefined for empty string value', () => {
    const result = extractHost({ url: '' })
    expect(result).toBeUndefined()
  })

  it('returns undefined for non-string value in url key', () => {
    const result = extractHost({ url: 123 })
    expect(result).toBeUndefined()
  })

  it('returns undefined when all keys have non-string values', () => {
    const result = extractHost({ url: null, host: 1, endpoint: true })
    expect(result).toBeUndefined()
  })

  it('returns undefined for unparseable URL-like values', () => {
    const result = extractHost({ url: '://invalid/url' })
    expect(result).toBeUndefined()
  })
})

// ───────────────────────────────────────────
// engagementDecision
// ───────────────────────────────────────────

describe('engagementDecision', () => {
  const defaultInput = (): EngagementDecisionInput => ({
    toolName: 'web_fetch',
    args: { url: 'http://localhost/' },
    allowedHosts: [],
    blockedTools: ['nmap'],
  })

  it('blocks a tool in blockedTools', () => {
    const input = { ...defaultInput(), toolName: 'nmap', args: {} }
    const result = engagementDecision(input)
    expect(result).toEqual({ kind: 'deny', reason: 'tool nmap is blocked by the engagement contour' })
  })

  it('blocks multiple blocked tools', () => {
    const allBlocked = ['nmap', 'metasploit', 'msfconsole', 'nc', 'netcat']
    for (const tool of allBlocked) {
      const input = { ...defaultInput(), toolName: tool, args: {}, blockedTools: allBlocked }
      const result = engagementDecision(input)
      expect(result.kind).toBe('deny')
      expect(denyReason(result)).toContain(tool)
    }
  })

  it('allows localhost when not in allowedHosts', () => {
    const input = { ...defaultInput(), args: { url: 'http://localhost/api' }, allowedHosts: [] }
    expect(engagementDecision(input)).toEqual({ kind: 'allow' })
  })

  it('allows 127.0.0.1 when not in allowedHosts', () => {
    const input = { ...defaultInput(), args: { url: 'http://127.0.0.1/' } }
    expect(engagementDecision(input)).toEqual({ kind: 'allow' })
  })

  it('allows ::1 when not in allowedHosts', () => {
    const input = { ...defaultInput(), args: { url: 'http://[::1]:8080/' } }
    expect(engagementDecision(input)).toEqual({ kind: 'allow' })
  })

  it('allows a host in allowedHosts', () => {
    const input = { ...defaultInput(), args: { url: 'https://example.com/' }, allowedHosts: ['example.com'] }
    expect(engagementDecision(input)).toEqual({ kind: 'allow' })
  })

  it('denies a host not in allowedHosts', () => {
    const input = { ...defaultInput(), args: { url: 'https://evil.com/' }, allowedHosts: ['example.com'] }
    const result = engagementDecision(input)
    expect(result.kind).toBe('deny')
    expect(denyReason(result)).toBe('host evil.com is outside the engagement allowlist')
  })

  it('fails-open when no URL-like arguments exist', () => {
    const input = { ...defaultInput(), args: { query: 'select 1' } }
    expect(engagementDecision(input)).toEqual({ kind: 'allow' })
  })

  it('fails-open for a tool with no arguments', () => {
    const input = { ...defaultInput(), args: {} }
    expect(engagementDecision(input)).toEqual({ kind: 'allow' })
  })

  it('blockedTools takes priority over URL check', () => {
    const input = {
      ...defaultInput(),
      toolName: 'nmap',
      args: { url: 'http://example.com/' },
      allowedHosts: ['example.com'],
    }
    const result = engagementDecision(input)
    expect(result.kind).toBe('deny')
    expect(denyReason(result)).toBe('tool nmap is blocked by the engagement contour')
  })

  it('subdomain is not equal to allowlisted domain', () => {
    const input = {
      ...defaultInput(),
      args: { url: 'https://sub.example.com/' },
      allowedHosts: ['example.com'],
    }
    const result = engagementDecision(input)
    expect(result.kind).toBe('deny')
  })

  it('exact match allows subdomain when subdomain is in allowlist', () => {
    const input = {
      ...defaultInput(),
      args: { url: 'https://sub.example.com/' },
      allowedHosts: ['sub.example.com'],
    }
    expect(engagementDecision(input)).toEqual({ kind: 'allow' })
  })

  it('normalises host key to lowercase', () => {
    const input = { ...defaultInput(), args: { host: 'EXAMPLE.COM' }, allowedHosts: ['example.com'] }
    expect(engagementDecision(input)).toEqual({ kind: 'allow' })
  })

  it('denies uppercase host not in allowlist', () => {
    const input = { ...defaultInput(), args: { host: 'Evil.COM' }, allowedHosts: ['example.com'] }
    const result = engagementDecision(input)
    expect(result.kind).toBe('deny')
    expect(denyReason(result)).toBe('host evil.com is outside the engagement allowlist')
  })

  it('allows bare host in allowlist', () => {
    const input = { ...defaultInput(), args: { host: 'api.example.com' }, allowedHosts: ['api.example.com'] }
    expect(engagementDecision(input)).toEqual({ kind: 'allow' })
  })

  it('denies bare host not in allowlist', () => {
    const input = { ...defaultInput(), args: { host: 'attacker.net' }, allowedHosts: ['example.com'] }
    const result = engagementDecision(input)
    expect(result.kind).toBe('deny')
  })
})
