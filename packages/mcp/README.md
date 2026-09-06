# MCP — Model Context Protocol

English | [中文](README.zh.md)

Packages bridging the harness to the MCP ecosystem.

| Package | Role |
|---|---|
| [`mcp-client/`](mcp-client/README.md) | MCP client bridge that registers external server tools on `ctx.tools` |
| [`mcp-servers/`](mcp-servers/README.md) | MCP server registry connector: deploys one `mcp-client` per server declared in `$DSH_HOME/mcpServers.json` and the project `.mcp.json` (managed through the Web settings section, `dsh mcp`, or by hand) |
