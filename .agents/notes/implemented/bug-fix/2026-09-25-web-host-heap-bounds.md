# Agent Note: Bounded host heap for prepared sessions, stream frames, and history reads

Status: implemented

English | [中文](2026-09-25-web-host-heap-bounds.zh.md)

## Problem

The `dsh web` host process died twice in a row under a stress run with `FATAL ERROR: Ineffective mark-compacts near heap limit — JavaScript heap out of memory` (exit code 134, about 18 minutes of uptime, heap at 3430 of 3576 MB). One `session.history` call carried the measured cost: the host read a session's whole log, expanded its packed chunk runs into individual events, and kept the result. That log held 62,247 stored lines; the read produced 1,898,119 events and 575 MB of live heap while the response carried 21 KB to the client. The expanded result then stayed resident in the session-persistence coordinator's prepared-session pool, which bounded how many entries it retained but not what those entries weighed. One ready entry is one whole decoded log, so five entries of multi-hundred-thousand-event sessions reach gigabytes while the count still reads as five.

The stream path had the same shape of unbounded retention. The mux and host frame queues grew with whatever the session event bus produced while a browser was busy, and the SSE carrier pumped its source with a `for await` loop that never waited for consumer demand. Two attached-session reads also copied the session's whole event array per call.

## Decision

`SessionPreparations` bounds its ready set by retained weight as well as by entry count. The constructor takes `capacity`, `maxReadyWeight`, and `weightOf(source)`; `evictReady()` discards the oldest ready entries until both budgets hold, and an entry whose own weight exceeds the whole budget is never retained, so one oversized log cannot occupy the pool at all. `PersistenceCoordinator` supplies the weight as `source.inspection.events.length` and exposes `preparedSessionCacheMaxEvents` in `PersistenceCoordinatorOptions`, validated as a positive safe integer next to `preparedSessionCacheSize`. `DEFAULT_PREPARED_SESSION_CACHE_MAX_EVENTS` is 500,000 and is re-exported from `@deepseek-ai/dsh-session-persistence`.

Both first-party backends carry the same field in their Schemastery `Config` with that default and pass it to the coordinator: `@deepseek-ai/dsh-session-persistence-jsonl` and `@deepseek-ai/dsh-session-persistence-sqlite`. Their READMEs document the field and the defaults.

`FrameQueue` in `@deepseek-ai/dsh-host-apiproxy` holds at most `MAX_QUEUED_STREAM_FRAMES` (4096) frames. At the limit it discards the oldest frame whose state the consumer can rebuild rather than growing, counts the drop, and reports the running total through `uiDebugTick('mux', 'drop', …)`. On the mux stream only a `session/event` frame is recoverable: the client notices the seq gap and repulls the tail through `repairGap`. A frame that changes client-held state the consumer cannot relearn any other way — `question/*`, `approval/*`, list state — is never dropped for a later frame. When the queue holds no recoverable frame, the stream ends so the client resubscribes instead of the host retaining a backlog. The host stream declares every frame unrecoverable (`() => false`), so its full queue ends that stream and the reconnect refetches the lists.

Two per-call event-array copies are gone. `readSessionState` and the attached branch of `subagent.history` serve `attached.events` — already the frozen `Session.events` snapshot — instead of a spread copy.

`sseResponse` in `fetch/handler.ts` pulls one frame per consumer read instead of pumping the source with `for await` and `controller.enqueue`. `cancel()` closes the frame source through `iterator.return()`, and `closeQuietly` closes a controller the consumer may already have cancelled.

History requests are bounded at the schema: `MAX_HISTORY_MESSAGES` (1,000) caps `maxMessages` in both `sessions.schema.ts` and `subagents.schema.ts`.

## Alternatives considered

- **Keep the entry-count-only preparation bound.** Rejected: capacity counts entries while each entry is a whole decoded log, so the count alone bounds nothing about heap; the weight budget is what makes a heavy log unretainable.
- **Evict reserved or committing entries to free weight.** Rejected: a reservation is an exclusive owner holding the exact Session through publication, so weight eviction stays limited to ready entries and never breaks an in-flight resume.
- **Drop the oldest frame regardless of what it carries.** Rejected: an approval or question frame is the only carrier of a state the client must answer, and losing it strands the interaction until a reconnect replays it.
- **Keep the `for await` pump with `controller.enqueue`.** Rejected: the frame source pushes from the session event bus and never waits, so a pump that does not await consumer demand buffers everything the host produced while the browser was busy. The pull loop keeps at most the source's own bounded queue in flight.
- **Rely on the client's own `maxMessages` value.** Rejected: the bound exists to keep a hand-written request from asking the host to assemble an enormous message window in one call, so it belongs where the host validates the payload.

## Consequences

- A coordinator retains at most `preparedSessionCacheMaxEvents` stored events across its ready entries, with `preparedSessionCacheSize` still bounding the entry count. A log heavier than the budget is never retained, so the next read reloads it instead of reusing it; the default budget must therefore stay above a working session's event count, or that session pays a full decode per page.
- Both defaults are deployment-configurable per backend: `preparedSessionCacheSize` 5 and `preparedSessionCacheMaxEvents` 500,000.
- A stalled mux consumer loses oldest-first `session/event` frames and repulls the tail; a mux queue holding nothing recoverable, and any full host-stream queue, ends the stream.
- One history request can ask for at most 1,000 messages; the page's event cap remains the bound on the response itself.
- The bound covers retention and copying, not the physical cold read: JSONL in both encodings still parses the whole artifact, so a cold `session.history` on a session whose log exceeds the weight budget materializes that log again on every call. Per-page windowed reads from disk — the JSONL read starting at a requested `beforeSeq` — remain the open remainder, and `readFrom` bounds what it returns rather than what the backend parses.

## Testing

`packages/session/session-persistence/tests/preparations.spec.ts` pins weight eviction with `evicts the oldest ready source once the retained weight exceeds the budget` and `never retains a single ready source heavier than the whole budget`, both through the `preparationsOf(capacity, maxReadyWeight, weightOf)` helper. `packages/session/session-persistence/tests/persistence.spec.ts` pins the coordinator-level regression with `never retains a prepared log heavier than the cache weight budget`, which observes two backend loads for two inspections of a session whose log exceeds a 1-event budget, and rejects an invalid budget with `rejects invalid preparation cache weight budget`. `packages/host/apiproxy/tests/fetch-carrier.spec.ts` covers the SSE cancel path through `drops frames after the consumer aborts mid-stream` and `swallows a reader.cancel rejection on early exit`.

The `FrameQueue` frame bound, the dropped-frame counter, and the `MAX_HISTORY_MESSAGES` ceiling have no dedicated test.

## Related

- [Reusable Session preparation before publication](../architecture/2026-08-05-session-preparation.md) owns the prepared-session lifecycle and the ready-entry LRU that now carries the weight budget.
- [Bounded web history pages and restored session feed](2026-09-17-web-session-feed-after-refresh.md) owns history page sizing (`MAX_PAGE_EVENTS`) and the client's live window trim.
- [Web live catch-up, mux backpressure, and Roy pool leases](2026-09-17-web-live-catchup-and-roy-pool.md) owns the client-side mux pump and the reconnect stitching this queue's `end()` path feeds.
