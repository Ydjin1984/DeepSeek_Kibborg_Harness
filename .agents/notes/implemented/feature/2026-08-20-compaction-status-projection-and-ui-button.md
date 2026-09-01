# Agent Note: Compaction status projection and manual-compaction button

Status: implemented

English | [中文](2026-08-20-compaction-status-projection-and-ui-button.zh.md)

## Problem

Compaction exists as a capability seam with automatic step-pressure and overflow recovery, but the web surface gives the person no direct control and no visibility into the policy. The only manual path is typing `/compact` in the composer; the composer's ContextMeter shows occupancy but not where automatic compaction fires; and nothing signals that a compaction is in flight, so a second manual request races the lock. With a local 128k model a long task crosses the default 0.8 threshold regularly, and the person needs both a one-click way to compact now and a way to know when auto-compaction will (or will not) intervene.

## Decision

### A read-side `compaction` session projection unit

`dsh-compaction-basic` registers a `compaction` session projection unit (fold only, no store, no events of its own) publishing three facts the browser can read:

- `auto` — whether automatic pressure/overflow compaction is enabled for this deployment (`BasicCompactionConfig.auto`).
- `thresholdRatio` — the resolved pressure threshold ratio for the current route: the exact `modelPolicies` override or the top-level default, resolved identically to request time via `resolveTargetPolicy`. Absent until a `request/context` route record exists.
- `active` — a compaction transaction is in flight (`compaction/start` without its `compaction/end`), reset by `session/end-seed` for stale pre-lifecycle orphans exactly as the backend classifies them.

The unit's `apply` is a pure fold over the durable log (`compaction/start`/`compaction/end`, `request/context`, `session/end-seed`) and closes over the engine's validated config, so `auto` and the threshold can never drift from the instance that registered it. Registration is an optional child of the engine constructor (`ctx.inject(['sessionProjections'], …)`), so headless compositions without the registry keep the standalone read shape — the same pattern `dsh-token-meter` uses for its units. The value is model-invisible: it is read-side projection state, never a session event.

The projection types live in `@deepseek-ai/dsh-compaction/projection` (pure types + the `SessionProjectionMap` merge) with a new `@deepseek-ai/dsh-compaction/client` outlet, mirroring the `checkpoint` leaf pattern so client programs name the key without loading the host plugin's Context merges.

### A `ui-compact` client plugin: one composer button

The new `@deepseek-ai/dsh-client-ui-compact` package registers a single button into the existing `conversation.input.right` list slot (the composer tool row, left of the model seat and the ContextMeter ring). It renders nothing while the `compaction` projection key is absent — the capability-absence contract of the projection registry, so a deployment without the compaction backend pays no layout.

The button:

- runs `/compact` through `ctx.remote.commands.execute`, the exact admission path of typing the slash command, so the settled lifecycle renders as the durable command node and the `CompactionCommandCard` checkpoint disclosure with zero plugin-owned state;
- disables while the agent is running, the session is removed, `active` is true (a compaction is already in flight), or its own request is pending;
- tints with the warning alias and relabels "near the auto-compaction threshold ({percent}% / {threshold}%)" when `contextPressure.projectedTokens / contextWindow` reaches `thresholdRatio`, and says "manual only" when `auto` is false.

The plugin owns no store, no event listener, and no refresh chain: both facts arrive through the standard kit's `useProjection`, and the mutation verb is a plain inject callback over the command Remote. `dsh-compaction` is declared as a peer dependency because the plugin type-imports the projection merge.

## Alternatives considered

- **A compact button inside `ui-conversation`** — rejected: the repo rule is one UI feature per plugin package, and ui-conversation would have to learn compaction vocabulary (the command Remote, the projection merge). The button is a distinct surface over an existing slot.
- **Hardcoding the threshold in the client** — rejected: the threshold is deployment and per-route configurable (`modelPolicies`); a client constant would drift from the real trigger exactly when it matters (different local models, tuned policies). The projection resolves it from the same code path as the engine.
- **Deriving the in-flight state from session `running`** — rejected: `compactNow` runs as an idle maintenance operation, so the session is not `running` during compaction; only the `compaction/start…end` bracket can report the lock, and that is exactly what the projection folds.
- **A dedicated named seat (`conversation.input.compact`)** — rejected for now: the existing list slot carries the same ordering and requires no SlotMap/children change in ui-conversation; a named seat stays available if the control ever needs one-occupant semantics.
- **Showing the threshold line inside the ContextMeter panel** — deferred: the meter stays occupancy-only, and the button's tooltip already carries the threshold facts; folding the meter read into ui-conversation would add the same coupling the separate package avoids.

## Consequences

- **Packages**: `dsh-compaction` gains the `projection` leaf and the `./client` outlet (plus a `dsh-session-projection` peer/dev dependency); `dsh-compaction-basic` gains the `projection.ts` unit and registers it from the engine constructor; `dsh-client-ui-compact` is a new dynamic client package wired into the web-app bundle roster.
- **The projection is per-session and ref-counted**: N sessions on a preset share the unit's fold cells per session, and multiple preset mounts of the same key share one unit (first registration wins); shipped presets all carry the same compaction defaults, so a differing `thresholdRatio` across presets sharing the key is a documented non-goal.
- **Model-visible ⟺ logged holds**: the button adds no session events; the compaction it triggers is already the backend's logged bracket + checkpoint replacement.
- **Deferred**: a threshold marker inside the ContextMeter panel, an explicit "compaction just ran" transient notice (the flow node owns that presentation), and surfacing the per-route `retainRatio`.

## Testing

- **Host unit** (`compaction-projection.spec.ts`): a real SessionStore + registry harness drives the fold over `compaction/start`/`end`, `request/context` (default ratio, `modelPolicies` override, fallback), and `session/end-seed` reset, and pins the `auto: false` view.
- **Client component** (`compact-control.client.spec.tsx`): capability gating (nothing without the key), base label, the warning tint and relabel exactly at the threshold, below-threshold neutrality, disable under `running`/`active`/pending, manual-only label, silent success, and error/unmatched toast surfacing.
