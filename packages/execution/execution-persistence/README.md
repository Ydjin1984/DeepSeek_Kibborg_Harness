# @deepseek-ai/dsh-execution-persistence

English | [中文](README.zh.md)

Append-only JSONL journal for `execution/event` and `executions/resource` payloads. The `dsh-execution` service stays an in-memory projection; this plugin is the composition-side listener that durably records those Cordis events for audit.

## Plugin (namespace: `execution-persistence`)

A function plugin (`name` / `inject` / `apply` / `Config`). It injects no services. Shipping profiles mount it from `dsh-base` after `dsh-execution`:

```yaml
- id: execution-persistence
  name: '@deepseek-ai/dsh-execution-persistence'
```

### Config

| Field | Default | Meaning |
|---|---|---|
| `enabled` | `true` | When `false`, the plugin registers no listeners. |
| `root` | `$DSH_HOME/executions` | Directory that holds `events.jsonl`. Relative paths resolve against the process cwd. An omitted or whitespace `root` uses `dshHomePath('executions')` (`$DSH_HOME`, else `~/.dsh`). |

### Journal file

Path: `<root>/events.jsonl`.

Each line is one JSON object:

```json
{"kind":"execution","ts":1710000000000,"event":{}}
{"kind":"resource","ts":1710000000001,"event":{}}
```

`kind` is `"execution"` for `execution/event` and `"resource"` for `executions/resource`. `event` is the inner `payload.event` (`ExecutionEvent` or `ResourceEvent`). `ts` is epoch milliseconds when this plugin queued the line. The plugin opens the file append-only, writes the line, calls `handle.sync()`, and closes; overlapping emits share one per-plugin promise chain so lines are not interleaved. A write failure is logged with `ctx.logger.warn` and does not reject the emitter. Plugin dispose waits for in-flight writes, then ignores further events.

## Model Experience

### Host-side execution journal

#### What the model sees

This plugin registers no prompt section, tool schema, or model-visible message. It appends host-side `execution/event` and `executions/resource` payloads to a JSONL file that never enters a model request.

#### Token effect

Zero. Journal records do not add, replace, or cap tokens in any model request.

#### KV Cache effect

Independent of model requests. Writing the journal does not change request tokens or invalidate KV-cache entries.

## Known Limitations and Deferred Work

- **Append-only audit log** — the file is a history of emitted events; this package does not rebuild `ctx.executions` or resource leases from it.
- **No torn-tail recovery** — a crash mid-line can leave a truncated last record; readers must skip an incomplete final line. Repair and replay belong to a later slice.
- **Process-local writer** — one plugin instance serializes its own writes; concurrent processes appending the same file are not coordinated.
