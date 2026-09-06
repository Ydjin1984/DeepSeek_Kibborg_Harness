# @deepseek-ai/dsh-mcp-servers

English | [中文](README.zh.md)

MCP server registry connector: the deployment-level row that turns MCP servers declared in the user registry (`$DSH_HOME/mcpServers.json`) and the project registry (`<cwd>/.mcp.json`) into live [`@deepseek-ai/dsh-mcp-client`](../mcp-client/README.md) instances. Tools appear on the host's global tool layer as `mcp__<serverName>__<tool>` and are visible to every agent session.

## Usage

Add a server to the user registry, either through the CLI (`dsh mcp add`), the browser settings section, or by writing the file directly:

```json
{
  "mcpServers": {
    "filesystem": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem"], "cwd": "/tmp" },
    "github":     { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-github"], "env": { "GITHUB_TOKEN": "…" } },
    "remote":     { "url": "https://…/mcp", "headers": { "Authorization": "Bearer …" } }
  }
}
```

The entry format is the Claude Code / Cursor / VS Code `mcpServers` convention: `url` selects the streamable-HTTP transport, otherwise `command` starts a stdio child. The file is watched, so an added, edited, or removed server reconciles live — no Host restart. A project `.mcp.json` next to the host working directory is read automatically; a project name already declared in the user registry is skipped (user scope wins). `${VAR}` references in `command`/`args`/`env`/`cwd`/`url`/`headers` resolve from the process environment. `enabled: false` keeps an entry listed but undeployed.

Declaring a server is an explicit opt-in: its command is trusted executable code outside the agent sandbox, and an empty registry deploys nothing.

## Config

| Field | Default | Description |
|---|---|---|
| `userFile` | `$DSH_HOME/mcpServers.json` | User-registry file; absolute paths honored verbatim, relative paths resolve against the home |
| `includeProjectFile` | `true` | Whether `<cwd>/.mcp.json` is read |
| `projectFile` | `.mcp.json` | Project-registry file name resolved against the host working directory |
| `watch` | `true` | Watch both registry files and reconcile automatically |

## Behavior

- On start the service reads both registries and deploys one `mcp-client` instance per valid enabled server, awaiting initial connection without blocking Host readiness (a failed server logs through its supervisor and keeps its slot).
- Registry changes converge the deployed set: an edited entry redeploys over the old generation (dispose + fresh connect), a removed or disabled entry disposes cleanly.
- `mcpServers.list()` reports live status per server: `connected` when at least one `mcp__<name>__*` tool is registered, `starting` while the supervisor connects or reconnects, `error` for validation or deployment failures, `disabled` for `enabled: false` entries. Errors are also visible in Host logs.
- The service is mounted in the base bundle, so every profile (web, CLI, headless) exposes the user's registry; no server starts unless a registry declares it.

## Services consumed

| Service | Usage |
|---|---|
| `ctx.tools` | Read registered schemas to derive per-server connection state and tool counts |

## Model Experience

### Discovered MCP tools

#### What the model sees

Every deployed server contributes the `mcp__<serverName>__<rawName>` tools its `mcp-client` instance discovers — the same naming and schema passthrough documented in the `dsh-mcp-client` README. Because registration lands on the global tool layer, a tool added from the registry becomes visible to running and future sessions at their next tool-set assembly.

#### Token effect

Registry tools are regular registered tools; their schema cost follows the `dsh-mcp-client` model experience. Registry and status data never enter model context.

#### KV Cache effect

Adding, removing, or editing a server changes the deployed tool set and therefore the model-facing definitions; otherwise the registry contributes nothing beyond the bridge's own prefix-stable behavior.

## Known Limitations and Deferred Work

- **Tools are the only bridged MCP capability** — inherited from `dsh-mcp-client` (Resources and Prompts have no harness consumer).
- **Status is derived, not observed** — connection state is inferred from registered tool names plus mount success, so a server whose supervisor is mid-reconnect shows `starting` rather than an explicit reconnect counter; detailed diagnostics live in Host logs.
- **Project scope is single-rooted** — the project registry resolves against the host working directory (one `.mcp.json`), not per session workspace.
- **No real-time browser push** — the settings UI refreshes the status list on open and after each mutation; it does not subscribe to live state changes.
