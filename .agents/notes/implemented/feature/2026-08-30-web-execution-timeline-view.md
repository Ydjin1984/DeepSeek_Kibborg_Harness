# Agent Note: Web execution-trace timeline view

Status: implemented

English | [中文](2026-08-30-web-execution-timeline-view.zh.md)

## Problem

The Web conversation renders agent steps as a chat flow: tool rows, assistant markdown, commands, and turn tails follow one another without a shared timeline vocabulary. A reader cannot see at a glance what the agent is doing, which file it is changing, which command is running, what has failed, or what the trace contains as a whole — there is no per-event type/status/clock chrome, no summary header (counters, current action, plan, touched files), no search or category filtering over the trace, and no virtualization, so a long autonomous run renders thousands of nodes unconditionally.

## Decision

`ui-conversation` gains a second view-ring entry, the execution view (`id: 'execution'`, order 5), and it becomes the conversation default (the chat view stays one tab away; a persisted selection or a profile without the entry still falls back to Chat). The view is a pure presentation layer over the existing conversation snapshot — the execution engine, the session event pipeline, and the chat flow are untouched.

**Normalized event model.** The new `execution/` domain projects each final Chat node into a normalized `ExecutionEvent` (`execution-event.ts`): type (analysis/thinking, tool_call/tool_error, command, file_read/edit/write/create/delete, git_*, task_completed/task_failed, warning, user_message, …), category (the toolbar filter buckets), status (running/success/warning/error/info), headline title/description, touched path, diff line counts, and duration. Type mapping is derived from the node kind plus the wire tool name; diff counts and paths come from the tool render-intent views (`card: 'diff'`), the same source the chat diff cards use. `execution-summary.ts` folds the events into the header facts: turn/step/tool/error counters, the current action (latest running event, streaming partial, or idle), and per-file activity (status letter, added/removed lines, first touching event for scroll-to-file).

**One shared node seat.** Slots allow one declarer per key, so Chat and the execution view cannot each declare `'conversation.chat.node'`. The declaration (plus `'conversation.message.images'`) moves from the chat entry up to the `'conversation.session'` body entry, and the body hands `renderChatNode` and `renderMessageImages` to every view through the `'conversation.view'` owner share (`ConvViewOwnerProps`). ChatNodeSeat and the execution row dispatch through that callback, so ui-tool's per-tool renderers (diff/terminal/read/search/web cards), assistant markdown, and command rows render identically in both views through one dispatch site. The session body's inject gains `loadImage`; the view inject (`ChatViewInjected`) drops it.

**Timeline presentation.** One row per event: leading icon, wall clock, type badge, headline fields, diff counts, duration, status dot, and an expand chevron; the expanded body renders the owning Chat node through the shared seat (default-collapsed for technical rows, expanded for prose). The sticky header projects the session title, run-state chip, counters, current action, the `todos` projection as a plan strip, and the touched-files list (click scrolls to the first touching event). The toolbar provides free-text search (highlighted matches), category chips (All/Analysis/Tools/Files/Terminal/Git/Errors/Success), expand-all/collapse-all, and follow-scroll with jump-to-latest. The event list is a windowed virtual list with measured row heights (`execution-virtual.ts`), so only the visible window plus overscan mounts; streaming appends re-derive from the swapped chat snapshot without remounting rows. Copy, ANSI terminal, diff, and markdown surfaces come from the existing primitives (`DiffBlock`, `TerminalBlock`, `CodeBlock`/`MarkdownText`, `StateDot`, `JsonBlock`); the view owns its scrollport via the existing `data-conversation-composer-overlay` pattern and rebinds the scrollbar indirection to the l2 pair.

## Alternatives considered

**A separate `ui-execution` plugin package.** The view must render `'conversation.chat.node'`, which is declared once by ui-conversation; a new package cannot re-declare it (one declarer per slot) and cross-package value imports are forbidden by the client package rules, so it would have to reimplement every node renderer. Rejected.

**Reimplement node rendering inside the execution view.** Duplicates ui-tool's cards and markdown surfaces and violates the "one specialized renderer per event" direction. Rejected; the shared seat keeps one dispatch site.

**Keep Chat as the default view.** Lower risk, but the trace view would be one tab away and the product would keep the old surface as the primary experience. Rejected; stale persisted selections and benches without the entry still fall back to Chat (`resolveActiveView` falls back to the default, then the `chat` tab, then the first tab).

## Consequences

Chat behavior is unchanged: the flow, paging, streaming isolation, and composer interplay keep their tests, and the node-seat declaration move keeps the same ledger spec (`kind: 'keyed'`, `scope: 'session'`, turn-data inject). Existing real-machinery suites in ui-tool now restore the chat view through the persisted per-session selection, and the conversation suites assert the expanded ring. Long traces stay responsive: the virtual list mounts only the visible window, rows measure their own heights, and the header summary derives incrementally from the snapshot. The execution view is a presentation layer only — nothing new reaches a model request, and no session event was added or changed.
