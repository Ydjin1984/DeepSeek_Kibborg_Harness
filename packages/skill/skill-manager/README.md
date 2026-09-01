# @deepseek-ai/dsh-skill-manager

English | [中文](README.zh.md)

Skill lifecycle management for the DeepSeek Harness: the managed-files CRUD layer over the native `SKILL.md` format, trash, version history, rollback, enable/disable, validation, static security classification, and a symmetric A/B benchmark engine with Auto Improve.

This package adds an automation and management layer **over** the existing skill mechanism — it never replaces it. It reuses the filesystem provider's shared parser and project-root rule (`@deepseek-ai/dsh-skill-filesystem`), writes into the same roots the provider discovers, and the provider's watcher invalidates the registry on this package's mutations. `ctx.skills`, `available_skills`, `skill({ name })`, and the invocation policy contract are untouched.

## Plugin

Requires `ctx.skills` and `ctx.tools` (`inject: ['skills', 'tools']`).

### Config

| Field | Default | Meaning |
|---|---|---|
| `dshHome` | `$DSH_HOME` or `~/.dsh` | DeepSeek Harness config root; the `user` scope writes `<dshHome>/skills`. |
| `agentsHome` | `$DSH_AGENTS_HOME` or `~/.agents` | Shared agent config root (currently informational). |

### Provided services

- `ctx.skillManager` — the {@link SkillManager} service (CRUD, trash, versions, rollback, enable/disable, validation, security, background benchmarks).
- `skill_manage` model-facing tool — the programmatic surface the Skill Creator model drives for every operation.
- `skill-create` system skill — a user-invocable runtime skill (`user-invocable: true`, `disable-model-invocation: true`) whose body ships as `assets/skill-create/SKILL.md` and is injected through the existing `/skill-create` gesture boundary.

## Storage scopes

| Scope | Path | Registry source |
|---|---|---|
| `user` | `<dshHome>/skills/<name>/SKILL.md` | `user-dsh` |
| `project` | `<projectRoot>/.dsh/skills/<name>/SKILL.md` | `project-dsh` |
| `agents` | `<projectRoot>/.agents/skills/<name>/SKILL.md` | `project-agents` |

The project root is the nearest ancestor containing `.git`, matching the filesystem provider. Skills keep the native `<name>/SKILL.md` layout; the manager adds two companion artifacts inside the skill directory that discovery and the watcher ignore: `SKILL.manager.json` (version history, benchmark summaries, timestamps) and `.versions/<vN>/SKILL.md` (version bodies). Disabling writes a `.disabled` marker that the filesystem provider honors. Trash lives under `<root>/.system/trash/`.

## Operations

- **save** — validate with the shared parser, run the security check, write `SKILL.md`, and snapshot the previous body as a version. Creation refuses an existing same-name skill unless `replace` is set; a `blocked` security verdict refuses the save unless `force` is set.
- **remove / restore / permanentDelete** — move to trash, move back (refusing a name collision), or delete permanently. Built-in skills refuse removal.
- **setEnabled** — toggle the `.disabled` marker; disabling never touches the body or invocation frontmatter.
- **versions / rollback / activateVersion / publishVersion** — version history with per-version benchmark summaries; rollback publishes a new version whose body is the target's (history is never destroyed); activation selects among published versions without a new event (the benchmark best-version rule).
- **validate / securityCheck** — shared-parser validation with exact failure reasons; static security classification `valid` / `warning` / `blocked` with findings and matched evidence.

## Benchmark

The benchmark engine runs a symmetric A/B test: for every generated case, one task execution without the skill and one with it, using the same input, workspace, task model, and environment — the only difference is the skill body registered as a runtime skill in the task agent's scope.

- **Adaptive suite** — 3 cases for short bodies, 5 for medium, 7 for long/complex (override with `caseCount`).
- **Blind evaluation** — the evaluator model (defaults to the task model) receives the two outputs as anonymous `Candidate A` / `Candidate B` and scores each 0–100 against derived criteria.
- **Metrics** — quality scores, input/output/total tokens, execution time, tool-call counts, and per-case detail with comments.
- **Verdict** — `improvement`, `worse`, or `no-significant-improvement` from the aggregate, never from a single metric; per-case regressions are reported as reasons.
- **Auto Improve** — iteratively generates candidates, validates and security-checks them, benchmarks each, and only activates a candidate that beats the current best by `minImprovementPercent` (`maxIterations`, `stopOnRegression` limits). A worse candidate never replaces the active best version.
- **Runs** — `startBenchmark` / `startAutoImprove` / `startBenchmarkBatch` return live run views; `pollBenchmark` and `cancelBenchmark` observe and cancel. A batch runs one benchmark per named skill in order, records each on its own run, continues past a failing skill, and aborts the whole batch when any of its runs is cancelled. Every completed run is persisted under the tested version (a candidate summary is rebound to the candidate version it actually tested), and editing a skill after a benchmark marks the benchmark outdated (status `benchmark-outdated`).

## Model Experience

The `skill-create` system skill instructs the model through the create → analyze → ask → generate → validate → security → preview → test → improve → save workflow, calling `skill_manage` for every file operation. The tool renders compact text results (validation reasons, security verdicts and findings, save paths, benchmark summaries). Benchmarks and Auto Improve run in the background so the model never blocks on long task executions.

#### KV Cache effect

No direct effect. The runtime skill registration is per task-agent scope, so benchmark task runs do not change the calling session's request history.

## Known Limitations and Deferred Work

- **Local host filesystem only** — managed writes use Node filesystem I/O against local roots, like the filesystem provider's trusted-host path; remote/sandboxed filesystem backends are not used for mutations.
- **Static security heuristics** — the security check is pattern-based and deliberately conservative; it cannot prove the absence of prompt-injection or other risks in arbitrary instructions.
- **Benchmark tasks are isolated agents** — each A/B execution creates a fresh agent with the task model; tool catalogs come from the mounted preset composition, so the task agent must be able to reach the tools the skill needs.
- **No cross-version benchmark reuse** — every benchmark run re-executes the full suite; there is no incremental or cached evaluation yet.
