# @deepseek-ai/dsh-client-ui-settings-mcp

[English](README.md) | 中文

MCP 服务器设置分区（MCP 注册表连接器的浏览器侧）。它在 Web 设置对话框里新增一个 **MCP servers** 页面：用户列出运行中 Host 部署的服务器（用户注册表 + 项目 `.mcp.json`），查看每台服务器的实时状态与已注册工具计数，通过 Claude Code 兼容的 `mcpServers` 表单（stdio command/args/env/cwd 或 HTTP url/headers）添加服务器，并删除或替换用户范围的服务器。

该分区纯粹是 [`api.mcp`](../../host/apiproxy/README.md) wire 域之上的展示层：`list`、`save`（添加或替换一个用户注册表服务器）和 `remove`。Host（`@deepseek-ai/dsh-mcp-servers`）负责校验、持久化到 `$DSH_HOME/mcpServers.json` 并部署服务器；分区在打开时、每次变更后以及手动点击刷新按钮时刷新列表。项目范围服务器（`.mcp.json`）以带徽标的只读方式渲染，因为它们是以文件方式编辑的。

## Model Experience

### MCP 服务器设置页面

#### 模型看到什么

设置页面是部署管理界面，不是对话界面：它管理 Host 部署哪些外部 MCP 服务器，本身不贡献任何提示词文本、模型可见状态或会话日志事件。对模型的变化是间接的——在这里保存的服务器由 `dsh-mcp-servers` 部署，其 `mcp__<server>__<tool>` 工具出现在普通工具集中，相关模型体验由 `dsh-mcp-client` 与 `dsh-mcp-servers` README 记录。

#### Token 影响

页面本身不会给任何模型请求增加 token。从注册表部署的工具携带自身的 schema 成本，与任何其他已注册工具相同。

#### KV Cache 影响

页面不向请求前缀贡献任何内容。添加或删除服务器会改变已部署工具集合，从而在下次工具集装配时改变面向模型的定义，其前缀稳定性后果由注册表连接器文档记录。

## 已知限制与延后工作

- **项目服务器只读列表** —— 浏览器只编辑用户注册表；项目条目在 `.mcp.json` 中编辑（也可通过 `dsh mcp ... --project`）。
- **不支持就地编辑** —— 替换服务器 = 同名覆盖保存或先删后加；wire 的 `save` 会替换整个条目。
- **无推送状态更新** —— 分区在打开时与每次变更后刷新，另有手动刷新按钮；未来的 MCP 状态宿主事件将去掉手动步骤。
