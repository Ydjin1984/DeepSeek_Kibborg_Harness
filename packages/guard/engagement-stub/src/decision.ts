/**
 * Pure engagement decision engine: inspect tool name and arguments, extract a
 * host from URL-like arguments, and return allow/deny.
 *
 * @module @deepseek-ai/dsh-engagement-stub/decision
 */

/** Keys checked (in order) for a URL-like string value in flat argument objects. */
const URL_KEYS = ['url', 'endpoint', 'host', 'target', 'uri', 'domain', 'link', 'input'] as const

/** Normalised localhost variants that always pass when no allowlist is needed. */
const LOCALHOST_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])

/**
 * Extract a normalised host string from a flat argument object.
 *
 * Walks each `URL_KEY` in order; if the corresponding value is a non-empty
 * string it is interpreted as a URL (or bare hostname when the key is `'host'`).
 * Protocol, userinfo, port, and path are stripped; the result is lowercased.
 *
 * Returns `undefined` when no URL-like argument is present.
 *
 * @param args - flat argument object from a tool execution.
 * @returns the normalised host, or `undefined`.
 */
export function extractHost(args: unknown): string | undefined {
  if (args === null || typeof args !== 'object') return undefined
  const obj = args as Record<string, unknown>
  for (const key of URL_KEYS) {
    const value = obj[key]
    if (typeof value !== 'string' || value.length === 0) continue
    // Keys that are not inherently URL-like are treated as bare hostnames.
    const isBareHost = key === 'host'
    const host = parseUrlOrHost(value, isBareHost)
    if (host !== undefined) return host
  }
  return undefined
}

/**
 * Parse a URL string into a normalised host (lowercase, no port/path/userinfo).
 * When `isBareHost` is true and the value has no colon or slashes it is treated
 * as a hostname directly.
 *
 * @param urlOrHost - URL or hostname string.
 * @param isBareHost - whether to skip protocol parsing.
 * @returns normalised host, or `undefined` on parse failure.
 */
function parseUrlOrHost(urlOrHost: string, isBareHost: boolean): string | undefined {
  // Quick bare-host check: no scheme, no slashes, no colons, no brackets → literal host.
  if (isBareHost && !urlOrHost.includes(':') && !urlOrHost.includes('/') && !urlOrHost.includes('@') && !urlOrHost.includes('[')) {
    return urlOrHost.toLowerCase()
  }

  // For bare-host keys containing a port (e.g. "example.com:8080"), always
  // prepend a scheme so the URL constructor does not misinterpret the domain
  // as a protocol.
  const target = isBareHost && !urlOrHost.startsWith('http:') && !urlOrHost.startsWith('https:')
    ? `https://${urlOrHost}`
    : urlOrHost

  let parsed: URL
  try {
    parsed = new URL(target)
  } catch {
    // URL parse failed; try stripping protocol prefix and prepending https.
    const stripped = urlOrHost.replace(/^https?:\/\//, '')
    try {
      parsed = new URL(`https://${stripped}`)
    } catch {
      return undefined
    }
  }

  // hostname already excludes port, userinfo, and path.
  // Strip IPv6 brackets for comparison with allowlist entries.
  return parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase()
}

/** Input contract for the engagement decision function. */
export interface EngagementDecisionInput {
  /** Tool name to evaluate against the blocked list. */
  toolName: string
  /** Parsed tool arguments (unknown shape). */
  args: unknown
  /** Allowlisted hosts (lowercase, ports already stripped). */
  allowedHosts: readonly string[]
  /** Tools always blocked when the contour is on. */
  blockedTools: readonly string[]
}

/** Result of an engagement decision. */
export type EngagementDecision =
  | { kind: 'allow' }
  | { kind: 'deny'; reason: string }

/**
 * Core engagement decision: given tool name, arguments, allowlist, and blocked
 * set, return `{ kind: 'allow' }` or `{ kind: 'deny', reason }`.
 *
 * Logic:
 * 1. `toolName` ∈ `blockedTools` → deny immediately.
 * 2. Extract host from URL-like args.
 * 3. If host is `localhost`/`127.0.0.1`/`::1` → allow.
 * 4. If host ∈ `allowedHosts` → allow.
 * 5. If host was extracted but not in allowlist → deny.
 * 6. If no host was extracted → allow (fail-open for non-network tools).
 *
 * @param input - decision inputs.
 * @returns the engagement decision.
 */
export function engagementDecision(input: EngagementDecisionInput): EngagementDecision {
  const { toolName, args, allowedHosts, blockedTools } = input

  // Rule 1: blocked tools always denied.
  if (blockedTools.includes(toolName)) {
    return { kind: 'deny', reason: `tool ${toolName} is blocked by the engagement contour` }
  }

  // Rule 2: extract host.
  const host = extractHost(args)

  // Rule 6: no host → fail-open.
  if (host === undefined) {
    return { kind: 'allow' }
  }

  // Rule 3: localhost variants always pass.
  if (LOCALHOST_HOSTS.has(host)) {
    return { kind: 'allow' }
  }

  // Rule 4/5: exact match against allowlist.
  if (allowedHosts.includes(host)) {
    return { kind: 'allow' }
  }

  return { kind: 'deny', reason: `host ${host} is outside the engagement allowlist` }
}
