/**
 * URL validation and content-type classification for the local HTTP(S) fetch
 * provider — the pure, network-free half. The provider's `fetch()` composes
 * these with transport (redirect following, byte caps, decoding).
 *
 * @module @deepseek-ai/dsh-web-fetch-http/policy
 */

import { WebError } from '@deepseek-ai/dsh-web'

/** The body kinds this provider decodes. */
export type FetchableKind = 'html' | 'text'

/**
 * Validate a request URL against the basic transport hygiene the provider
 * enforces before any network access: http(s) only, no embedded credentials,
 * bounded length. Returns the parsed `URL`. Throws {@link WebError} otherwise.
 * (SSRF / private-network blocking is deferred — see the package Agent Note.)
 *
 * @param input - the raw URL string from the fetch request.
 * @param maxUrlLength - inclusive upper bound on `input`'s length.
 * @returns the parsed `URL`.
 */
export function validateFetchUrl(input: string, maxUrlLength: number): URL {
  if (input.length > maxUrlLength) {
    throw new WebError(`URL exceeds the maximum length of ${maxUrlLength}`, 'WEB_INVALID_URL')
  }
  let url: URL
  try {
    url = new URL(input)
  } catch (error: unknown) {
    throw new WebError(`invalid URL: ${input}`, 'WEB_INVALID_URL', { cause: error })
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new WebError(`unsupported URL scheme "${url.protocol}" (only http and https are allowed)`, 'WEB_INVALID_URL')
  }
  if (url.username.length > 0 || url.password.length > 0) {
    throw new WebError('credentials in URLs are not allowed', 'WEB_BLOCKED_URL')
  }
  return url
}

/**
 * Two URLs are same-origin when scheme, hostname, and port match. A redirect
 * that crosses origins is refused so each new origin requires a fresh tool call
 * (and thus a fresh provider/permission decision).
 *
 * @param a - one of the two URLs to compare.
 * @param b - the other URL to compare.
 * @returns true when `a` and `b` share scheme, hostname, and port.
 */
export function isSameOrigin(a: URL, b: URL): boolean {
  return a.protocol === b.protocol && a.hostname === b.hostname && a.port === b.port
}

/**
 * Classify a response `Content-Type` into a decodable body kind, or `undefined`
 * for an unsupported (e.g. binary) type. `text/html` and `application/xhtml+xml`
 * are `html`; other `text/*` plus a few structured text types are `text`.
 *
 * @param contentType - the raw `Content-Type` header, or `null` when the
 *   response carries none (unsupported).
 * @returns the decodable kind, or `undefined` for an unsupported type.
 */
export function classifyContentType(contentType: string | null): FetchableKind | undefined {
  const mime = (contentType ?? '').replace(/;.*$/s, '').trim().toLowerCase()
  if (mime === 'text/html' || mime === 'application/xhtml+xml') return 'html'
  if (mime.startsWith('text/')) return 'text'
  if (mime === 'application/json' || mime === 'application/xml' || mime.endsWith('+json') || mime.endsWith('+xml')) return 'text'
  return undefined
}

/**
 * Extract the `charset` parameter from a response `Content-Type`, lower-cased,
 * or `undefined` when absent. The provider feeds this label to `TextDecoder`
 * so a non-UTF-8 response is decoded with its declared encoding rather than
 * silently mangled into replacement characters.
 *
 * @param contentType - the raw `Content-Type` header, or `null` when the
 *   response carries none.
 * @returns the lower-cased charset label, or `undefined` when none is declared.
 */
export function parseCharset(contentType: string | null): string | undefined {
  const match = /;\s*charset\s*=\s*"?([^";]+)"?/i.exec(contentType ?? '')
  return match?.[1]?.trim().toLowerCase()
}

/**
 * Build a `TextDecoder` for the declared charset, falling back to UTF-8 when
 * none is declared. Throws {@link WebError} `WEB_UNSUPPORTED_CONTENT_TYPE` when
 * the label is present but not a charset `TextDecoder` recognizes — better to
 * fail loudly than return mojibake.
 *
 * @param charset - the declared charset label (from {@link parseCharset}), or
 *   `undefined` to default to UTF-8.
 * @returns a decoder for the declared (or defaulted) encoding.
 */
export function decoderForCharset(charset: string | undefined): TextDecoder {
  if (charset === undefined) return new TextDecoder('utf-8')
  try {
    return new TextDecoder(charset)
  } catch (error: unknown) {
    throw new WebError(`unsupported charset "${charset}"`, 'WEB_UNSUPPORTED_CONTENT_TYPE', { cause: error })
  }
}

