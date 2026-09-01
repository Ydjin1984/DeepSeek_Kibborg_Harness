# @deepseek-ai/dsh-client-ui-compact

English | [中文](README.zh.md)

Manual context compaction control, browser half: one compact button in the composer tool row (`conversation.input.right`, left of the model seat and the ContextMeter ring). It renders only while the host mounts the compaction backend for the session — the `compaction` session projection key is the capability gate, so a deployment without `dsh-compaction-basic` pays no layout. The button reads the same two projections the rest of the surface uses: the backend's `compaction` projection (`auto` flag, resolved `thresholdRatio` for the current route, and the in-flight lock `active`) and the token-meter `contextPressure` occupancy (`projectedTokens / contextWindow`).

Clicking runs the `/compact` host command through `ctx.remote.commands.execute` — the same admission path as typing the slash command, so the settled lifecycle renders as the durable command node and the `CompactionCommandCard` checkpoint disclosure with zero plugin-owned state. Failures surface as a transient toast anchored to the composer card; a successful compaction needs no local echo because the flow node owns the presentation.

The button disables while the agent is busy (`session.running`), the session is removed, a compaction is already in flight (`active`), or its own request is pending. When projected occupancy reaches the auto-compaction threshold, the button tints with the warning alias and its tooltip reads "near the auto-compaction threshold"; when the backend runs with `auto: false`, the tooltip says manual-only. Automatic step-pressure and overflow compaction remain entirely the backend's job — this plugin never triggers it and never nudges the model.

The `/client` exports are the plugin body (`apply`/`inject`), the `CompactControl` component, and the injected face types.

## Model Experience

Indirectly: the button invokes `/compact`, whose handler performs one summarizing compaction — the model call and the surface replacement are the backend's own, logged as the `compaction/start…end` bracket plus the checkpoint `user/message`. The button itself adds no prompt content and no session events; the two projections it reads are read-side only.

#### KV Cache effect

None from the button. The compaction it triggers reuses the conversation's system prompt, tools, and leading messages for the summarization call (backend behavior), which preserves the provider's warm KV cache for the summarized prefix.

## Known Limitations and Deferred Work

- **Threshold parity** — the warning tint compares `contextPressure.projectedTokens` against `thresholdRatio × contextWindow`. Both are projections, and the pressure figure is provider-anchored with heuristic deltas, so the tint is a user-facing reference, not a guarantee that automatic compaction will fire at exactly that moment.
- **Idle-requirement latency** — clicking while the agent is mid-turn is refused client-side (button disabled); a busy error from a concurrent waking turn surfaces through the toast.
