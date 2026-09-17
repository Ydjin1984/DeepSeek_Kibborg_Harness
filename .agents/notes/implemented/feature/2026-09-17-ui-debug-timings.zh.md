# Agent Note: 界面诊断耗时

Status: implemented

[English](2026-09-17-ui-debug-timings.md) | 中文

## 问题

页面刷新后，会话列表和当前会话流可能空白数秒，而 Telegram 已经显示该轮。盯着 Host 终端（启动菜单第 9 项）和浏览器 DevTools 的操作者没有一份可共用、可过滤的记录，说明等待花在何处：`session.list`、冷 inspect、历史分页、presenter scope、mux 升级、组装器 `replaceWindow`，还是 Execution 视图重建。

只在一个进程里临时打 `console.log` 无法解释 Host/浏览器拆分后的停顿；一直打开冗长日志又会扭曲正在测量的耗时。

## 决策

进程内追踪器放在 `@deepseek-ai/dsh-debug-log`。`setUiDebugEnabled` 是该进程中的布尔值；关闭时调用方只做一次判断后返回。开启后每条记录都是一行以 `[dsh-debug]` 为前缀的 `console.info`，带墙上时钟，跨度还带 `+N.Nms`。mux 帧和实时会话事件使用每秒一次的 `uiDebugTick` 汇总，而不是每个 chunk 一行。客户端包内联该库（purity gate 的 inline-safe 列表）；启用状态存在 `globalThis` 上，因此这些副本共用一个开关。

「通用」设置行持久化 `ui-debug.enabled`（默认 false）。Host 插件监视该 namespace 并设置 Host 开关；浏览器插件绑定同一 namespace 并设置浏览器开关。Host 跨度（RPC 处理、inspect、paginate、presentPage、listVisible、mux 下行）出现在 Host 终端；客户端跨度（RPC POST、连接握手、会话 open/history/installWindow、组装器、Execution 事件）出现在 DevTools。

## 曾考虑的替代方案

**用 debug RPC 把浏览器行复制到 Host stdout。** 否决：目标是找停顿，而不是在同一路径上再加一次往返；两个可过滤的控制台已经把 Host 工作和浏览器工作分开。

**始终开启 `console.debug`。** 否决：它会加热正在测量的刷新路径，且无法从产品 UI 关闭。

**只打 Chrome Performance mark。** 否决：坐在 Host 终端的操作者看不到它们，而 Host 的 inspect/list 正是停顿的另一半。

## 后果

打开该行会在该进程写入 `[dsh-debug] debug.enabled`；关闭时先刷新采样计量再写 `debug.disabled`。若上一页在开关关闭时加载，需要刷新一次才会开始记录。追踪器从不转储整页历史或 mux 载荷：数组渲染为 `[n]`，对象为 `{n}`。亚毫秒级工作可能报告 `+0.0ms`。

## Testing

工具库：`packages/util/debug-log/tests`。Host 启用与 schema 解码：`packages/client/ui-settings-general/tests/host.client.spec.ts`。行与 apply：`debug-row.client.spec.tsx`、`apply.client.spec.ts`。现有 session/history/mux 规格在开关关闭时继续覆盖被插桩的调用点。