/**
 * Check whether a parsed URL targets a private, loopback, link-local, or
 * unspecified network address. Returns `false` for hostnames that are
 * resolved names (e.g. `example.com`) — only IP-literal hostnames and
 * `localhost`/`.localhost` are classified.
 *
 * This is a synchronous check on the hostname string; DNS-rebinding is a
 * known limitation — a hostname that resolves to a public IP at request time
 * may resolve to a private IP on subsequent lookups. Full protection requires
 * async DNS resolution with a revalidation hook.
 *
 * @param url - a parsed `URL` whose `.hostname` to classify.
 * @returns `true` when the hostname is a loopback, private IPv4, link-local,
 *   ULA, unspecified, or `localhost`/`.localhost`.
 */
export function isPrivateNetwork(url: URL): boolean {
  const host = url.hostname

  // hostname literals
  if (host === 'localhost' || host.endsWith('.localhost')) return true
  if (host === '0.0.0.0') return true
  if (host === '::') return true

  // IPv4-mapped / IPv4-embedded IPv6  ::ffff:<private>
  const ipv6Mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(host)
  if (ipv6Mapped) return isPrivateNetwork(new URL(`http://${ipv6Mapped[1]}`))

  // pure IPv6 literals
  if (host.startsWith('[') && host.endsWith(']')) {
    return checkIpv6(host.slice(1, -1))
  }

  // pure IPv4 literals
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) {
    return checkIpv4(host)
  }

  return false
}

/** Return true when the IPv6 literal targets a private/loopback/link-local range. */
function checkIpv6(addr: string): boolean {
  // Unspecified
  if (addr === '::' || addr === '0000:0000:0000:0000:0000:0000:0000:0000') return true
  // Loopback ::1
  if (addr === '::1' || addr === '0000:0000:0000:0000:0000:0000:0000:0001') return true

  // Expand full form for comparison
  const parts = expandIpv6(addr)
  if (!parts) return false

  const full = parts.join('') // 32 hex chars

  // IPv4-mapped (::ffff:a.b.c.d / ::ffff:7f00:1): WHATWG URL normalizes the
  // dotted form to hex, so classify the embedded IPv4 as the real target.
  if (full.startsWith('00000000000000000000ffff')) {
    const ipv4Hex = full.slice(24)
    const ipv4 = [0, 2, 4, 6].map(offset => parseInt(ipv4Hex.slice(offset, offset + 2), 16)).join('.')
    return checkIpv4(ipv4)
  }

  // link-local fe80::/10  →  fe80-fe10 in first 4 hex digits
  const first = parseInt(full.slice(0, 4), 16)
  if (first >= 0xfe80 && first <= 0xfeff) return true

  // ULA fc00::/7  →  fc or fd in first 4 hex digits
  if (first >= 0xfc00 && first <= 0xfdff) return true

  return false
}

/** Expand an IPv6 address to 8 groups of 4 hex digits; null on parse failure. */
function expandIpv6(addr: string): string[] | null {
  const doubleColon = addr.indexOf('::')
  if (doubleColon === -1) {
    const parts = addr.split(':')
    if (parts.length !== 8) return null
    return parts.map(p => p.padStart(4, '0'))
  }

  const [left, right] = addr.split('::')
  const leftParts = left ? left.split(':') : []
  const rightParts = right ? right.split(':') : []
  const missing = 8 - leftParts.length - rightParts.length
  if (missing < 1) return null

  const full = [...leftParts, ...Array(missing).fill('0000'), ...rightParts]
  return full.map(p => p.padStart(4, '0'))
}

/** Return true when the IPv4 address falls in a private/loopback/link-local range. */
function checkIpv4(ipv4: string): boolean {
  const parts = ipv4.split('.').map(Number)
  const [a, b] = parts
  if (a === undefined || b === undefined || isNaN(a) || isNaN(b)) return false

  // 127.0.0.0/8  loopback
  if (a === 127) return true
  // 10.0.0.0/8  private
  if (a === 10) return true
  // 172.16.0.0/12  private
  if (a === 172 && b >= 16 && b <= 31) return true
  // 192.168.0.0/16  private
  if (a === 192 && b === 168) return true
  // 169.254.0.0/16  link-local
  if (a === 169 && b === 254) return true
  // 0.0.0.0/8  unspecified
  if (a === 0) return true

  return false
}
