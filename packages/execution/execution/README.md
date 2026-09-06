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
ctx.executions.resources.acquire(opts)                // → ResourceLease
ctx.executions.resources.heartbeat(resourceId)        // → extend TTL
ctx.executions.resources.release(resourceId)          // → released
ctx.executions.resources.get(resourceId)              // → lease copy | undefined
ctx.executions.resources.list()                       // → all lease copies
ctx.executions.resources.status(resourceId, now?)     // → fail-closed status
ctx.executions.resources.sweep(now?)                  // → orphaned leases
ctx.executions.resources.isLive(resourceId, now?)     // → boolean health check
```

### Resource Lease Registry

Tracks external resource leases (chrome, pty, ida, workspace, subprocess) with:

- **Lease acquisition** — sets TTL, optional provider, owner execution, recovery strategy.
- **Heartbeat** — extends TTL from the heartbeat moment.
- **Orphan sweep** — detects expired leases, transitions to `orphaned`.
- **Fail-closed helpers** — `status()` and `isLive()` for quick health checks without mutation.

### Events

`ctx.emit('execution/event', { event })` for every execution lifecycle event.

`ctx.emit('executions/resource', { event })` for every resource lease event (acquire, heartbeat, release, orphan).

## Known Limitations and Deferred Work

- **Durability** — `ExecutionEvent` is in-memory only; persistence planned for v2.
- **Resource leases** — `resourceRef` field is reserved for T3 lease integration in `ExecutionState`; the actual linkage from execution to resource (T3-v2) is a future slice.
- **Resource registry durability** — `ResourceLeaseRegistry` is in-memory only (v1); durable resource events and crash reconciliation from SQLite are planned for v2.
- **Cross-process** — registry is process-local; no distributed coordination.
