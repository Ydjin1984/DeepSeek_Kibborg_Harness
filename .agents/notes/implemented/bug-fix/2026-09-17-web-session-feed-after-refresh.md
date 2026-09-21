# Agent Note: Bounded web history pages and restored session feed

Status: implemented

English | [中文](2026-09-17-web-session-feed-after-refresh.zh.md)

## Problem

After a browser refresh on a long-lived web session, the conversation tab could paint tens of thousands of execution rows before the ask-user popup appeared. Host logs showed `session.history` returning 40k–70k events for `maxMessages=50`, `session.list` taking 12–19s over ~1,700 cold rows, `subagent.list` repeating 2–4s inspections, and mux downlinks of 5–8k frames/s. Chrome then reported forced reflow and long `setTimeout` tasks while the Telegram mirror button leaked `AbortError` on unmount.

History pagination and the live client window counted only `user/message` and `assistant/message`. A session with fewer than 50 such messages kept every chunk and tool event on one page (`hasMore=false`). Ask-user frames shared that FIFO with `session/event`, so a live question sat behind the backlog until a new mux socket replayed `pendingQuestions`.

## Decision

`paginateWindow` in `@deepseek-ai/dsh-host-apiproxy` counts the requested append-origin messages and caps each response at 400 events. The event cap does not start a page inside a message group: an incomplete oldest group is dropped when a later complete turn still fits; otherwise the page starts at that group's finalized message so the assembler does not see orphan chunks. A chunk-heavy turn can yield a short page with `hasMore=true` instead of the whole log. On open or reconnect, the client requests 500 messages and prepends consecutive pages until it has 500 or reaches the log start. Each explicit older-history action adds up to 100 messages, even when the 400-event limit splits that batch across RPCs. An empty, failed, or discontinuous page ends the current batch.

`Session.trimLiveWindow` trims only after a completed message. It retains at least the 500-message opening target plus any explicitly loaded older messages, with a 200-message headroom before count-based trimming. The raw-event target is 12,000 events, but preserving the requested messages takes precedence, so a chunk-heavy window can exceed it. Streaming chunks do not rebuild the conversation window on every event.

If a gap repair replaces the window while an older-history request is in flight, the response for the old `beforeSeq` is discarded and the batch restarts from the new head. Previously that response failed continuity against the repaired head, set `hasMore=false`, and left only the capped tail visible.

Cold inspect uses `persistence.inspect(sessionId)` and maps the backend miss `session "<id>" not found` (and a header without `cwd`) to `ApiRemoteSessionNotFound`. It does not call `persistence.list()` to prove absence.

`FrameQueue.prepend` plus `enqueueMux` put `question/*` and `approval/*` frames at the head of each mux downlink. Host logs `mux.question.enqueue`; the client logs `session.question.requested`.

`ExecutionView` follows the tail with one `requestAnimationFrame` write of `scrollTop`. Its measured virtual rows bound mounted DOM while older pages remain navigable. ResizeObserver no longer reads geometry into React state on every growth.

`listVisibleSessionSummaries` batches cold rows 64 at a time and still probes when cached `blank` is not `false`. `subagents.list` reuses a successful parent catalog for 3s. `listChildren` inspects up to 16 cold children at once. `TelegramMirrorButton` aborts its status probe on unmount and ignores `AbortError`.

## Alternatives considered

- **Keep the live window at 400 raw events** — rejected after the feed vanished during chunk-heavy streaming and refresh showed only the final actions. The Host response stays bounded while client retention follows completed message groups.
- **Keep catalog `list()` before inspect** — rejected: proving a miss by enumerating every home session is what made a single history read cost a full catalog scan.
- **Skip cold blank probes when metadata exists** — rejected: a stale `blank: true` must be re-probed or listing hides a conversation that already has turns.
- **Cache failed subagent catalogs** — rejected: a cancelled or internal miss must not pin an empty sidebar for 3s.

## Consequences

- A history response is at most 400 events on the wire. Opening restores up to 500 append-origin messages; each older-history action adds up to 100, and the loaded window remains available while the session streams.
- A live ask-user or approval frame is delivered ahead of a `session/event` backlog on the same mux socket.
- `session.list` still probes unknown or stale-blank rows; it no longer serializes those probes 16 at a time.
- Telegram mirror unmount during navigation is not a console `AbortError`.
- ExecutionView virtualizes long row lists; expanded details still render through the existing logged tool cards.
