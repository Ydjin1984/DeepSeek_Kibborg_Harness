# dsh-debug-log

English | [中文](README.zh.md)

Process-local UI diagnostics tracer shared by the Host API gateway, mux downlink, browser session runtime, and Execution view. It is a **library, not a plugin**: no `ctx`, no settings schema, no events. Enablement is a boolean in this process; the General settings row in [`ui-settings-general`](../../client/ui-settings-general/README.md) is the product switch that writes the `ui-debug` namespace and calls `setUiDebugEnabled` on both halves.

When on, every record is one `console.info` line prefixed `[dsh-debug]`, so the Host terminal (start-menu 9) and the browser DevTools share a grep key. Disabled calls return after a boolean check. High-frequency mux and live-event paths use `uiDebugTick` (one summary per second) instead of one line per frame. Client bundles inline this library; enablement is stored on `globalThis` so those copies share one flag.

The [Agent Note](../../../.agents/notes/implemented/feature/2026-09-17-ui-debug-timings.md) owns why a process-local tracer exists instead of a debug RPC.

## Surface

```ts
import {
  installUiDebugSink, isUiDebugEnabled, setUiDebugEnabled,
  uiDebug, uiDebugSpan, uiDebugSpanSync, uiDebugTick,
} from '@deepseek-ai/dsh-debug-log'

setUiDebugEnabled(true)
uiDebug('session', 'open', { sessionId: 'ses_1' })
const page = await uiDebugSpan('rpc', 'session.history', { sessionId: 'ses_1' }, load)
uiDebugTick('mux', 'downlink', { type: 'assistant/chunk' })
```

| Export | Role |
|---|---|
| `setUiDebugEnabled(next)` | Process flag. A false→true edge writes `debug.enabled`; true→false flushes meters then `debug.disabled`. |
| `isUiDebugEnabled()` | Read the flag. |
| `uiDebug(area, action, data?)` | One instant line. |
| `uiDebugSpan` / `uiDebugSpanSync` | Time `fn`; append `+N.Nms`. A throw is logged with `ok=false` and rethrown. |
| `uiDebugTick(area, action, data?)` | Count into a 1s summary (`count`, `byType`). |
| `installUiDebugSink(write)` | Test hook replacing `console.info`. |
| `UI_DEBUG_PREFIX` | `[dsh-debug]`. |

`data` values stay compact: arrays render as `[n]`, objects as `{n}`, strings longer than 80 characters are truncated. The tracer never dumps a history page or mux payload.

## Model Experience

None. Records go to the operator console; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Each process has its own flag.** The Host console shows Host spans; the browser console shows client spans. There is no debug RPC that copies browser lines onto Host stdout.
- **The tracer is not a profiler.** Sub-millisecond work can report `+0.0ms`; use it to find multi-millisecond stalls on session list, inspect, history, assembler, and Execution view rebuilds.
