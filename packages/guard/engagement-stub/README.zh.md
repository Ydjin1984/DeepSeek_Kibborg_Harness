# @deepseek-ai/dsh-engagement-stub

[English](README.md) | 中文

仅拒绝的 engagement 边界：它拒绝目标落在已配置 engagement 范围之外的工具调用，并为每次拒绝记录一条审计事件。它不持有任何自己的模型上下文——工具注册表照常分发，本插件只回答某次调用能否继续。

## 接口面

- `ctx.events.emit('engagement/denied', { tool, reason, time })` 携带拒绝的审计记录；插件不注册任何会改写工具结果的监听链。
- 不注入任何服务：监听器通过 `ctx.on` 注册，拒绝在分发之前就已判定。
- 配置缺失即没有拒绝，因此未启用该边界的 profile 的行为与未挂载该插件完全相同。

## 模型体验

无。该 stub 只拒绝分发并发出审计事件；它不注册提示词、schema 或工具结果。

#### KV Cache 影响

无；该包既不组装也不发送提供方请求。
