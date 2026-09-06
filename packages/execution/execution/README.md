# @deepseek-ai/dsh-execution

Unified execution lifecycle state machine for DeepSeek Harness.

## Purpose

Provides an **observability-first** layer that projects execution states from multiple subsystems (jobs, goals, workflows, subagents, operations) into a single state machine without owning their lifecycles. Existing subsystems keep their native APIs; adapters map their statuses into the unified vocabulary.

## Normalised Statuses

| Status | Meaning |
|---|---|
| `CREATED` | Registered but not yet queued or started |
| `QUEUED` | Scheduled, waiting to be picked up |
| `RUNNING` | Actively executing |
| `WAITING_TOOL` | Blocked on a tool call |
| `WAITING_SUBAGENT` | Blocked on a subagent result |
| `WAITING_USER` | Blocked on user input/approval |
| `INTERRUPTED` | Interrupted, awaiting recovery or abort |
| `RECOVERING` | Recovering from interruption |
| `COMPLETED` | Successfully finished |
| `FAILED` | Terminated with error |
| `CANCELLED` | Cancelled by caller |
| `TIMEOUT` | Exceeded time limit |
| `ABORTED` | Force-aborted |

## Transition Table

```
(none) ─start/queue→ CREATED ─queue→ QUEUED ─start→ RUNNING ─complete→ COMPLETED
                                      │                    ├─fail→ FAILED
                                      │                    ├─cancel→ CANCELLED
                                      │                    ├─interrupt→ INTERRUPTED ─recover→ RECOVERING ─resume→ RUNNING
                                      │                    │                                   ├─abort→ ABORTED
                                      │                    │                                   └─fail→ FAILED
                                      │                    ├─timeout→ TIMEOUT
                                      │                    └─abort→ ABORTED
                                      ├─fail→ FAILED
                                      └─cancel→ CANCELLED

RUNNING ─wait-tool→ WAITING_TOOL ─resume→ RUNNING (cycle)
                    ├─cancel→ CANCELLED
                    ├─timeout→ TIMEOUT
                    └─abort→ ABORTED

RUNNING ─wait-subagent→ WAITING_SUBAGENT ─resume→ RUNNING
                                        ├─cancel→ CANCELLED
                                        └─timeout→ TIMEOUT

RUNNING ─wait-user→ WAITING_USER ─resume→ RUNNING
                     ├─cancel→ CANCELLED
                     └─timeout→ TIMEOUT

Terminal (COMPLETED/FAILED/CANCELLED/TIMEOUT/ABORTED) — no outgoing transitions
```

## v1 Scope

- **Projection/observation only.** The registry owns an in-process append-only event log.
- **No lifecycle management.** Native subsystems (jobs, goals, etc.) continue to own their execution.
- **Optional adapter.** Jobs adapter (in `dsh-jobs`) is safe: if `ctx.executions` is absent, jobs works unchanged via `ctx.get('executions')`.

## API

### `ExecutionService` (`ctx.executions`)

```ts
ctx.executions.register(kind, executionId, options)  // → CREATED state
ctx.executions.transition(executionId, eventCode)     // → new state (SM enforced)
ctx.executions.end(executionId, terminalStatus)       // → force terminal
ctx.executions.get(executionId)                       // → state copy | undefined
ctx.executions.list()                                 // → all states
ctx.executions.listByKind(kind)                       // → filtered states
ctx.executions.on(listener)                           // → subscribe to events
```

### Events

`ctx.emit('execution/event', { event })` for every appended event.

## Known Limitations and Deferred Work

- **Durability** — `ExecutionEvent` is in-memory only; persistence planned for v2.
- **Leases** — `resourceRef` field is reserved for T3 lease integration (v2).
- **Cross-process** — registry is process-local; no distributed coordination.
