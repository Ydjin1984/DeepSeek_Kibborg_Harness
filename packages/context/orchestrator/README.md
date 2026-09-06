# @deepseek-ai/dsh-orchestrator

English | [中文](README.zh.md)

Orchestrator mode (host half). When `enabled`, the deployment splits model roles: the session's live chat model acts as the HEAD (planner) and delegates heavy, tool-driven work to the `executor` tool, which always runs on the configured LOCAL model (`executorProvider` / `executorModel`). Cloud tokens are spent on planning and synthesis, while the local model pays for long tool chains — searches, mass file reads, shell commands. The head role needs no route field: it is whatever model the composer picker selected for the session.

The plugin registers three things inside one lifecycle effect:

- the **`executor` tool** — one foreground delegation to the configured local route through `ctx.subagents` (`subagentProvider`, default `spawn`). The child gets a complete standalone prompt and full tool access, but never inherits the head role: the spawn hides the `executor` tool from the child (`toolFilter`), caps delegated depth at one level (`maxDepth: 1`), and injects a compact worker persona — each only when the chosen provider advertises the corresponding capability. Partial output is preserved in the error when the child does not finish cleanly.
- a **system-prompt section** that, while enabled, tells the top-level head model to load the `orchestrator-head` skill and delegate via `executor`. The section renders empty for delegated agents (`subagentDepth > 0`), and the tool refuses execution from one — recursion is bounded on every path.
- the **bundled companion skills** `orchestrator-head` and `orchestrator-executor` — registered on `ctx.skills` (source `bundled`, model-invocable) exactly while the mode is live. Registration happens on the host plane, so the runtime skills land in the global registry layer and are available in every project that enables the mode, not only in checkouts carrying `.agents/skills/orchestrator-*`. The Skills manager lists them under «Встроенные» (built-in).

Configuration lives in the plugin's live `orchestrator` SETTINGS NAMESPACE (edited in Settings → Models → «Оркестратор», or directly on the host plane); edits apply at runtime — the tool and the prompt section read the resolved namespace on every call/render, and a settings watcher mounts or unmounts the tool and the bundled skills as the mode toggles. `enabled: true` without a model leaves the tool unmounted, the section empty, and the skills unregistered; the UI form marks the executor route as required.

## Model Experience

### System prompt section while the mode is enabled

#### What the model sees

Enabling the mode adds one system-prompt section (order 116.7) that tells the head to load the `orchestrator-head` skill through the `skill` tool and delegate heavy, tool-driven work to the `executor` tool. Delegated children never read it: the section renders empty text when the calling agent is at a delegated depth.

##### Section text

```markdown
Режим оркестра включён: ты — ГОЛОВНАЯ (планирующая) модель, твои токены дороги. Исполнительная (локальная) модель — ${route} через инструмент `executor`. Не выполняй сам длинные цепочки инструментов: сначала загрузи навык `orchestrator-head` инструментом `skill` и следуй ему. Тяжёлую инструментальную работу (поиск по коду, массовые чтения, команды, переборы) отдавай в `executor` одним полным заданием и требуй сжатый структурированный отчёт. Проверяй результат чтением ключевых мест сам, не пересказывая его. У исполнителя есть зрение (vision): он может открывать и анализировать изображения (скриншоты, GUI, картинки) инструментом чтения изображений (read_image) и объяснять, что видит. Если тебе нужно что-то посмотреть — не пытайся сам анализировать графический файл текстом, а дай исполнителю задание «посмотри на <путь к изображению> и объясни, что на нём», указав точный путь к файлу. Учти: у головной модели (deepseek-v4-flash) нет vision — читать изображения может только исполнитель. Для веб-задач («полазить в интернете», посмотреть страницу, вытянуть информацию с сайта, «потыкать» сайт, визуально осмотреть страницу/фичи) почти всегда доступен Chrome с DevTools Protocol на 127.0.0.1:9222. Делегируй исполнителю задание использовать CDP-клиент: node "C:\Users\lex66\.dsh\chrome\cdp.mjs" (ensure → open <url> → shot <файл.png> → осмотр скриншота через read_image; при необходимости text/html/eval/click). Визуальный осмотр сайта делается только через скриншот Chrome + чтение изображения исполнителем.
```

#### Token effect

While the mode is enabled the section adds a fixed section to every top-level prompt; delegating long tool chains to the local executor model is what keeps cloud token spend on planning.

#### KV Cache effect

The section belongs to the system prompt only while the mode is enabled; toggling it on invalidates the head's cached prefix once. Each `executor` call runs a separate child session on the local model and does not touch the head's cache.

### `executor` delegation tool

#### What the model sees

While the mode is enabled with a full provider/model route, the head gains the `executor` tool: it runs one heavy, tool-driven task on the configured LOCAL model (provider/model from the `orchestrator` settings namespace) and returns a condensed report, so the head never spends cloud tokens on long tool chains.

#### Token effect

Each call is one child agent turn with its own session on the local route; the head spends only the tool-call and result tokens.

#### KV Cache effect

The child runs in a separate session, so the head's cache is untouched; local-route caches belong to the child session.

## Known Limitations and Deferred Work

- **Settings-based configuration** — the executor route and mode toggle live in the `orchestrator` settings namespace, not in cordis config; the plugin exposes no `Config` object by design.
- **Role split is prompt-guided** — nothing hard-enforces that the head delegates; the executor route is pinned on the tool itself, which is the enforcement boundary that matters for token spend.
- **Executor runs are serial** — the tool declares `isConcurrencySafe: false`, so overlapping executor calls queue instead of racing over shared files and the shell.
- **Head has no route picker** — the head is the session's live chat model; only the local executor route is configured in Settings → Models → «Оркестратор».
- **Skill injection is not automatic** — the head must load `orchestrator-head` through the `skill` tool; the skills are bundled with this package and registered as built-in while the mode is enabled, so they are visible in every project whose session enables orchestrator mode. The worker persona, by contrast, is injected into every executor child through the spawn composition.
