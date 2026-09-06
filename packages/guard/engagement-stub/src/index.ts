/**
 * Optional engagement contour: when enabled with a host allowlist, network and
 * exploit tools outside the allowed scope receive a deterministic deny before
 * execution, plus an `engagement/denied` audit event.
 *
 * By default disabled — production behaviour is unchanged.
 *
 * @module @deepseek-ai/dsh-engagement-stub
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'
import { engagementDecision, extractHost } from './decision.ts'

/**
 * Plugin configuration. `enabled` must be `true` for the contour to activate.
 * `allowedHosts` lists normalised hosts (lowercase, no ports) that are permitted;
 * `blockedTools` names tools always denied regardless of arguments.
 */
export interface Config {
  /** Whether the engagement contour is active (default `false`). */
  enabled?: boolean
  /** Normalised allowed hostnames (default `[]`). */
  allowedHosts?: string[]
  /** Tool names always blocked when enabled (default `['nmap','metasploit','msfconsole','nc','netcat']`). */
  blockedTools?: string[]
}

/** Schemastery schema for Config — validates defaults at load time. */
export const Config: z<Config> = z.object({
  enabled: z.boolean().default(false),
  allowedHosts: z.array(z.string()).default([]),
  blockedTools: z.array(z.string()).default(['nmap', 'metasploit', 'msfconsole', 'nc', 'netcat']),
})

/** Payload of the {@linkcode 'engagement/denied'} audit event. */
export interface EngagementDeniedEvent {
  toolName: string
  host?: string | undefined
  reason: string
  time: string
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * Emitted when the engagement contour denies a tool call before dispatch.
     * @param event - the denial audit record.
     */
    'engagement/denied': (event: EngagementDeniedEvent) => void
  }
}

/** Cordis plugin name. */
export const name = 'engagement-stub'

/** No injected services — listeners are registered via `ctx.on`. */
export const inject: string[] = []

/**
 * Apply the engagement contour: when `config.enabled` is `true`, register a
 * `tools/pre-execute` listener that calls `engagementDecision` and emits an
 * `engagement/denied` audit event on deny.
 *
 * @param ctx - Cordis context for listener registration.
 * @param config - validated {@link Config}.
 */
export function apply(ctx: Context, config: Config): void {
  if (!config.enabled) return

  const allowedHosts = config.allowedHosts as string[]
  const blockedTools = config.blockedTools as string[]

  ctx.on('tools/pre-execute', async (exec: ToolExecution, next): Promise<PreToolDecision> => {
    const decision = engagementDecision({
      toolName: exec.name,
      args: exec.arguments,
      allowedHosts,
      blockedTools,
    })

    if (decision.kind === 'allow') {
      return next()
    }

    // Audit event with the extracted host (if any).
    const host = extractHost(exec.arguments)
    ctx.events.emit('engagement/denied', {
      toolName: exec.name,
      host,
      reason: decision.reason,
      time: new Date().toISOString(),
    })

    ctx.logger.warn(`engagement-stub: ${decision.reason}`)
    return { kind: 'deny', reason: decision.reason }
  })
}
