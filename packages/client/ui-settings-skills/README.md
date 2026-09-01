# @deepseek-ai/dsh-client-ui-settings-skills

The **Skills** settings section — the Skills Manager tab. The browser plugin registers one localized `settings.section` contribution with id `skills`; the settings shell owns the navigation entry. All skill state is owned host-side by the [`skill-manager`](../../skill/skill-manager/README.md) service and travels over the shared wire client's `skills` and `llm` domains, so this package holds no durable data of its own — it reads a snapshot when the section mounts and re-reads after every mutation it makes.

The section lists the managed catalog in two groups — **My skills** (filesystem-scoped: user, project, agents) and **Built-in** — with real-time filtering across name, description, when-to-use, and the body of any skill whose full content this section has already read. Each card shows name, description, scope, path, status, invocation policy, version, source, and the last benchmark outcome, with Enable/Disable, View, Edit, Versions, Benchmark, and Delete actions. Built-in skills are read-only: they render no Edit or Delete action. A trash section below the catalog restores or permanently deletes trashed skills. The section re-reads the catalog whenever a benchmark run it is polling settles, so the status badge reflects the freshly persisted summary instead of the mount-time snapshot.

**Create skill** copies `/skill-create` to the clipboard and points the user at the chat, where the system skill's wizard authors the new skill file. The editor runs the manager's required save pipeline — validate, then security-check, then save — and resolves a blocked security verdict (save anyway) and a same-name conflict (replace existing) in-dialog. The versions dialog rolls the skill back to any stored version. The benchmark dialog selects task and evaluator models from `llm.models`, runs the host benchmark, polls it to completion, and renders the quality scores, improvement percentage, token/time/tool-call deltas, and per-case rows, with cancel while running. A toolbar above the catalog carries the same task/evaluator/case-count selection and a **Run all benchmarks** action: it starts one sequential host benchmark per managed (non-built-in) skill through `skill.benchmarkBatchStart`, locks the controls while the batch runs, offers a batch cancel, shows a progress line with the current skill, and summarizes the outcome by verdict once every run settles. The toolbar selection seeds the per-skill dialog's run form.

## Data flow

The section's actions are built once in `apply` from the shared `connection.api` and handed to the component through its inject face, so components never touch the wire client or any service directly. The section keeps its catalog snapshot, search query, disclosure state, and dialog payloads in local state — reading gestures, not shared facts — and every mutation goes through the injected action and re-reads the catalog. The active locale tag rides the inject hooks compartment, so date and number formatting follow the UI language without the component subscribing to the locale service.

## Model Experience

None, as this package renders a browser management UI and never assembles or sends a provider request itself; benchmark tasks are executed by the host's `skill-manager` service, which documents its own model effects.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Content search covers already-read bodies only** — the catalog snapshot carries summaries, so full-body search matches the name, description, and when-to-use of every skill plus the content of skills whose details this section has already loaded (via View/Edit/Versions). A freshly mounted section does not pre-read every body.
- **One benchmark dialog at a time** — opening Benchmark on another card discards the previous dialog's run view; if the dialog is closed before the run settles, the host run itself continues and its summary lands on the card's next catalog refresh (a dialog kept open until settlement refreshes the catalog automatically).
- **Per-section snapshot** — switching tabs preserves the current snapshot, while reopening Settings obtains a new one; there is no push subscription to skill-manager mutations.
