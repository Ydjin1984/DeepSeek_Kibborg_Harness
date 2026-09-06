# Agent Note: MCP 服务器注册表连接器——无需编辑 cordis.yml 的用户级 MCP

Status: implemented

[English](2026-09-06-mcp-server-registry-connector.md) | 中文

## Problem

[MCP 客户端](2026-07-07-mcp-client-plugin.md)让 MCP 工具可用，但连接服务器的唯一方式是手写 `cordis.yml`/overlay 行。Web GUI 完全没有 MCP 界面，也没有 CLI——用户在 Claude Code / Cursor / VS Code 中常见的流程（添加服务器、使用 `mcp__<server>__<tool>` 工具）并不存在。用户要求像在 Claude Code / VS Code / Cursor 中那样配置服务器：`mcpServers` 形状的注册表、自动读取项目配置、CLI 命令和 GUI 分区。

## Decision

在既有桥接层之上新增一个部署级注册表连接器：

- **注册表格式** —— Claude Code 兼容的 `mcpServers` 文档，分两个范围：用户注册表 `$DSH_HOME/mcpServers.json` 和项目注册表 `<cwd>/.mcp.json`（像 Claude Code 一样自动读取）。没有 `url` 即选择 stdio（`command`/`args`/`env`/`cwd`）；`url`/`headers` 选择 Streamable HTTP。扩展：`enabled: false`（部署开关）和基于进程环境的 `${VAR}` 插值。
- **新包 `packages/mcp/mcp-servers`**（`@deepseek-ai/dsh-mcp-servers`，服务 `ctx.mcpServers`，挂载在 `base` bundle 中，因此每个 profile——web、CLI、headless——都能使用注册表）：监听两个文件，用纯模块 `src/registry.ts` 解析/校验，并通过在未追踪的服务上下文上程序化调用 `ctx.plugin()` 为每个有效的已启用服务器部署一个 `mcp-client` 实例。reconcile 是串行链；编辑过的条目会基于配置签名差异重新部署，删除/禁用/无效条目会被释放。工具落在全局工具层，因此现有和新会话在下次工具集装配时都能看到 `mcp__<name>__*`。`list()` 根据实际注册的工具名推导实时状态（`connected`/`starting`/`error`/`disabled` 加工具计数），无需桥接层暴露内部事件。
- **CLI** —— `apps/cli/src/mcp.ts` 中的 `dsh mcp add|list|remove|enable|disable`（新的 launcher 模式 `mcp`），原子地写入用户注册表（带 `--project` 则写项目注册表）；运行中的 Host 通过文件 watcher 自动 reconcile，无需重启。
- **Wire API** —— apiproxy `mcp` 域中的 `api.mcp.list/save/remove`（契约 `packages/host/apiproxy/src/api/mcp.ts`、zod schemas、`RpcMethodMap` keys、fetch handler/client 行、`ApiProxyService.mcp`），并在 `RpcErrorDetailsMap` 中新增三个错误码。浏览器只能写用户注册表；项目条目只读。
- **Web GUI** —— `packages/client/ui-settings-mcp` 注册设置分区 `mcp`（order 25）：带实时状态和工具计数的服务器行、添加服务器表单（stdio/HTTP 字段）、删除；项目行带只读徽标。文案以 en/ru/zh 字典放在 `settings.mcp` namespace 下。

范围与命名遵循 layered-registry 架构笔记（部署级工具全局注册）。注册表是用户数据而非 preset：每个 preset 的每个 agent 都能看到用户的 MCP 服务器，正如 Claude Code 的用户级 `.mcp.json`。除非注册表声明了服务器，否则不会启动任何服务器——CLI README 中的「受信任代码」默认保持不变。

## Alternatives considered

**把注册表放进 `settings.yaml` namespaces。** 不予采纳：用户要求的是他们在 Claude Code/Cursor 中已经在用的可互操作 `mcpServers` 文件形态，而 settings namespace 无法被这些工具或手工当作普通文件读取。

**让 GUI/CLI 直接写 `cordis.patch.yml` 行。** 不予采纳：wire 格式会变成 DSH 专属，项目 `.mcp.json` 仍然需要读取器，而且 GUI 没有现成的 patch 编写路径；专用服务让 CLI/UI/host 共用同一数据模型。

**按会话或按 preset 选择服务器。** v1 不予采纳：注册表是 host 级 opt-in（类似别处的用户级 MCP 配置）；按会话的范围划分以后可以基于 `mcp__<name>__*` 过滤建立。

**在 GUI 中完整编辑条目 / 启用禁用。** v1 不予采纳：wire 视图有意省略完整条目体；替换 = 同名保存，启用/禁用放在 CLI 和注册表文件中。

## 测试

- **单元**（`packages/mcp/mcp-servers/tests/registry.spec.ts`、带 mock 桥接的 `mcp-servers.spec.ts`）：条目解析/校验/插值、传输推导、文档级错误计划、保存/删除收敛、用户优先于项目的重名处理、禁用条目、损坏注册表拒绝、HMR 安全释放。`apps/cli/tests/mcp.spec.ts` 与 args 路由：注册表文件效果与退出码。`packages/host/apiproxy/tests/api-proxy-mcp.spec.ts`：在假注册表之上的域。`packages/client/ui-settings-mcp/tests/apply.client.spec.ts`：槽位注册与随语言变化的标签。
- **真实组合**（`packages/mcp/mcp-servers/tests/mcp-servers.e2e.ts`，keyless，e2e 配置）：用包内 fixture MCP 服务器在 test-only 组合上启动真实 Loader，并证明注册表 → 部署 → `mcp__fixture__greet` 已注册且报告为 connected。
- **Web 快照**（`apps/web/tests/settings-chrome.e2e.ts`）：已重新生成，设置对话框现在列出 `MCP 服务器`/`MCP servers` 导航项。

## Consequences

- 用户通过 GUI、CLI 或文件添加服务器；Host 实时 reconcile。用户注册表是 `$DSH_HOME/mcpServers.json`；项目 `.mcp.json` 自动读取（名称冲突按用户范围解决并记录日志）。
- 信任边界明确：注册表条目是 agent 沙箱之外的受信任代码；空注册表不部署任何内容，base bundle 行在没有注册表时是惰性的。
- token 成本与工具命名沿用既有 `mcp-client` 模型体验；连接器只改变服务器的部署方式，不改变工具的出现方式。
- 状态是推导的（已注册工具名），不是观察的：重连中显示 `starting`；详细诊断留在 Host 日志。实时 GUI 状态推送延后。
- apiproxy/生成器策略文件为新的公开类型和 `mcpServers` 服务（目录页 `tools.md`）增加了类型分类行。
