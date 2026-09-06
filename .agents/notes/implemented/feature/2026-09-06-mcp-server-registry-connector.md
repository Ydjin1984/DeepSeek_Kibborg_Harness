# Agent Note: MCP server registry connector — user-facing MCP without cordis.yml edits

Status: implemented

English | [中文](2026-09-06-mcp-server-registry-connector.zh.md)

## Problem

The [MCP client](2026-07-07-mcp-client-plugin.md) made MCP tools available, but the only way to connect a server was hand-editing a `cordis.yml`/overlay row. The Web GUI had no MCP surface at all, and there was no CLI, so the common user flow (add a server like in Claude Code / Cursor / VS Code, then use `mcp__<server>__<tool>` tools) did not exist. Users asked for the same servers they configure in Claude Code / VS Code / Cursor — a `mcpServers`-shaped registry, auto-read project config, CLI commands, and a GUI section.

## Decision

Add a deployment-level registry connector on top of the existing bridge:

- **Registry format** — Claude-Code-compatible `mcpServers` documents in two scopes: the user registry `$DSH_HOME/mcpServers.json` and the project registry `<cwd>/.mcp.json` (auto-read like Claude Code). Stdio (`command`/`args`/`env`/`cwd`) is selected by the absence of `url`; `url`/`headers` select Streamable HTTP. Extensions: `enabled: false` (deploy switch) and `${VAR}` interpolation from the process environment.
- **New package `packages/mcp/mcp-servers`** (`@deepseek-ai/dsh-mcp-servers`, service `ctx.mcpServers`, mounted in the `base` bundle so every profile — web, CLI, headless — exposes the registry): watches both files, parses/validates them with the pure module `src/registry.ts`, and deploys one `mcp-client` instance per valid enabled server through programmatic `ctx.plugin()` on the untraced service context. Reconcile is a serialized chain; an edited entry redeploys over the old generation (config-signature diff), a removed/disabled/invalid one disposes. Tools land on the global tool layer, so existing and new sessions see `mcp__<name>__*` at their next tool-set assembly. `list()` derives live state from actually registered tool names (`connected`/`starting`/`error`/`disabled` + tool count), so reconnect outcomes surface without the bridge exposing internal events.
- **CLI** — `dsh mcp add|list|remove|enable|disable` in `apps/cli/src/mcp.ts` (new launcher mode `mcp`), writing the user registry (or the project one with `--project`) atomically; a running Host reconciles via its file watcher, no restart.
- **Wire API** — `api.mcp.list/save/remove` in the apiproxy domain `mcp` (contract `packages/host/apiproxy/src/api/mcp.ts`, zod schemas, `RpcMethodMap` keys, fetch handler + client rows, `ApiProxyService.mcp`), with three new `RpcErrorDetailsMap` codes. Only the user registry is writable from the browser; project entries render read-only.
- **Web GUI** — `packages/client/ui-settings-mcp` registers the settings section `mcp` (order 25): server rows with live state and tool count, an add-server form (stdio/HTTP fields), remove; project rows badge read-only. Copy ships as en/ru/zh dictionaries under the `settings.mcp` namespace.

Scope and naming follow the layered-registry architecture note (deployment-level tools register globally). The registry is user data, not a preset: every agent of every preset sees the user's MCP servers, exactly like a user-scope `.mcp.json` in Claude Code. No server starts unless a registry declares it — the trusted-code default from the CLI README stays intact.

## Alternatives considered

**Store the registry in `settings.yaml` namespaces.** Rejected: the user asked for the interoperable `mcpServers` file shape they already use in Claude Code/Cursor, and a settings namespace cannot be read by those tools or by hand as a plain file.

**Let the GUI/CLI write `cordis.patch.yml` rows directly.** Rejected: the wire format would be DSH-specific, project `.mcp.json` still needed a reader, and the GUI has no existing patch-authoring path; a dedicated service keeps one data model for CLI/UI/host.

**Per-session or per-preset server selection.** Rejected for v1: the registry is a host-level opt-in (like user-scope MCP configs elsewhere); per-session scoping can build on `mcp__<name>__*` filters later.

**Full entry editing / enable-disable in the GUI.** Rejected for v1: the wire view intentionally omits full entry bodies; replace = save-over-same-name, disable/enable live in the CLI and the registry file.

## Tests

- **Unit** (`packages/mcp/mcp-servers/tests/registry.spec.ts`, `mcp-servers.spec.ts` with a mocked bridge): entry parsing/validation/interpolation, transport derivation, document-level error plans, save/remove convergence, user-over-project duplicate resolution, disabled entries, malformed-registry refusal, HMR-safety disposal. `apps/cli/tests/mcp.spec.ts` + args routing: registry file effects and exit codes. `packages/host/apiproxy/tests/api-proxy-mcp.spec.ts`: the domain over a faked registry. `packages/client/ui-settings-mcp/tests/apply.client.spec.ts`: slot registration + locale-following label.
- **Real composition** (`packages/mcp/mcp-servers/tests/mcp-servers.e2e.ts`, keyless, e2e config): boots the real Loader over a test-only composition with the package fixture MCP server and proves registry → deploy → `mcp__fixture__greet` registered and reported connected.
- **Web snapshot** (`apps/web/tests/settings-chrome.e2e.ts`): regenerated, the settings dialog now lists the `MCP 服务器`/`MCP servers` nav entry.

## Consequences

- Users add servers by GUI, CLI, or file; the Host reconciles live. The user registry is `$DSH_HOME/mcpServers.json`; the project `.mcp.json` is read automatically (name conflicts resolve to user scope, logged).
- Trust boundary is explicit: a registry entry is trusted code outside the agent sandbox; an empty registry deploys nothing, and the base-bundle row is inert without one.
- Token cost and tool naming follow the existing `mcp-client` model experience; the connector only changes how servers get deployed, not how tools appear.
- Status is derived (registered tool names), not observed: mid-reconnect shows `starting`; detailed diagnostics stay in Host logs. Real-time GUI status push is deferred.
- The apiproxy/generator policy files gained type-classification rows for the new package's public types and the `mcpServers` service (catalog page `tools.md`).
