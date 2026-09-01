# Agent Note: Benchmark fails loudly and isolates task agents

Status: implemented

English | [中文](2026-08-31-benchmark-loud-llm-failures.zh.md)

## Problem

Two defects made the skill benchmark fail or misbehave in a real composition.

First, the benchmark's `callText` helper filtered the assembled stream blocks to text only and returned whatever text survived, discarding the stream's terminal finish reason. When an LLM call failed — an unknown provider route, an auth error, or a transport failure — the adapter stream ends in an `error` finish chunk with no text blocks, so `callText` returned an empty string and `generateCases` reported the misleading `the model produced no usable test cases` instead of the actual provider failure. This hid misconfiguration (for example a typo in the `provider/model` route) behind a diagnosis-free error and made the whole benchmark look broken.

Second, benchmark task agents were created through the normal agent factory with the session's default preset, so they inherited the globally registered `skill_manage` tool. The task model could therefore read every skill from the on-disk catalog through the manager, rewrite the very skill under test (a real run created a spurious version), and loop on manager calls for tens of minutes per case. The per-task 120-second deadline was also dead code: it aborted a local `AbortController` whose signal nothing listened to, so a stalled task agent ran until the benchmark was cancelled by hand.

## Decision

`callText` reads `assembler.finish` after the stream completes and, when the finish reason is `error`, throws a `SkillManagerError` carrying the underlying `LlmFailure.message`. Signal aborts keep precedence: `signal.throwIfAborted()` runs before the finish check, so the cancel path still settles as `cancelled`. The check matches only `kind === 'error'` against the merge-extensible `FinishReason` union; other kinds fall through to the existing text extraction. Because `callText` backs test-case generation, case evaluation, and auto-improve candidate generation, all three now surface the real failure.

`runTask` denies the `skill_manage` tool in every task agent's setup through the agent scope's `tools.restrict`, so neither arm can read managed skills through the manager or rewrite the skill under test while it is being scored. The runtime-registered skill (the with-skill arm) is registered through the agent scope's `ctx.get('skills')` — the scope-bound registry instance — so `register()` files into that agent's layer alone; the agent scope declares no inject, so the property proxy is unusable there. The per-task deadline now owns the abort chain: the local controller aborts on both the timeout and the benchmark-wide cancel, and its abort calls `agent.cancel({ kind: 'user' })`, so a stalled task settles instead of hanging the whole benchmark. The deadline was raised from 120s to 300s because it now actually fires and must tolerate long single generations.

## Alternatives considered

- **Returning the error message as the text payload.** Rejected: it would turn a failed generation into a seemingly successful text case and pollute evaluation.
- **Throwing on `aborted` finishes as well.** Rejected: provider-side aborts are rare, and signal aborts are already rethrown by `throwIfAborted`, so treating `aborted` as an error risked mislabeling user cancellations as failures.
- **Restricting the whole `skill` tool for the baseline arm.** Rejected: `skill` is registered per-agent by the preset, not globally, so the scoped `tools.restrict` (which validates against global tool names) cannot name it; the catalog would also be hidden from the with-skill arm, breaking the A/B.

## Consequences

A misconfigured or failing model route in `benchmark-start` or `auto-improve` now fails the run with the provider's own message (for example `model call failed: provider "dashscope" is not registered`), so the operator fixes the route instead of debugging a phantom "no usable test cases" failure. Benchmark task agents can no longer mutate skills or stall on manager-tool loops, so a run completes in bounded time without corrupting the skill under test. The changes are confined to the benchmark engine's error and isolation paths; successful runs are unchanged.

## Testing

`packages/skill/skill-manager` gained three cases: `fails loudly with the underlying LLM failure when the stream ends in an error finish` (fake LLM yields an error finish chunk), `denies the skill manager tool to every benchmark task agent` (both arms record the restriction), and `fails loudly when the with-skill agent scope lacks the skills service`. The full package suite (85 tests) passes. The existing `no usable test cases` path still fails loudly for genuinely non-JSON model output.
