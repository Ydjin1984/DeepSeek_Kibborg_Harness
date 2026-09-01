# Agent Note: The execution follow-scroll pins to the floor through height growth

Status: implemented

English | [中文](2026-08-30-execution-follow-scroll-pins-to-floor.zh.md)

## Problem

The execution view's follow-scroll re-scrolled only when the visible row count changed (`visibleKeys.length`). A new row mounts with the 36px estimate and the follow lands at that floor; the row's measured height then lands (or grows in place), moving the floor down, and nothing re-follows — so a pinned reader loses the trace tail below the fold until the next event arrives. The pin/unpin ownership (scroll away to unpin, scroll to the floor to re-pin) was already in place and correct.

## Decision

The follow effect now depends on the whole flow size and the scrollport height — `[visibleKeys.length, layout.total, viewport]` — so while the reader is pinned it re-scrolls to the floor whenever the flow grows: a new row, a measured height landing, in-place row growth, or a scrollport resize. The `layout.total` and `viewport` values are already tracked state (measured heights and the scrollport ResizeObserver), so no new machinery was added. The pin/unpin ownership is unchanged: scrolling away from the floor beyond the 24px threshold unpins, and scrolling back to the floor re-pins. The follow re-scrolls to the same reserved floor as the [composer-clearance fix](../bug-fix/2026-08-30-execution-list-clears-overlay-composer.md), so the tail rests just above the composer.

## Alternatives considered

**Observe the scrollport with a ResizeObserver like ChatView.** ChatView re-follows on column resize through an observer; the execution view already tracks the same facts as state (`layout.total` from measured heights, `viewport`), so an observer would duplicate machinery. Rejected.

**Follow only on new rows (previous behavior).** Keeps the effect quiet but leaves the drift that motivated this change. Rejected.

## Consequences

- A pinned reader always sees the trace tail; follow-scroll survives tall measured rows and in-place growth between events.
- Scroll-up still unpins and scroll-to-floor re-pins; the jump-to-latest pill remains the explicit re-pin affordance.
- The effect fires more often (every flow-size or viewport change while pinned), each a cheap `scrollTop` write that React bails on when the value is unchanged.

## Testing

New jsdom component tests in `execution-view.client.spec.tsx` drive a mocked scrollport: pinned + new event follows to the floor; scroll-up + new event stays put; scroll-to-floor + new event follows again; measured in-place growth while pinned re-follows. The file runs green in isolation (`pnpm vitest run packages/client/ui-conversation/tests/execution-view.client.spec.tsx`, 11 tests). The assembled GUI serves the rebuilt bundle through the `/plugins/<id>/client.js` route; the full `test:gui` suite state is governed by the in-flight refactor noted in the [composer-clearance note](../bug-fix/2026-08-30-execution-list-clears-overlay-composer.md).
