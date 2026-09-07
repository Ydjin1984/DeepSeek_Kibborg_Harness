/**
 * Head/executor tool-policy decision (T6).
 *
 * The head planner (delegation depth 0) must not call heavy tools directly —
 * it delegates them through the `executor` tool. This module owns the pure
 * decision; the orchestrator plugin applies it twice: it hides listed tools
 * from the depth-0 `system-prompt/assemble` schema, and it denies them at
 * `tools/pre-execute` before approval. Delegated agents (depth >= 1, e.g. the
 * executor worker) are never restricted here: they inherit the full tool set
 * by design. The plugin does not use `tools.restrict()` for this list, because
 * a scoped restriction would inherit onto executor children.
 *
 * @module @deepseek-ai/dsh-orchestrator/policy
 */

import type { Agent } from '@deepseek-ai/dsh-agent'
import { delegationDepthOf } from '@deepseek-ai/dsh-subagent'

/**
 * Decide whether a head-planner tool call is denied by the orchestrator
 * policy.
 *
 * @param agent - the calling agent (may be undefined for non-agent callers).
 * @param toolName - the tool the agent is about to call.
 * @param deny - the configured head-denied tool names (empty = policy off).
 * @returns the model-facing denial reason, or `undefined` to allow the call.
 */
export function headToolDeny(
  agent: Agent | undefined,
  toolName: string,
  deny: ReadonlySet<string>,
): string | undefined {
  // Non-agent callers (host code, other subsystems) are outside the role
  // policy; delegated workers (depth >= 1) must keep the heavy tool set.
  if (agent === undefined) return undefined
  if (delegationDepthOf(agent) > 0) return undefined
  if (deny.size === 0 || !deny.has(toolName)) return undefined
  return `tool "${toolName}" is denied to the head planner by the orchestrator policy: `
    + 'delegate heavy tool work to the `executor` tool instead'
}

/**
 * Drop tools the head planner must not see in the model-facing schema.
 * Delegated workers, host assemblies without an agent, and an empty deny
 * list keep the incoming list.
 *
 * @param agent - the assembly's agent, when one is present.
 * @param tools - the assembled tool schemas (or any `{ name }` records).
 * @param deny - the configured head-denied tool names.
 * @returns the tools that may appear in this assembly's schema.
 */
export function filterHeadToolSchemas<T extends { name: string }>(
  agent: Agent | undefined,
  tools: readonly T[],
  deny: ReadonlySet<string>,
): T[] {
  return tools.filter(tool => headToolDeny(agent, tool.name, deny) === undefined)
}
