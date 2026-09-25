# @deepseek-ai/dsh-llm-openrouter-free

English | [中文](README.zh.md)

OpenRouter free-model pool for the harness. One plugin instance scans the public OpenRouter model directory for zero-price models, publishes the survivors as one `pi-ai` provider route, and leases them to callers that rotate across the pool under a per-model request and token budget.

The package root exposes the Cordis plugin contract (its default export is the `ctx.openrouterFree` service class), the settings schema, and the pure readers a configuration surface or a consumer needs. Model-directory parsing, the budget ledger, and the persistence format stay package-internal.

## Why a pool rather than one free route

Free models run out. Every free model on OpenRouter carries its own per-minute and per-day allowance, and a client that keeps asking an exhausted model gets `429` instead of an answer. The pool therefore keeps its own ledger per model — requests this minute, requests today, tokens today, cooldown — and selects the least-used model that still has budget. A rate-limited attempt benches that model until its window turns over, so the next task moves to the next model without operator action.

`acquire()` answers `undefined` immediately when nothing has budget left. It never waits: a caller that would otherwise block on a model with nothing to spend gets a missing worker it can report, which is what keeps a fan-out from stalling behind one empty model.

## Config

Written to the `openrouter-free` settings section by Settings → Models → «OpenRouter Free»; the same keys may be set from composition. `apiKeyEnv` is a credential *reference* resolved through `ctx.credentials`, so no secret enters this file — a key stored under that reference is also what the scan sends as a bearer token.

```yaml
- id: llm-openrouter-free
  name: '@deepseek-ai/dsh-llm-openrouter-free'
  config:
    enabled: true
    providerRoute: openrouter
    baseURL: https://openrouter.ai/api/v1
    apiKeyEnv: OPENROUTER_API_KEY
    refreshMinutes: 30
    maxModels: 20
    minContextWindow: 32768
    requestsPerMinutePerModel: 20
    requestsPerDayPerModel: 50
    tokensPerDayPerModel: 0
    excludeModels: []
    requireToolSupport: true
```

| Key | Meaning |
| --- | --- |
| `enabled` | Whether the pool scans, publishes its route, and serves leases. Dormant until set. |
| `providerRoute` | Route key published into the `llm-pi-ai` provider dict. The default, `openrouter`, is the route the installed pi-ai catalog already ships for this vendor, so the pooled models appear under the provider a user picks for OpenRouter rather than beside it. |
| `baseURL` | OpenRouter API root; `/models` is appended for the scan. |
| `apiKeyEnv` | Credential reference the published route resolves per request. |
| `refreshMinutes` | Scan cadence; every scan republishes the route with the models it found. The pool rescans on this interval for as long as it runs, so a long session picks up newly free and newly priced models without a restart. |
| `refreshNonce` | Operator-side scan trigger: the value means nothing, changing it asks for an immediate scan. This is what a configuration surface's "rescan now" writes, and it needs no second service verb. |
| `maxModels` | Cap on pooled models, applied after ordering (largest context first). |
| `minContextWindow` | Models below this context capacity are not pooled. |
| `requestsPerMinutePerModel` | Requests per model per UTC minute before it is benched. |
| `requestsPerDayPerModel` | Requests per model per UTC day before it is benched. |
| `tokensPerDayPerModel` | Tokens per model per UTC day; `0` disables the token limit. |
| `excludeModels` | Model ids never pooled (exact match). |
| `requireToolSupport` | Pool only models whose directory entry advertises `tools`. On by default: a pooled model is delegated to with the harness's tool set, and one without tool support answers the first tool call with a provider error. |

The `status` and `scannedAt` keys are service-owned: every scan and every settled lease rewrites `status` with the pooled models and what each has left, and every successful scan stamps `scannedAt`, which is how a surface shows how fresh the pool is. A reader reacting to a committed section must compare the configuration fields (the exported `settingsOf()` projection) rather than the whole value, or a reported lease looks like a configuration change — and must not treat its own report as a reason to rescan.

The published route is withdrawable: disabling the pool unsets the route profile it wrote, and a scan that finds no free models withdraws it too, so an empty pool never leaves a route whose every model is gone.

## Consumers

The orchestrator's ROI mode is the first consumer: its `swarm` tool leases one model per task from `ctx.openrouterFree`, so a fan-out of 5–20 workers costs no paid tokens. Consumers read the service through `ctx.get('openrouterFree')`, which is absent in a deployment that does not compose this package — the pool is optional, not a load-time dependency of anything that delegates.

The service also registers the model-facing `free_models` tool (absent in a deployment without a tools registry). `status` reports the pooled models, what each has left today, and when the pool was last scanned, without touching the network; `refresh` rescans the catalog first. It is what lets a planner check the pool before fanning work out, and refresh it without waiting for `refreshMinutes`.

## Persistence

The ledger lives at `$DSH_HOME/storages/openrouter-free/ledger.json`, rewritten atomically. It holds per-model counters only — no prompts, no outputs, no keys. An absent or malformed file reads as an empty ledger: the only cost of forgetting is re-learning a ceiling from one `429`, while a crash loop on a broken file would take the pool down with it.

## Model Experience

### Free pooled route

#### What the model sees

The pool adds no prompt text and no tools of its own. What a model sees is the published route: the free models appear in the picker and in `llm.models` like any other route, named by the OpenRouter directory, and a task delegated to one runs on that model with the ordinary tool set. The one model-visible consequence of the pool's budgeting is a delegated task that returns immediately with "no free model has budget left" instead of running.

#### Token effect

The pool spends no tokens of its own: a scan is one `GET /models` and produces no model request. Tokens spent by a task belong to the model that ran it; the ledger records what a consumer reports through its lease outcome.

#### KV Cache effect

The pool neither reads nor writes provider cache state. Every pooled model is reached as its own route, so a task that rotates to another free model is a fresh conversation for that provider and starts with an empty cache.

## Known Limitations and Deferred Work

- OpenRouter publishes no quota endpoint for free models, so the ledger is what the pool *believes* about each model, not what OpenRouter reports. A model used outside this harness spends allowance the ledger cannot see; the first `429` on it corrects the record.
- Token accounting depends on a consumer reporting what an attempt cost. The orchestrator's swarm reports requests only, because the subagent seam returns no usage, so `tokensPerDayPerModel` is enforced only for callers that pass `tokens` in their lease outcome.
- The scan trusts the directory's price strings. A model that becomes priced while the pooled route still lists it would keep being leased until the next scan; `refreshMinutes` is the bound.
- `excludeModels` matches exact OpenRouter ids. Prefix or vendor-family exclusion (all of `vendor/*`) is deferred until a deployment needs it.
