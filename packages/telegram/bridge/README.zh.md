# @deepseek-ai/dsh-telegram-bridge

[English](README.md) | 中文

面向 Web GUI（`dsh web`）的 Telegram 镜像桥接。会话镜像挂接期间，桥接通过 Bot API 长轮询把会话的实时事件流镜像到已配置的 Telegram 聊天，把用户的消息与回答中继回会话，并在聊天中应答 `ctx.userQuestions`（选项按钮或自由文本）。

## 架构

- `TelegramBridgeService`（默认导出，一个 cordis `Service`）是 API 网关消费的宿主侧接口（`ctx.get('telegramBridge')`，网关侧对其按结构声明类型）：`status`、`attach`、`detach`、`test`。
- `BotClient` 是 Bot API 之上的一层薄 fetch 包装层（JSON 调用加上 multipart 形式的 `sendDocument` 上传）；`ChatTransport` 是镜像与问题提供方据以渲染的 seam（单元测试使用内存记录器）。
- 镜像订阅 `ctx.on('session/event', ...)`，并忽略除已挂接会话之外的其他会话；只有 `attach` 之后的事件才会转发。
- 问题通道是一个 `ctx.userQuestions` 提供方，仅在镜像挂接期间注册；一旦任一通道作答，共享服务就会中止其余竞争通道（含 Web GUI）。
- 出站渲染：用户行带 `👤` 前缀，助手文本流入一条可编辑消息（防抖编辑，按 Telegram 4096 字符上限分片），工具调用渲染为紧凑的动作行（`🛠 <command>` 风格，可用时采用展示转换器给出的标题），工具结算后追加 `— ✅` / `— ❌` 后缀。
- 以 `completed` 结束的轮次会把模型的最终回答作为 `Final_Report.md` 文档上传（会话、轮次、完成时间，随后是原样回答），并带有 `✅ Задание выполнено` 说明文字；上传被拒时会退回到把报告文本作为聊天消息发送。以其他任何方式结束的轮次不上传任何内容。
- `ask_user_question` 批次以聊天问题到达：单选题使用内联按钮，多选题使用编号文本说明；自由形式的问题接受纯文本回答。同一时间只提问一个问题，因此每个回答都没有歧义。
- 设置位于 `telegram` 设置命名空间（`botToken` 是 `role('secret')` 字段；`apiBaseUrl` 是测试/代理 seam）。设置一旦变更，轮询即重启。

## 模型体验

间接地，通过会话的用户消息路径：聊天回复以普通用户消息送达，请求组装由会话负责。

#### KV Cache 影响

无；桥接转发的是会话已经组装好的事件，从不构建提供方请求。

## 已知限制与暂缓事项

- 长轮询会对 `api.telegram.org` 保持一条 HTTP 连接；被防火墙拦截或离线的宿主每 5 秒重试一次。`Unauthorized` 响应会停止轮询，直到设置变更。
- 多选题用数字作答，而不是切换按钮。
- 流式文本超过 Telegram 长度上限时按硬消息边界分片（可能从词中间断开）。
- 收到的消息要求目标 agent（智能体）在本进程中存活（`ctx.agents.get`）；桥接不恢复冷会话。
