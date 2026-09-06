# @deepseek-ai/dsh-mcp-servers

[English](README.md) | 中文

MCP 服务器注册表连接器：部署级组件，把用户注册表（`$DSH_HOME/mcpServers.json`）和项目注册表（`<cwd>/.mcp.json`）中声明的 MCP 服务器变成活的 [`@deepseek-ai/dsh-mcp-client`](../mcp-client/README.md) 实例。工具以 `mcp__<serverName>__<tool>` 出现在宿主的全局工具层，并对每个 agent 会话可见。

## 用法

通过 CLI（`dsh mcp add`）、浏览器设置分区或直接写文件，把服务器加入用户注册表：

```json
{
  "mcpServers": {
    "filesystem": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem"], "cwd": "/tmp" },
    "github":     { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-github"], "env": { "GITHUB_TOKEN": "…" } },
    "remote":     { "url": "https://…/mcp", "headers": { "Authorization": "Bearer …" } }
  }
}
```

条目格式遵循 Claude Code / Cursor / VS Code 的 `mcpServers` 约定：有 `url` 选择 streamable-HTTP 传输，否则 `command` 启动 stdio 子进程。文件被监听，因此添加、编辑或删除服务器都会实时 reconcile，无需重启 Host。宿主工作目录旁的项目 `.mcp.json` 会被自动读取；已在用户注册表中声明的项目名会被跳过（用户范围优先）。`command`/`args`/`env`/`cwd`/`url`/`headers` 中的 `${VAR}` 引用会从进程环境解析。`enabled: false` 让条目保留但不再部署。

声明服务器是显式 opt-in：它的命令是在 agent 沙箱之外运行的受信任代码，空注册表不部署任何内容。

## Config

| 字段 | 默认值 | 说明 |
|---|---|---|
| `userFile` | `$DSH_HOME/mcpServers.json` | 用户注册表文件；绝对路径原样使用，相对路径基于 home 解析 |
| `includeProjectFile` | `true` | 是否读取 `<cwd>/.mcp.json` |
| `projectFile` | `.mcp.json` | 基于宿主工作目录解析的项目注册表文件名 |
| `watch` | `true` | 监听两个注册表文件并自动 reconcile |

## 行为

- 启动时服务读取两个注册表，并为每个有效的已启用服务器部署一个 `mcp-client` 实例，等待初始连接但不阻塞 Host 就绪（失败的服务器通过其 supervisor 记录日志并保留槽位）。
- 注册表变化收敛部署集合：编辑过的条目会基于旧代重新部署（dispose + 新连接），删除或禁用的条目干净释放。
- `mcpServers.list()` 报告每个服务器的实时状态：注册了至少一个 `mcp__<name>__*` 工具时为 `connected`，supervisor 连接或重连时为 `starting`，校验或部署失败为 `error`，`enabled: false` 条目为 `disabled`。错误也会出现在 Host 日志中。
- 服务挂载在 base bundle 中，因此每个 profile（web、CLI、headless）都能使用用户的注册表；除非注册表声明了服务器，否则不会启动任何服务器。

## 消费的服务

| 服务 | 用途 |
|---|---|
| `ctx.tools` | 读取已注册 schema，推导每个服务器的连接状态与工具计数 |

## Model Experience

### 已发现的 MCP 工具

#### 模型看到什么

每个已部署服务器贡献其 `mcp-client` 实例发现的 `mcp__<serverName>__<rawName>` 工具——命名与 schema 透传与 `dsh-mcp-client` README 中记录的一致。由于注册落在全局工具层，从注册表添加的工具会在下次工具集装配时对运行中的与未来的会话可见。

#### Token 影响

注册表工具是普通注册工具；其 schema 成本遵循 `dsh-mcp-client` 的模型体验。注册表与状态数据从不进入模型上下文。

#### KV Cache 影响

添加、删除或编辑服务器会改变已部署的工具集合，从而改变面向模型的定义；除此之外，注册表在桥接自身前缀稳定行为之外不贡献任何内容。

## 已知限制与延后工作

- **Tools 是唯一桥接的 MCP 能力** —— 继承自 `dsh-mcp-client`（Resources 与 Prompts 没有 harness 消费方）。
- **状态是推导的，不是观察的** —— 连接状态依据已注册工具名加挂载成功来推断，因此 supervisor 处于重连中的服务器显示 `starting` 而非显式的重连计数；详细诊断在 Host 日志中。
- **项目范围是单根的** —— 项目注册表基于宿主工作目录解析（一个 `.mcp.json`），而不是按会话工作区。
- **无浏览器实时推送** —— 设置 UI 在打开时与每次变更后刷新状态列表；它不订阅实时状态变化。
