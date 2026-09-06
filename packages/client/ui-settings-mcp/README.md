# @deepseek-ai/dsh-client-ui-settings-mcp

English | [中文](README.zh.md)

MCP servers settings section (browser half of the MCP registry connector). It adds an **MCP servers** page to the Web settings dialog where a user lists the servers the running Host deploys from (user registry + project `.mcp.json`), sees each server's live state and registered tool count, adds a server through the Claude-Code-compatible `mcpServers` form (stdio command/args/env/cwd or HTTP url/headers), and removes or replaces user-scope servers.

The section is pure presentation over the [`api.mcp`](../../host/apiproxy/README.md) wire domain: `list`, `save` (add-or-replace one user-registry server), and `remove`. The Host (`@deepseek-ai/dsh-mcp-servers`) validates, persists to `$DSH_HOME/mcpServers.json`, and deploys the server; the section refreshes its list on open, after every mutation, and on the manual refresh button. Project-scope servers (`.mcp.json`) render read-only with a badge, because they are edited as files.

## Model Experience

### The MCP servers settings page

#### What the model sees

The settings page is a deployment-management surface, not a conversation surface: it manages which external MCP servers the Host deploys, and it contributes no prompt text, no model-visible state, and no session-log events of its own. What changes for the model is indirect — a server saved here is deployed by `dsh-mcp-servers` and its `mcp__<server>__<tool>` tools appear in the ordinary tool set, whose model experience the `dsh-mcp-client` and `dsh-mcp-servers` READMEs document.

#### Token effect

The page itself adds no tokens to any model request. Tools deployed from the registry carry their own schema cost, identical to any other registered tool.

#### KV Cache effect

The page contributes nothing to the request prefix. Adding or removing a server changes the deployed tool set and therefore the model-facing definitions at the next tool-set assembly, with the prefix-stability consequences documented by the registry connector.

## Known Limitations and Deferred Work

- **Read-only listing for project servers** — the browser edits only the user registry; project entries are edited in `.mcp.json` (also via `dsh mcp ... --project`).
- **No in-place editing** — replacing a server is add-over-same-name or remove + add; the wire `save` replaces the whole entry.
- **No pushed status updates** — the section refreshes on open and after each mutation plus the manual refresh button; a future MCP-status host event would remove the manual step.
