# @deepseek-ai/dsh-host-plugin-inventory

English | [中文](README.zh.md)

Host projection and enablement control of the current Cordis Loader tree. `PluginInventoryGateway` registers the `pluginInventory` service and publishes two generated direct Remotes: `pluginInventory/list` and `pluginInventory/setEnabled`. Every `list` call reads `ctx.loader.entries()` directly, skips structural group rows, and returns the remaining entries in Loader order with only their Loader entry id, module specifier, effective enablement, and current root Fiber phase.

The phase is `pending`, `loading`, `active`, `failed`, or `unloading`; it is `null` when the entry has no live root Fiber. The snapshot is intentionally point-in-time: Loader remains the sole lifecycle authority, while this package owns no cache, history, provenance model, or event stream. `setEnabled` writes an entry's own `disabled` option through its owning tree (`Entry.update` + `tree.write`), so the change applies immediately and persists for file-backed trees; group rows and the bootstrap include are refused. Its public payload types live under `./types`, and Typert generates the Host and Client Remote artifacts exposed by `./typert` and `./remote`.

The service is Remote-only and deliberately declares no same-process Cordis `Context` merge. Client packages consume it through the explicit [`api-remotes`](../../api/remotes/README.md) assembly rather than importing the Host implementation.

## Model Experience

None, as this Host-only inventory projection registers no prompt, tool, message, or provider request.

#### KV Cache effect

None; this package never assembles model input.

## Known Limitations and Deferred Work

- **Point-in-time state only** — the result contains no durable failure history or subscription; a missing root Fiber is reported as `null`, regardless of why no live root exists.
- **No provenance or add/remove** — the service does not identify which bundle, profile, or override introduced an entry, and it cannot add or remove plugins. Enablement writes are best-effort for read-only config files: the runtime state still applies, but the file (and therefore the next boot) keeps the old value.
