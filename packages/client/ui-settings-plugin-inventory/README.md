# @deepseek-ai/dsh-client-ui-settings-plugin-inventory

English | [中文](README.zh.md)

**Plugin list** tab for Web Settings, with per-entry enablement control. The browser plugin registers one localized `settings.plugins.tab` contribution with id `all`; the Plugins section owns the navigation entry and tab chrome. It performs no Remote read during plugin activation. Selecting the tab for the first time mounts it and lazily calls `ctx.remote.pluginInventory.list()` through [`api-remotes`](../../api/remotes/README.md).

The tab renders a searchable two-column catalog of compact disclosure cards. Each collapsed card uses the short module name as its title, a small effective-enablement tag, and an Enable/Disable action that calls `ctx.remote.pluginInventory.setEnabled()`; enabled entries also show a colored root-fiber status dot. Expanding one card reveals its Loader-tree entry id without a redundant field label, followed by the effective configuration and, for enabled entries, Cordis status. Disabled entries omit the redundant unmounted runtime state. The entry id remains the React key, disclosure identity, detail value, and an additional search target; it is never classified by string shape. Loading, empty, no-match, and generic failure states stay local to the mounted component, and a failed read or switch can be retried without exposing transport details. The registration uses `ctx.slots.inject()`, so it follows late tab declaration, redeclaration, locale changes, and teardown without importing the section owner.

## Model Experience

None, as this package only visualizes a Host-owned deployment snapshot in browser Settings and registers nothing model-facing.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **One snapshot per Settings mount or retry** — the tab does not subscribe to Loader changes or automatically refetch after reconnect; switching tabs preserves the current snapshot, while reopening Settings obtains a new one. A successful enable/disable adopts the snapshot the Host returns, so the switch reflects immediately.
- **Entry-level toggle only** — the action flips one entry's own `disabled` option; it adds no provenance, current-browser activation diagnosis, or grouping by source, and enablement writes are best-effort for read-only config files.
