# Agent Note: Orchestrator head tool schema visibility

Status: implemented

English | [中文](2026-09-07-orchestrator-head-tool-schema-visibility.zh.md)

## Problem

Orchestrator mode splits the session's chat model (the head planner, delegation depth 0) from a local executor worker (depth ≥ 1). `headDenyTools` already denies listed names at `tools/pre-execute` before approval, but the head still received those tools in the model-facing schema from `systemPrompt.assemble()`. The model then spent tokens on unused definitions and tried calls that the policy would reject.

`tools.restrict()` cannot own this list. A scoped restriction on the head inherits onto in-process executor children, which must keep the full tool set.

## Decision

`@deepseek-ai/dsh-orchestrator` filters the assembled schema on the `system-prompt/assemble` waterfall in the same live-settings lifecycle as the pre-execute listener. While the mode is enabled with a non-empty `headDenyTools` list, the plugin registers both listeners; disabling the mode, clearing the list, or tearing the fiber down disposes them.

The filter uses the same pure decision as execution: [`headToolDeny`](../../../../packages/context/orchestrator/src/policy.ts) / [`filterHeadToolSchemas`](../../../../packages/context/orchestrator/src/policy.ts). Depth-0 assemblies drop listed `ToolSchema.name`s after `next()` so later waterfall listeners cannot put a denied tool back. Depth ≥ 1, an assembly with no `agent` (host diagnostics), an empty deny list, and a disabled mode leave `assembly.tools` unchanged.

`dsh-agent`'s `assembleContextFor(agent)` already puts `agent` on `AssembleContext`, which the orchestrator prompt section already reads. The plugin does not change `dsh-agent-loop`, `dsh-system-prompt`, or `dsh-tools`.

Schema hiding is not a security boundary. Pre-execute denial remains the execution check for a forged or leftover call. The two listeners share one disposer so they cannot drift on or off independently.

## Alternatives considered

**`tools.restrict()` on the head scope.** The registry's restriction inherits onto unpublished in-process children. That would hide the same names from the executor worker, which must run them. T6 rejected this path.

**Filter inside `dsh-agent-loop` between assemble and `buildRequest`.** The loop would have to know `headDenyTools`. The policy belongs in the orchestrator package, which already owns the settings namespace and the pre-execute listener.

**A tools-provider that omits schemas.** Providers only add schemas; they do not remove another provider's contribution. The assemble waterfall is the documented authoritative transform.

**Schema hiding without pre-execute denial.** Presentation-only filtering lets a leftover or Code Mode call execute a tool the prompt omitted. Execution denial already shipped; this change only aligns the schema.

## Consequences

The head's LLM request no longer lists denied tools, so the model cannot select them from the schema. Executor children still see the full set. Changing `headDenyTools` or toggling the mode changes the head's tools header and invalidates that cached prefix.

Deployments that need a tool hidden from the head must name it in `headDenyTools`. Unlisted tools remain visible and callable; prompt text still asks the head to delegate heavy work through `executor`.
