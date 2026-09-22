# Agent Note: Conversation activity journal and reader-controlled follow

Status: implemented

English | [中文](2026-09-19-conversation-activity-follow-and-code.zh.md)

## Problem

The conversation's execution trace repeated labels and borders around every action, while long histories mounted too many rows. Chat and Trajectory could move the viewport when a reader was inspecting older content, and the composer did not distinguish user-authored fenced code from references or commands. A file path in a collapsed action did not consistently expose its logged preview.

## Decision

Execution projects the existing Chat nodes into grouped rows only where a recorded turn or step starts. Numbered turn headings and collapsed action rows keep user and assistant text from repeating; a separate keyboard button on a file path reveals the logged Read or Diff card. Its measured virtual window keeps stable node keys and delegates expanded content to the existing tool renderers. Chat and Execution derive a bounded prompt rail from loaded user and steering nodes. The same pure follow reducer handles intentional reader departure, manual return to the bottom, a jump in progress, and interruption. Each view owns DOM scrolling and stores a transient reading anchor in the mounted Session shell; Trajectory uses its virtual row key and offset across older-page prepends. Stream height changes schedule at most one frame write while following, and the jump respects reduced-motion settings.

The initial session request retains a bounded tail window. Execution exposes the same older-page request as Chat, and the prompt rail presents a load control while earlier events remain outside that window, including when no prompt is loaded. Request ticks are derived only from loaded user and steering nodes; the interface does not imply that hidden history has been indexed.

Authored triple-backtick fences are segmented by UTF-16 offsets without changing the submitted text. The native textarea retains selection and caret behavior; its aligned backdrop highlights code, and sent user messages use the existing CodeBlock. Reference and command triggers inside a fence remain literal. A fence without a closing delimiter owns the remaining draft.

Message fences place the copy banner before the code body in normal flow; a sticky banner could be constrained to the bottom of a short block after the page scrolled. Settled assistant and sent user fences show line numbers and highlight declared languages. Unlabeled fences infer common source syntax conservatively, while diagrams remain plain and streaming replies defer highlighting until settlement.

The pure reducer and scanner live in ui-primitives, which the client module table already shares with both UI plugins. This avoids a value import between conversation and trajectory or input-trigger plugins. No session event or model request format changes.

## Alternatives considered

**One scroll listener that always tracks the bottom.** Rejected because programmatic layout updates and reader gestures have different intent; it would steal the viewport during reading.

**A full list for every execution history.** Rejected because expanded tool cards are costly and the DOM would grow with every event; measured virtualization retains the existing card only when visible.

**A new file preview assembled from the filename.** Rejected because the logged tool card owns exact lines, language, diff, and errors. A path is navigation to that evidence, not a source for invented content.

**A custom rich-text input.** Rejected because the native textarea already owns composition, caret, selection, and accessibility. The backdrop can add visual structure without replacing editing semantics.

## Consequences

Readers control when new actions keep the tail visible. Prompt ticks refer only to loaded history, and switching tabs retains a reading location for the current session. The journal's compact row remains readable without mounting every detailed tool view. UI primitives gain two pure helpers shared by multiple plugins; the presentation remains transient and adds no durable log traffic.

## Testing

Focused client tests cover grouping, fences, reference detection, file expansion, prompt navigation, bounded execution rows, follow transitions, one-pixel reader departure, streaming height changes, and virtual-row bookmark restoration. Keyless assembled web fixtures in [conversation-feed.snapshot.ts](../../../../apps/web/tests/conversation-feed.snapshot.ts) and [user-code-fences.snapshot.ts](../../../../apps/web/tests/user-code-fences.snapshot.ts) pin grouped actions, a logged read card, and an authored code draft sent through built plugin bundles.

The existing long-history browser benchmark assumes a session-count label and a fully mounted sidebar. It stops before trace timing measurements against the current virtualized sidebar; the bounded Execution DOM tests establish cardinality, not frame-time or memory targets.
