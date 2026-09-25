# @deepseek-ai/dsh-engagement-stub

English | [中文](README.zh.md)

Deny-only engagement contour: it refuses a tool call whose target falls outside the configured engagement scope and records one audit event per refusal. It owns no model context of its own — the tool registry keeps dispatching, and this plugin only answers whether a call may proceed.

## Surface

- `ctx.events.emit('engagement/denied', { tool, reason, time })` carries the denial audit record; the plugin registers no listener chain that alters a tool result.
- No services are injected: listeners are registered through `ctx.on`, and a refusal is decided before dispatch.
- Absent configuration means no refusals, so a profile that does not enable the contour behaves exactly as if the plugin were not mounted.

## Model Experience

None, as the stub only refuses dispatch and emits an audit event; it registers no prompt, schema, or tool result.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.
