# dsh-debug-log

[English](README.md) | 中文

进程内 UI 诊断追踪器，由 Host API 网关、mux 下行、浏览器会话运行时和 Execution 视图共用。它是**库，而非插件**：没有 `ctx`、没有设置 schema、没有事件。启用状态是本进程中的布尔值；[`ui-settings-general`](../../client/ui-settings-general/README.md) 中「通用」分区的开关是产品入口，它写入 `ui-debug` namespace，并在两端调用 `setUiDebugEnabled`。

开启后，每条记录都是一行以 `[dsh-debug]` 为前缀的 `console.info`，因此 Host 终端（启动菜单第 9 项）和浏览器 DevTools 可用同一关键字过滤。关闭时调用方只做一次布尔判断后返回。高频 mux 与实时事件路径使用 `uiDebugTick`（每秒一条汇总），而不是每帧一行。客户端包会内联本库；启用状态存在 `globalThis` 上，因此这些副本共用一个开关。

[Agent Note](../../../.agents/notes/implemented/feature/2026-09-17-ui-debug-timings.md) 说明为何采用进程内追踪器，而不是 debug RPC。

## 对外接口

```ts
import {
  installUiDebugSink, isUiDebugEnabled, setUiDebugEnabled,
  uiDebug, uiDebugSpan, uiDebugSpanSync, uiDebugTick,
} from '@deepseek-ai/dsh-debug-log'

setUiDebugEnabled(true)
uiDebug('session', 'open', { sessionId: 'ses_1' })
const page = await uiDebugSpan('rpc', 'session.history', { sessionId: 'ses_1' }, load)
uiDebugTick('mux', 'downlink', { type: 'assistant/chunk' })
```

| 导出项 | 职责 |
|---|---|
| `setUiDebugEnabled(next)` | 进程开关。false→true 写入 `debug.enabled`；true→false 先刷新计量再写 `debug.disabled`。 |
| `isUiDebugEnabled()` | 读取开关。 |
| `uiDebug(area, action, data?)` | 一条即时记录。 |
| `uiDebugSpan` / `uiDebugSpanSync` | 为 `fn` 计时，附加 `+N.Nms`。抛出时记录 `ok=false` 并重新抛出。 |
| `uiDebugTick(area, action, data?)` | 计入 1 秒汇总（`count`、`byType`）。 |
| `installUiDebugSink(write)` | 测试钩子，替换 `console.info`。 |
| `UI_DEBUG_PREFIX` | `[dsh-debug]`。 |

`data` 保持紧凑：数组渲染为 `[n]`，对象为 `{n}`，超过 80 个字符的字符串会被截断。追踪器从不转储整页历史或 mux 载荷。

## 模型体验

无。记录只进入操作者控制台；这里没有任何内容进入模型请求。

#### KV Cache 影响

无；该包既不组装也不发送提供方请求。

## 已知限制与暂缓事项

- **每个进程有自己的开关。** Host 控制台显示 Host 跨度；浏览器控制台显示客户端跨度。没有把浏览器行复制到 Host stdout 的 debug RPC。
- **追踪器不是性能分析器。** 亚毫秒级工作可能报告 `+0.0ms`；用它查找会话列表、inspect、history、组装器和 Execution 视图重建上的多毫秒停顿。
