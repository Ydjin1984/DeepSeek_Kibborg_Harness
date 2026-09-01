# Agent Note: Web GUI keeps running background subagents live and visible

Status: implemented

English | [中文](2026-08-30-web-live-background-subagents.zh.md)

## Problem

Background subagents in the Web GUI appear hung until the user opens them: the client's `SessionManager` deliberately drops `session/event` frames for sessions whose window was never opened ("no lazy build; history backfills on open"), and `Session.acceptLiveEvent` discards live events while a window is cold. A spawned subagent therefore shows only a "running" state in the sidebar; its transcript never moves. Opening the child backfills the whole history and live streaming starts, which reads as "switching to the subagent makes it work".

The server side was verified healthy: a probe subagent spawned from a live session completed its full turn (background job, `job_output`, report) while the parent kept working, and a live stalled-looking parent/child pair was found to be inside legitimate bounded `job_output` waits (up to the 10-minute cap), not a deadlock.

## Decision

Make running subagent children live on the client and visible in the sidebar, without touching the server loop.

### Client: auto-open running subagent windows (`dsh-client-runtime`)

`SessionManager` opens the window of a running subagent child at three hooks, all idempotent through `Session.open()`:

- catalog refresh completion (`refreshSubagents`): every entry reported `running` opens its window, using the catalog entry as the authoritative `mode` for history routing;
- `host/session-status` with `running: true`: opens the window when the address is known (retained or catalogued); otherwise loads the parent's catalog first, because guessing `mode` would misroute a one-shot child's history;
- the first `session/event` frame for a known running child: opens the window so the very frame is consumed instead of dropped.

The address is retained for later navigation (`selectSubagent`), and `SessionRuntime.followCurrent` still opens the selected session as before — switching to a child that already has a live window is a pure focus action.

### Server: `subagentActivity` projection (`dsh-subagent`)

A new projection unit folds `turn/start`, `tool/call`, `assistant/message`, and `turn/end` into `{ status: 'running' | 'idle', detail }` where `detail` is the last tool name or a bounded (60-char) whitespace-collapsed reply snippet. The api-proxy's `session/projection` broadcast drops this key for non-subagent sessions, so ordinary sessions push no extra frames. The subagent catalog row (`SubagentCatalogAction`) renders `detail` in the secondary line while the child is running.

### Rejected: periodic "poke" of background children

A watchdog that re-sends a message every few seconds would wake the model per poke — an LLM request per child per interval — and the server already executes children correctly; the symptom was visibility, not execution. Poking would burn tokens without fixing the display.

## Consequences

- **Memory**: each running child keeps an open event window on the client, bounded by the number of concurrently running children.
- **Wire**: at most one `session/projection` frame per tool call or assembled message per subagent-origin session.
- **History routing**: a mode-unknown child's window opens only after its parent catalog lands; the frames dropped in that window are covered by the existing open/backfill machinery.

## Testing

- `manager.client.spec.ts`: catalog refresh opens a running child's window; a status frame opens it when the catalog lags; a catalogued child opens immediately from its status frame.
- `activity-projection.spec.ts`: fold over turn/tool/message boundaries, text bounding, stable-reference no-ops, registry registration.
- `api-proxy-projections.spec.ts`: `subagentActivity` frames reach mux consumers only for subagent-origin sessions.
- `conversation-ui.client.spec.tsx`: the running child row shows the activity detail; an idle child omits it.
- `pnpm run test:gui` green except one pre-existing unrelated `ui-settings-models` provider-form failure. The full web e2e replay gate could not run here: the root package's `lib/types/{index,invariant,startup}.js` entry has never existed on this checkout, so `pnpm run build` stops at the tsdown step before the browser lane; the subagent e2e snapshots were inspected instead and capture only inactive children, which this change leaves byte-identical.

## Working-tree repair (same change)

This checkout carried an unfinished `git stash pop` from the runtime `sessions/*`/`agents/*` → `contract/*` refactor: three files with explicit conflict markers (`contract/notifier.ts`, `contract/agent-scope.ts`, `contract/conversation-snapshot.ts`) plus two silently corrupted by auto-merge (`contract/pending.ts`, `contract/context-provenance.ts` had become self-referential shims, dropping the `PendingWait` class and the provenance functions). The conflicts were resolved keeping the refactor's contract/ implementations (the old-path shims already exist and the import graph requires the class at contract/), and the two corrupted files were restored from HEAD. This was required to run the client suites at all; the pre-existing `ui-settings-models` failure remains.
