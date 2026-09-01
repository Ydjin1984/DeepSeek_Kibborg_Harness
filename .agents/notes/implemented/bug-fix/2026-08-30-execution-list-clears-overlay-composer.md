# Agent Note: The execution list reserves the overlay composer's height

Status: implemented

English | [中文](2026-08-30-execution-list-clears-overlay-composer.zh.md)

## Problem

The Execution tab opts into the composer-overlay seat: the composer seat is absolutely positioned against the scroll body's bottom edge while the execution view fills the whole column, so the event list's scrollport extends under the seat. The seat paints an opaque input card plus a 36px fade band (the Chat input mask) over the bottom of the viewport, so the newest trace events — the tail follow-scroll keeps pinned — scroll under the composer and the run's progress is not visible to the end. The jump-to-latest pill sticks at the scrollport floor, which the seat covers, so the pill is unreachable on this tab.

## Decision

The execution list reserves the overlay composer's live height as bottom padding: `padding-bottom: calc(var(--dsh-composer-height, 152px) + 16px)` on the list scrollport, and the jump pill's sticky bottom clears the seat with the same variable. ConversationRoot already publishes the seat's live height as `--dsh-composer-height` on the scroller (the seat observer), so the reservation follows a growing draft; the 152px fallback covers the first paint before the observer fires. The trace tail therefore rests just above the composer seat, fully visible, and the fade band covers only the reserved empty strip. The pattern mirrors the trajectory view's bottom clearance ([trajectory inspection ledger](../feature/2026-07-27-trajectory-inspection-ledger.md)); the overlay seat's horizontal geometry stays with the [width-compensation note](../bug-fix/2026-08-12-composer-overlay-seat-width-compensation.md).

## Alternatives considered

**Remove the input-mask fade for overlay views.** Deleting the band alone still leaves the last rows behind the opaque input card, so the tail stays hidden. Rejected.

**Reserve at the shared overlay branch** (the `.scrollBody:has([data-conversation-composer-overlay])` cascade in ConversationRoot). A shared reservation would also pad the trajectory view, which already reserves its own clearance, doubling the gap. The view-local pattern keeps each overlay view's clearance with the view that needs it.

## Consequences

- The Execution tab shows the full trace tail above the composer; follow-scroll keeps the newest event visible.
- The jump-to-latest pill is reachable on the Execution tab instead of sticking behind the seat.
- The reservation rides `--dsh-composer-height`, so a taller composer (growing draft, dock cards) keeps the same 16px clearance; the fade band is invisible because nothing scrolls under it anymore.
- Chat's input-mask fade is unchanged: Chat's own scrollport model keeps the mask over scrolling content by design.

## Testing

The change is presentation-only CSS in the execution view; the ui-conversation client bundle rebuilds cleanly and the live `/plugins/@deepseek-ai/dsh-client-ui-conversation/client.js` route serves the new clearance, so a page refresh shows it. Doc gates pass for the touched files (translation pairing, agent-note format, md wrap/links). `pnpm run test:gui` passes all suites except one pre-existing in-flight failure in `ui-settings-models/tests/provider-form.client.spec.tsx` (the SuperGrok OAuth card), which predates and is independent of this change; the execution-view suites run green.
