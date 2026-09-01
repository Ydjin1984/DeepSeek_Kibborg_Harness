# Agent Note: Localized command menu and plugin enablement control

Status: implemented

English | [中文](2026-08-30-web-command-menu-localization-and-plugin-toggle.zh.md)

## Problem

Two web GUI gaps surfaced in locale testing. The composer's "+" button opens the shared slash menu filtered to command candidates, and every row rendered the Host catalog's raw English name and description — `goal`, `compact`, `permission`, and the rest — in any locale. And the Plugins settings list (the `pluginInventory/list` projection) labeled entries `Enabled`/`Disabled` but offered no way to change that state, so a deployment row disabled by composition (for example the web bundle's `hmr` row, or a platform-specific shell tool) could not be re-enabled from the browser at all.

## Decision

**The command menu localizes display copy while the raw name stays the wire key.** `InputTriggerCandidate` gains an optional `label` — a display name the menu renders in place of `name`; fuzzy matching and pick dispatch keep reading `name`, so typing `/goal` still matches and executes while the row shows `目标`/`Цель`. `ui-commands` owns the copy: the `command` namespace dictionary gains `menu.<name>` and `menu.<name>.description` keys for the shipped commands (`goal`, `plan`, `compact`, `feedback`, `export`, `permission`, `model`), applied to both Host-catalog rows and client contributions in `candidates()`. The English dictionary mirrors the Host strings verbatim, so English goldens never drift. Unknown commands keep their raw copy (the dictionary key set, not a fallback lookup, decides membership). The `model` contribution's own `command.description` key is removed: the menu row is one home, and the raw English description remains the registration-time fallback.

**The plugin inventory toggles entries through a new Host Remote.** `pluginInventory/setEnabled(entryId, enabled)` resolves the Loader entry, writes its own `disabled` option through `Entry.update` + `tree.write()` (immediate effect, file-backed persistence), and returns the fresh snapshot. Group rows and the bootstrap `cordis:include` are refused. The Plugins list card gains an Enable/Disable action per row: busy while the RPC is in flight, all toggles blocked during one switch, the returned snapshot adopted in place, and failures surfaced as a localized alert line without reverting the list.

## Alternatives considered

- **Translating the candidate `name` in place.** Rejected: `name` is the fuzzy-match key and the pick-dispatch key (`pick.candidate.name` resolves the contribution or directory row), so replacing it would break both typing `/goal` and executing the pick. The display `label` keeps the two concerns separate.
- **Localizing on the Host by making command descriptors locale-aware.** Rejected: the command registry is model-visible and locale-agnostic, and every registration site would change. The client owns presentation copy exactly as the rest of the GUI does.
- **Keeping the inventory read-only and documenting the config file as the only path.** Rejected: the report specifically surfaced disabled rows with no way to act, and the Loader already provides the `Entry.update` seam the settings page needs.

## Consequences

A Russian or Chinese session sees the command menu fully localized (name and description) while `/goal`-style invocation stays English, and the Plugins list can enable or disable any non-group, non-include entry with the change applied immediately and persisted for writable config files. Read-only config files still apply the runtime change but keep the old value for the next boot — the established Include behavior, noted in the package README. The settings-chrome golden gains one `停用` button per inventory card; the English command-menu goldens are byte-identical.

## Testing

- Host: `PluginInventoryGateway` unit tests cover the two Remote methods, a setEnabled round trip (disable + re-enable with fiber phase), and the group/include refusals.
- Client: ui-commands candidate tests assert localized labels/descriptions for known commands and raw fallback for unknown ones; the menu-view spec renders `label` in place of `name`; the inventory component spec covers toggle success (snapshot adoption), busy locking, and failure alerting, and the browser-plugin spec covers the `setEnabled` Remote routing.
- Assembled: `DSH_SNAPSHOT=refresh` on the settings-chrome scenario rewrote only `plugins.expected.md`; the command-menu scenario replays against its committed golden.
