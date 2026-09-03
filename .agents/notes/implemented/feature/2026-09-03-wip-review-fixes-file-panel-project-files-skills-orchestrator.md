# Agent Note: WIP review fixes — file panel, project-file safety, skill manager, orchestrator

Status: implemented

## Problem

The WIP review (REVIEW-FINDINGS.md) found the working layer partially assembled: the workspace file panel rendered absolute Windows paths and swallowed listing failures, Chromium drag-and-drop was dead, writes could follow a symlink out of the project and clients could raise the read cap above the server bound, the skills manager bounced every existing-skill save through a manual conflict step and painted success on failed version actions while flat `*.md` removal dragged the whole skills root into the trash, and the orchestrator let delegated children inherit the head prompt and the `executor` tool while advertising head model fields that never applied.

## Decision

- **Workspace file panel (`ui-files`)** — tree rows render base names for POSIX and Windows paths (`baseNameOf`); rows carry VSCode-style glyphs (an amber folder with an open state, monogram badges for common source/config formats, a neutral page otherwise) with colours in the CSS module; hidden entries are visually muted; `listChildren` failures surface as an inline row with a retry instead of an empty folder; `dragover` inspects only `dataTransfer.types` (Chromium returns an empty `getData` before `drop`); the Markdown dialog cannot resurrect itself when a save settles after close.
- **Project-file safety (`apiproxy`)** — `canonicalProjectPath` now realpath's and containment-checks an existing final component for every operation, so writes never follow a symlink out of the project; `readProjectTextFile` size-checks via `stat` before buffering; both text verbs clamp a caller-supplied `maxBytes` to the server bound so a client cannot raise the cap.
- **Skills manager** — the editor saves existing skills with `replace: true` on the first click (the manager snapshots the previous body as a version); version activation/rollback re-throws after surfacing so the dialog never paints success on failure; `remove()` of a flat `*.md` skill (whose directory is the skills root) trashes only the file; trash entries for flat markdown carry the public (frontmatter) name without `.md`, and `restore()` returns the file under its original on-disk name so discovery sees it again; `save`/`publishVersion` reject a body whose frontmatter name differs from the managed name (renaming is delete-and-recreate); the bundled `skill-create` registration is guarded against a teardown that lands before its async load resolves; built-in cards render no Enable/Versions/Benchmark lifecycle actions.
- **Orchestrator** — the head prompt section renders empty for delegated agents (`delegationDepthOf > 0`), the `executor` tool refuses execution below the top level, and spawned executor children are scoped when the provider can honor it: `toolFilter.deny: ['executor']`, `maxDepth: 1`, and a compact worker persona — recursion is bounded on every path. The advertised-but-inert head route fields were removed from the schema, codec, UI, and prompt: the head is the session's live chat model; module JSDoc, runtime error copy, and the card all point at Settings → Models → «Оркестратор», the executor call presents with `kind: 'execute'`, and the tool is serial (`isConcurrencySafe: false`) so overlapping executor runs cannot race over shared files. The mode mounts and runs only with a complete provider+model route — no vendor default remains, and the UI form refuses to enable without one. All registration lives in one `ctx.effect` with a disposer (settings watcher, tool, prompt section), and the summarizer's budget rejection now always closes the abandoned iterator instead of relying on a flag oxlint proved dead.

## Alternatives considered

- **Applying the head route to the session model.** Rejected: the composer picker owns the live model; faking a second owner would fight the existing selection machinery. Removing the fields makes the contract honest.
- **Keeping the conflict panel behind a `skill-conflict` catch.** Rejected: with `replace: true` the manager never raises that code for an in-place edit, so the panel was dead UI.
- **Reading oversized files up to the client cap.** Rejected: the 25 MiB bound is the admission ceiling; a client may only lower it.

## Consequences

The file panel, project-file verbs, skill manager flows, and orchestrator now match their READMEs and UI copy; delegated agents cannot act as heads or recurse through `executor`; flat `.md` skills trash and restore without moving sibling skills. Related shipped notes: the skills lifecycle ([feature/2026-08-31-skill-manager-and-benchmark.md](2026-08-31-skill-manager-and-benchmark.md)) and benchmark task isolation ([bug-fix/2026-08-31-benchmark-loud-llm-failures.md](../bug-fix/2026-08-31-benchmark-loud-llm-failures.md)) describe the manager this note adjusts; the orchestrator and file-panel packages are new in this WIP layer and supersede nothing active.

## Testing

- `ui-files`: 49 tests incl. Windows/POSIX base names, icon glyph variants, failed-listing retry, hidden rows, Chromium-safe dragover/drop, save-after-close; per-file coverage 100/100/100/100 on `src`.
- `skill-manager` + `ui-settings-skills`: 208 tests incl. flat-`.md` trash without root movement, replace-on-first-save, and failed activation/rollback surfacing inline; changed files lint clean.
- `orchestrator`: new composition spec (8 tests) covering mount/unmount on settings, fiber teardown, head-section suppression by depth, child scoping per provider capability, head-only refusal, and per-stop-reason partial-output errors.
- `apiproxy` project-files: 12 tests incl. write-through-symlink rejection and the clamped cap.
- `compaction-basic` + `ui-skill`: 163 tests pass after the lint fixes; typecheck clean across all touched packages.
