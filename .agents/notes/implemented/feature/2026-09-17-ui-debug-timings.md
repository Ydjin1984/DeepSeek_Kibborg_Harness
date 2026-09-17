# Agent Note: UI diagnostics timings

Status: implemented

English | [中文](2026-09-17-ui-debug-timings.zh.md)

## Problem

After a page refresh the session list and the selected transcript can sit blank for seconds while Telegram already shows the turn. Operators watching the Host terminal (start-menu 9) and the browser DevTools have no shared, greppable record of where that wait is spent: `session.list`, cold inspect, history pagination, presenter scope, mux upgrade, assembler `replaceWindow`, or Execution view rebuild.

Ad-hoc `console.log` in one process cannot answer a split Host/browser stall, and leaving verbose logs on always distorts the same timings.

## Decision

A process-local tracer lives in `@deepseek-ai/dsh-debug-log`. `setUiDebugEnabled` is a boolean in that process; disabled calls return after one check. Enabled records are one `console.info` line prefixed `[dsh-debug]` with wall-clock time and, for spans, `+N.Nms`. Mux frames and live session events use a one-second `uiDebugTick` summary instead of one line per chunk. Client bundles inline the library (the purity gate's inline-safe list); enablement is stored on `globalThis` so those copies share one flag.

The General settings row persists `ui-debug.enabled` (default false). The Host plugin watches that namespace and sets the Host flag; the browser plugin binds the same namespace and sets the browser flag. Host spans (RPC handler, inspect, paginate, presentPage, listVisible, mux downlink) appear in the Host terminal; client spans (RPC POST, connection handshake, session open/history/installWindow, assembler, Execution events) appear in DevTools.

## Alternatives considered

**A debug RPC that copies browser lines onto Host stdout.** Rejected because the goal is to find stalls, not add another round-trip on the same path, and two greppable consoles already split Host work from browser work.

**Always-on `console.debug`.** Rejected because it heats the refresh path under measurement and cannot be turned off from the product UI.

**Chrome Performance marks only.** Rejected because operators sitting at the Host terminal never see them, and the Host inspect/list work is the other half of the stall.

## Consequences

Turning the row on writes `[dsh-debug] debug.enabled` in that process; turning it off flushes sampled meters then writes `debug.disabled`. A refresh after enable is required only when the previous page loaded with the flag off. The tracer never dumps a history page or mux payload: arrays render as `[n]`, objects as `{n}`. Sub-millisecond work can report `+0.0ms`.

## Testing

Util: `packages/util/debug-log/tests`. Host enablement and schema decode: `packages/client/ui-settings-general/tests/host.client.spec.ts`. Row and apply: `debug-row.client.spec.tsx`, `apply.client.spec.ts`. Existing session/history/mux specs keep covering the instrumented call sites while the flag is off.
