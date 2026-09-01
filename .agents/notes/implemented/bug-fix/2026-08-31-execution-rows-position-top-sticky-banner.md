# Agent Note: Execution rows position with `top`, not `transform`, so sticky code banners stay at the block top

Status: implemented

English | [中文](2026-08-31-execution-rows-position-top-sticky-banner.zh.md)

## Problem

The execution timeline's expanded content renders every code surface through the shared `CodeBlock` (markdown fences, the details panel's raw args/output), whose copy banner is `position: sticky; top: 0` so the button stays reachable while a long fence is read. In the chat view the banner pins to the scrollport top correctly; in the execution view it did not. The virtual list positions each absolutely-placed row with `transform: translateY(offset)`, and a transformed ancestor becomes the sticky element's scroll context in Chromium — a context that does not scroll. The banner was therefore displaced to the bottom of its containing block: the copy button rendered at the bottom of the code block, and the banner's opaque fill (`--dsw-alias-bg-base`, `z-index: 6`) covered the block's last line(s), so the lower part of the code read as cut off.

## Decision

The execution view positions each row with the `top` property instead of `transform: translateY()`: the `rowSlot` keeps `position: absolute; left: 0; right: 0` and receives `style={{ top: layout.offsets[index] ?? 0 }}` in place of the transform. Nothing on the path from a row's content to the list scrollport now creates a transformed containing block, so `CodeBlock`'s sticky banner sticks to the `data-testid="execution-list"` scrollport exactly as it does in chat. The virtual window, measurement, follow-scroll, and jump-to-latest are unchanged — they read `layout.offsets` and the measured heights, not the positioning mechanism.

## Alternatives considered

**Make the code banner non-sticky inside execution rows.** Opting out of the sticky banner would keep the transform's composited scrolling, but the copy button would then scroll out of view on any fence taller than the scrollport, diverging from the chat view the user asked to match. Rejected.

**Keep the transform and fix sticky with CSS.** `position: sticky` under a transformed ancestor is broken in Chromium; no author stylesheet rule can restore it. Rejected.

## Consequences

- The execution view's code-block copy banner sits at the top of the block and pins to the list top while scrolling, matching the chat view.
- The banner no longer paints over the block's last lines, so the full code body stays readable.
- Row placement now triggers layout on scroll rather than compositor-only translation; the mounted window (visible range plus overscan) is small enough that the cost is negligible.

## Testing

Focused suites stay green: `execution-view`, `execution-virtual`, `execution-event`, and `execution-filter` (35 tests), plus the full `ui-conversation` package (33 files, 497 tests). A live-browser probe against the running `dsh web` server confirmed the behavioral fix: with a block aligned to the list top the banner sits at the block top (`bannerAtTop: true`), and with the block scrolled 150px past the list top the banner pins at the list top (`bannerTopVsList: 0`, visible) — the pre-fix state pinned the banner to the block bottom.
