# Agent Note: Web live catch-up, mux backpressure, and Roy pool leases

Status: implemented

English | [中文](2026-09-17-web-live-catchup-and-roy-pool.zh.md)

## Problem

After a Host reload the web transcript stayed blank or crawled while Telegram already showed the turn: cold `session.history` listed every session then decoded the whole JSONL log, reconnect wiped `subscribedLastSeq`/`liveBuffer` and the on-screen window, live events grew without a cap, the default Execution view did not re-follow last-row growth, and the mux downlink awaited every `assistant/chunk` on one socket with no keepalive. The orchestrator swarm advertised 429 retries and a free-model pool, but the head deny list was empty and stale, spawn results carried no diagnostic, OpenRouter's default route clobbered the paid `openrouter` profile, and a minute-limit 429 spent the model's whole UTC day.

## Decision

Cold inspect no longer lists the home first; history pagination walks the live array and slices only the page. Reconnect keeps the current window, the mux baseline, and the live buffer, then stitches. The client trims the live window to one history page of messages. The mux pump pings and waits only at a high-water mark. Execution follow observes the flow's size. The head deny list defaults to `grep`/`glob`/`pwsh`/`bash` and is read live. Spawn `turn/end` errors become `diagnostic` so a 429 retries. The free pool publishes `openrouter-free`, refuses a lease until that route is published, treats a short 429 as a minute cooldown, and requires an API key to scan.

## Alternatives considered

**Seekable JSONL tail reads.** Sequential zstd frames still have to decode from the start; changing the on-disk layout is a format bump. Rejected for this fix; pagination and skipping `list()` remove the extra full-home scan and the discarded copy.

**Virtualizing ExecutionView.** The default tab stays the trace; a virtualizer is a larger UI rewrite. Follow-on-growth plus the live window cap remove the unbounded React tree first.

**Keeping Telegram's in-process path as the web transport.** The web client is a different process; mux remains the wire. Backpressure and ping keep that wire from stalling a long tab.

## Consequences

- A reconnecting tab keeps showing the previous window until history lands, then stitches live frames the host already sent.
- A long tab cannot grow the assembler past one page; older messages stay behind `hasMore`.
- Enabling orchestrator without filling `headDenyTools` now hides recon tools from the head. Operators who want the head to grep must empty the list.
- Existing `llm-pi-ai` `providers.openrouter` profiles are no longer overwritten by the free pool. Saved `providerRoute: openrouter` in the pool's own section still publishes under that key until changed.

## Testing

Host pagination and inspect: `packages/host/apiproxy/tests/api-proxy-view.spec.ts`, `packages/api/remotes` inspect path. Client session resync: `packages/client/runtime/tests/session.client.spec.ts`. Mux pump: `packages/client/connection/tests/websocket-downlink.host.spec.ts`. Orchestrator composition and policy: `packages/context/orchestrator/tests/composition.spec.ts`. Pool catalog/limits/schedule: `packages/llm/llm-openrouter-free/tests`. Spawn diagnostic: in-process driver specs. Skill manager deny and `presentCall`: `packages/skill/skill-manager/tests`. Fetch IPv6: `packages/web/web-fetch-http/tests`.
