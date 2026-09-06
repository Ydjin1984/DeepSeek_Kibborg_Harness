# MCP — 模型上下文协议

[English](README.md) | 中文

将 harness 与 MCP 生态系统桥接的包。

| 包 | 职责 |
|---|---|
| [`mcp-client/`](mcp-client/README.md) | MCP 客户端桥接，将外部服务器工具注册到 `ctx.tools` |
| [`mcp-servers/`](mcp-servers/README.md) | MCP 服务器注册表连接器：为 `$DSH_HOME/mcpServers.json` 和项目 `.mcp.json` 中声明的每个服务器部署一个 `mcp-client`（可通过 Web 设置分区、`dsh mcp` 或手写文件管理） |
