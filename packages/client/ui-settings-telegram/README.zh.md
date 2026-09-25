# @deepseek-ai/dsh-client-ui-settings-telegram

[English](README.md) | 中文

Telegram 设置分区（`settings.section` 条目 `telegram`）：编辑 `telegram` 设置命名空间（`botToken`、`chatId`），并通过 wire `telegram` API（`api.telegram.test`）驱动桥接连通性测试。

## 设置分区

| 字段 | 值 |
| --- | --- |
| id | `telegram` |
| locale namespace | `settings.telegram` |

## 模型体验

无。该分区只写入宿主 settings；镜像会话的所有模型可见影响都由 telegram 桥接持有。

#### KV Cache 影响

无；该包既不组装也不发送提供方请求。

## 已知限制与暂缓事项

- 分区对 token 刻意只写：`botToken` 是 `role('secret')` settings 字段，因此镜像绝不把它返回浏览器。token 字段初始为空，只报告是否已配置（徽标来自 `api.telegram.status({})`）；token 字段留空不会改动已存 token，而「Clear token」会删除它。
- 已配置徽标来自存活的桥接（`status`），因此在桥接真正加载 settings 之前，它读到的是 `not configured`。
- 文案提供 en/ru/zh 三种；分区本身不自动检测语言。
