# Agent Note: Batch benchmarks and live status refresh in the Skills tab

Status: implemented

English | [中文](2026-09-01-skills-benchmark-batch-and-status-refresh.zh.md)

## Problem

The Skills Manager tab showed two benchmark inconsistencies. First, the status badge was read once when the section mounted and never again: a skill edited, benchmarked, or auto-improved kept showing `not-tested` or `benchmark-outdated` until the section remounted, so a just-completed benchmark looked unsaved. Second, Auto Improve stored a candidate's summary under the candidate version key with the active version's `version` field, so activating the winner left `lastBenchmark.version` mismatching the active version and the freshly improved skill was flagged `benchmark-outdated` by the status check.

Benchmarking itself was per-skill only: there was no way to re-test every managed skill in one action, and the model selection (task model, evaluator model, case count) lived inside the per-skill dialog, so a sweep meant opening the dialog once per skill.

## Decision

The skill manager gained a sequential batch runner, the wire gained a batch method, and the section gained a toolbar with the model fields and a Run-all action plus live status refresh.

**Sequential batch, manager-owned.** `SkillManager.startBenchmarkBatch` starts one background task that runs `runBenchmark` once per named skill in order, recording each run in the existing `benchmarkRuns` registry so `pollBenchmark`/`cancelBenchmark` work unchanged. A failing skill settles its own run as `failed` and the batch continues with the next name. All runs share one `AbortController`: cancelling any run of the batch aborts the current run as `cancelled` and marks every not-yet-started run `cancelled`. The wire method `skill.benchmarkBatchStart` carries `{ sessionId, names, taskModel, evaluatorModel?, caseCount? }` through the rpc-map, the zod schemas, the fetch carrier, and the connection allowlist; the browser calls it through a new `benchmarkBatchStart` action on the section's `SkillsActions`.

**Auto Improve rebinds the candidate summary.** The candidate run's summary is re-attached under the candidate version with `version` corrected to the candidate version, so the status check (`lastBenchmark.version === activeVersion`) stays true for the activated winner.

**The toolbar owns the model selection.** A `BenchmarkModelControls` component (task model, evaluator model, same-model shortcut, case count) is shared by the section toolbar and the per-skill dialog. The toolbar seeds the dialog's run form (`initial` prop), so the user picks models once for the sweep and the dialog defaults to the same choice. The Run-all button starts the batch over every non-built-in managed skill; while a batch runs the toolbar controls lock, a progress line shows the current skill, and a Cancel button aborts the batch.

**Status badges refresh when a run settles.** The single-run poll effect and the batch poll effect both re-read the catalog (`refresh()`) once their runs reach a terminal status, so `enabled`/`benchmark-outdated`/`not-tested` reflect the persisted summaries immediately. The batch line then reports the verdict counts (`improved`/`worse`/`unchanged`/`failed`) or the cancelled notice.

## Alternatives considered

**Parallel batch.** Starting every skill's benchmark concurrently would finish the sweep faster, but `runBenchmark` already creates fresh agents and streams model calls per case; N concurrent suites would multiply the task model's load and make cancellation and rate limiting unpredictable. Sequential keeps the sweep at the same cost as one skill at a time, which is also what the per-skill flow already spent.

**Client-side loop of `benchmarkStart` calls.** The section could have awaited one `benchmarkStart` per skill and polled each to completion before the next. That reimplements the run registry, the shared cancellation, and the settle bookkeeping in the browser, and a page refresh would strand half-finished runs. The manager already owns runs; the batch is one more entry point into that registry.

**Keeping model selection dialog-only.** The models already existed in the per-skill dialog; a Run-all could have reused the last dialog selection. The request was explicit about choosing the sweep models in the same window as the button, and a shared component avoids two divergent copies of the same controls.

## Consequences

A batch is slower than a parallel sweep by construction, but its load is bounded to one benchmark's worth of agents and model calls, and the per-skill dialog behavior is unchanged. The toolbar's model fields are new always-visible state in the section; they default to the first catalog model and are persisted only for the section's lifetime. Run-all excludes built-in skills because built-ins have no managed version to attach a summary to (the manager's `attachBenchmark` requires a filesystem entry); their card-level Benchmark button remains and reports the manager's refusal if used. The batch's cancel is all-or-nothing by design (one shared controller), which matches the single Cancel button. Defensive arms that the UI cannot reach (button disabled states, null batch state) carry `v8 ignore` annotations; the reachable ones are covered by the component specs.
