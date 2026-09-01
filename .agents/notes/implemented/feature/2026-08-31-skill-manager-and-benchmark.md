# Agent Note: Skill lifecycle management, benchmark, and Skill Creator

Status: implemented

English | [中文](2026-08-31-skill-manager-and-benchmark.zh.md)

## Problem

Skills were a static storage system: a `SKILL.md` tree the filesystem provider discovered and the tool-skill consumer served. There was no way to create a skill from a description, validate it against the shared parser before saving, classify its instructions for security, keep version history, trash it safely, measure whether it actually helps a model, or improve it from measured failures. Everything a user could do was manual file editing and hand inspection.

The task was to add a full lifecycle — CREATE → VALIDATE → SECURE → TEST → EVALUATE → IMPROVE → VERSION → DEPLOY → USE → ROLLBACK — over the existing mechanism, without forking the skill format, the parser, discovery, invocation, or `skill({ name })`.

## Decision

A host-plane **skill manager** package (`@deepseek-ai/dsh-skill-manager`) owns the lifecycle, and a bundled **system skill** (`skill-create`) owns the model-facing workflow. The two are strictly separated: the skill instructs the model through the create → analyze → ask → generate → validate → security → preview → test → improve → save workflow and drives every file operation through the `skill_manage` tool; the package implements the operations.

**The manager is a layer over the existing roots.** It writes into the exact directories the filesystem provider discovers (`<root>/.dsh/skills`, `<root>/.agents/skills`, `<dshHome>/skills`), reuses the provider's shared parser (`parseSkillSource`) and project-root rule, and relies on the provider's watcher to invalidate the registry on its mutations. Skills keep the native `<name>/SKILL.md` layout. Two companion artifacts live inside the skill directory and are invisible to discovery and the watcher: `SKILL.manager.json` (version history, benchmark summaries, timestamps) and `.versions/<vN>/SKILL.md` (version bodies). Every version, including the active one, is snapshotted, so rollback and activation read from a snapshot instead of re-deriving content.

**Conflict resolution is explicit.** Creation refuses an existing same-name skill unless `replace` is set; a blocked security verdict refuses the save unless `force` is set; trash refuses a name collision; built-in skills refuse deletion. No silent overwrite or deletion anywhere.

**Enable/disable is a marker the provider honors.** Disabling writes `<name>/.disabled`; the filesystem provider skips directory skills carrying it and the watcher invalidates on marker changes. The body and invocation frontmatter are never touched, so `user-invocable` and `disable-model-invocation` keep their exact semantics.

**The security validator is static and conservative.** It classifies a body VALID / WARNING / BLOCKED with matched evidence, flagging explicit instruction-override, concealment, policy bypass, credential exfiltration, destructive commands (blocked), and remote-execution, escalation, external URLs, and script execution (warning). It never rewrites content.

**The benchmark engine runs a symmetric A/B.** For every generated case, one task execution without the skill and one with it use the same input, workspace, task model, and environment; the only difference is the skill body registered as a runtime skill in the task agent's scope. The evaluator model (defaults to the task model) receives the two outputs anonymously as `Candidate A`/`Candidate B` and scores each 0–100 against derived criteria. The suite size adapts to skill complexity (3/5/7). The verdict (`improvement`/`worse`/`no-significant-improvement`) comes from the aggregate, never from a single metric, with per-case regressions reported as reasons.

**Auto Improve protects the best version.** Candidates are generated, validated, security-checked, published as non-active versions, benchmarked, and only activated when they beat the current best by `minImprovementPercent`; `maxIterations` and `stopOnRegression` bound the loop. A worse candidate never replaces the active best, and cancellation never rolls back a saved best.

**The system skill rides the existing gesture.** `skill-create` ships as a real `SKILL.md` asset, parsed with the shared parser, and registers as a user-invocable runtime skill (`user-invocable: true`, `disable-model-invocation: true`), so `/skill-create` injects the workflow through the existing tool-skill pre-step boundary with no new command surface. The UI Create Skill button copies the same gesture, keeping one workflow.

**The gateway exposes the lifecycle.** The `skills` RPC domain gained listManaged/read/save/remove/restore/permanentDelete/trash/setEnabled/versions/rollback/validate/securityCheck/benchmarkStart/benchmarkPoll/benchmarkCancel/benchmarkBatchStart/autoImprove, all session-addressed (the client never submits a raw path). Manager failures carry a stable `skill-manager-error` code with the manager's own code in details. The mutation surface is pinned to loopback like settings and credentials. The batch method, the toolbar model fields, and the post-run status refresh are the [batch-benchmark note](2026-09-01-skills-benchmark-batch-and-status-refresh.md).

## Alternatives considered

- **A model-only creator with textual file instructions.** Rejected by the task: file operations must be programmatic. The `skill_manage` tool is the programming surface and every operation goes through the manager service.
- **Storing versions in a separate sidecar root.** Rejected: the task forbids a non-standard storage format and requires physical paths to match the existing roots; per-skill `.versions/` and `SKILL.manager.json` keep everything inside the skill directory the provider already ignores below depth two.
- **Enable/disable by renaming the skill directory.** Rejected: discovery parses frontmatter, not the directory name, so a `<name>.disabled` directory would still be discovered under its frontmatter name. A marker file the provider honors is the only exact mechanism.
- **Benchmarking through a full agent with file-based skill staging.** Rejected in favor of runtime registration in the task agent's scope: it is the only difference the A/B needs, needs no filesystem churn, and cannot race the watcher.
- **Auto-improve as a model-driven loop in the creator skill.** Rejected: the loop needs programmatic limits (iterations, threshold, regression stop) and best-version bookkeeping; the engine owns it and the model only edits content.
- **A separate command registry entry for `/skill-create`.** Rejected: commands are resolved client-side before a line becomes a prompt, so a command would not reach the model; the skill gesture is the native path.

## Consequences

A user can create a skill from a description or a full ТЗ, validate and security-check it before saving, choose user/project/agents scope, benchmark it A/B against a baseline with a chosen task and evaluator model, see quality/token/time/tool metrics per case, improve it manually or automatically with regression protection, roll back to any version, and manage it from a new Skills tab — while existing skills, parser, discovery, and invocation keep working unchanged.

The filesystem provider gained two additive behaviors (`.disabled` marker and exported parser) with full backward compatibility; the apiproxy gateway gained 16 methods and one error code; the web profile mounts one host row (`skill-manager`) and one client row (`ui-settings-skills`).

Two costs are real. Benchmark tasks are isolated agents, so the task agent must be able to reach the tools the skill needs, and the security validator is pattern-based and cannot prove the absence of prompt-injection. Versions are full-body snapshots, so history grows with body size; there is no incremental storage or cross-version benchmark reuse yet.

## Required verification

- `packages/skill/skill-manager` tests reach 100% per-file coverage (manager, benchmark, security, tool, skill-create, plugin).
- `packages/host/apiproxy` tests cover the new skill-manager methods and the wire round-trip.
- The system skill `skill-create` passes the shared parser at load (its own asset is the fixture).
- Existing skill tests keep passing; the provider's `.disabled` marker and parser exports are covered.
