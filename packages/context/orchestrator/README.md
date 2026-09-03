# @deepseek-ai/dsh-orchestrator

English | [中文](README.zh.md)

Orchestrator mode (host half). When `enabled`, the deployment splits model roles: the session's live chat model acts as the HEAD (planner) and delegates heavy, tool-driven work to the `executor` tool, which always runs on the configured LOCAL model (`executorProvider` / `executorModel`). Cloud tokens are spent on planning and synthesis, while the local model pays for long tool chains — searches, mass file reads, shell commands. The head role needs no route field: it is whatever model the composer picker selected for the session.

The plugin registers two things inside one lifecycle effect:

- the **`executor` tool** — one foreground delegation to the configured local route through `ctx.subagents` (`subagentProvider`, default `spawn`). The child gets a complete standalone prompt and full tool access, but never inherits the head role: the spawn hides the `executor` tool from the child (`toolFilter`), caps delegated depth at one level (`maxDepth: 1`), and injects a compact worker persona — each only when the chosen provider advertises the corresponding capability. Partial output is preserved in the error when the child does not finish cleanly.
- a **system-prompt section** that, while enabled, tells the top-level head model to load the `orchestrator-head` skill and delegate via `executor`. The section renders empty for delegated agents (`subagentDepth > 0`), and the tool refuses execution from one — recursion is bounded on every path.

Configuration lives in the plugin's live `orchestrator` SETTINGS NAMESPACE (edited in Settings → Models → «Оркестратор», or directly on the host plane); edits apply at runtime — the tool and the prompt section read the resolved namespace on every call/render, and a settings watcher mounts or unmounts the tool as the mode toggles. `enabled: true` without a model leaves the tool unmounted and the section empty; the UI form marks the executor route as required. The bundled companion skills `orchestrator-head` and `orchestrator-executor` (`.agents/skills`) carry the operating protocol.

## Model Experience

Directly: enabling the mode adds a system-prompt section instructing the head, and the head's `executor` calls run a complete child agent on the local model — every call is a separate agent turn with its own session, logged like any subagent delegation. The section text is the only model-visible input the plugin adds while the mode is off; nothing renders.

#### KV Cache effect

The prompt section changes the head's system prompt while enabled, so enabling it invalidates the head's cached prefix once. The executor call itself is a separate child session; it does not touch the head's cache.

## Known Limitations and Deferred Work

- **Settings-based configuration** — the executor route and mode toggle live in the `orchestrator` settings namespace, not in cordis config; the plugin exposes no `Config` object by design.
- **Role split is prompt-guided** — nothing hard-enforces that the head delegates; the executor route is pinned on the tool itself, which is the enforcement boundary that matters for token spend.
- **Executor runs are serial** — the tool declares `isConcurrencySafe: false`, so overlapping executor calls queue instead of racing over shared files and the shell.
- **Head has no route picker** — the head is the session's live chat model; only the local executor route is configured in Settings → Models → «Оркестратор».
- **Skill injection is not automatic** — the head must load `orchestrator-head` through the `skill` tool; the skills live in `.agents/skills` and are visible only when the session's cwd is this repository. The worker persona, by contrast, is injected into every executor child through the spawn composition.
