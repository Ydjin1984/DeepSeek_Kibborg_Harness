# Agent Note: Durable ExecutionEvent journal is a composition-side JSONL listener

Status: implemented

English | [中文](2026-09-07-execution-event-durable-jsonl-journal.zh.md)

## Problem

`ctx.executions` and the resource lease registry keep state in memory. Their `execution/event` and `executions/resource` Cordis events vanish on process restart, so there is no host-side audit trail of machine-truth execution history. Session events remain the model-visible log; mixing execution machine-truth into `SessionEventMap` would couple two different reconstruction jobs and force every session reader to understand job/goal/workflow/subagent leases.

## Decision

`@deepseek-ai/dsh-execution-persistence` is a function plugin in `packages/execution/execution-persistence`. It listens to `execution/event` and `executions/resource` and appends one JSON line per event to `<root>/events.jsonl`. The `dsh-execution` package stays free of persistence imports. Shipping profiles mount the plugin from `dsh-base` (`id: execution-persistence`) with `enabled` defaulting to true.

Each line is `{"kind":"execution"|"resource","ts":<epoch-ms>,"event":<payload.event>}`. The writer opens the file append-only, writes, `fsync`s, and closes; overlapping emits share one per-plugin promise chain. Write errors go to `ctx.logger.warn` and do not reject the emitter. Dispose waits for in-flight writes, then drops further events.

`root` is a Config field. When omitted or whitespace, the directory is `dshHomePath('executions')` (`$DSH_HOME/executions`, else `~/.dsh/executions`). Tests pass an explicit temp `root`.

This slice does not rebuild in-memory execution or lease state from the file. Jobs, goals, workflows, and subagents continue to project live status into `ctx.executions` after restart.

## Alternatives considered

- **A new `execution_events` table in the session SQLite database** — rejected for this slice. The shipped `dsh-base` profile stores sessions in JSONL (`session-persistence-jsonl` at `$DSH_HOME/sessions`) and mounts `session-query-sqlite` with `path: ':memory:'` and `openAt: never`. `ctx.sessionPersistence` does not expose a raw `DatabaseSync`, so a bridge plugin cannot share that database without new session-persistence APIs and a schema bump. A dedicated JSONL file matches the existing append+fsync pattern and stays testable without SQLite.
- **Appending execution records into the session log** — rejected: SessionEvent is model-visible truth; ExecutionEvent is machine truth. Sharing one log would make every session reader handle execution internals and would violate model-visible ⟺ logged for events that must not reach the model.
- **Persistence inside `dsh-execution`** — rejected: that package is the in-memory state machine. Durability is a composition-side listener so the service remains replaceable and free of filesystem policy.

## Consequences

Profiles that include `dsh-base` write `$DSH_HOME/executions/events.jsonl` whenever those Cordis events fire. Disk use grows with execution traffic; there is no rotation in this slice. A crash can leave a truncated last line; readers must skip an incomplete tail. Reconstructing `ctx.executions` from the journal, torn-tail repair, and multi-process writers are later work.
