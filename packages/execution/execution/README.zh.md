# @deepseek-ai/dsh-execution

[English](README.md) | 中文

DeepSeek Harness 的统一执行生命周期状态机。

## 目的

提供一个**观测优先**的层，把多个子系统（后台任务、Goal、工作流、subagent、操作）的执行状态投影进单一状态机，而不拥有它们的生命周期。现有子系统保留各自的 API；适配器把其状态映射到这套统一词汇中。

## 规范化状态

| 状态 | 含义 |
|---|---|
| `CREATED` | 已注册，但尚未入队或启动 |
| `QUEUED` | 已排定，等待被取用 |
| `RUNNING` | 正在执行 |
| `WAITING_TOOL` | 阻塞于工具调用 |
| `WAITING_SUBAGENT` | 阻塞于 subagent 结果 |
| `WAITING_USER` | 阻塞于用户输入／批准 |
| `INTERRUPTED` | 已中断，等待恢复或中止 |
| `RECOVERING` | 正在从中断中恢复 |
| `COMPLETED` | 已成功完成 |
| `FAILED` | 因错误终止 |
| `CANCELLED` | 被调用方取消 |
| `TIMEOUT` | 超过时限 |
| `ABORTED` | 被强制中止 |

## 转换表

```
(none) ─start/queue→ CREATED ─queue→ QUEUED ─start→ RUNNING ─complete→ COMPLETED
                                      │                    ├─fail→ FAILED
                                      │                    ├─cancel→ CANCELLED
                                      │                    ├─interrupt→ INTERRUPTED ─recover→ RECOVERING ─resume→ RUNNING
                                      │                    │                                   ├─abort→ ABORTED
                                      │                    │                                   └─fail→ FAILED
                                      │                    ├─timeout→ TIMEOUT
                                      │                    └─abort→ ABORTED
                                      ├─fail→ FAILED
                                      └─cancel→ CANCELLED

RUNNING ─wait-tool→ WAITING_TOOL ─resume→ RUNNING (cycle)
                    ├─cancel→ CANCELLED
                    ├─timeout→ TIMEOUT
                    └─abort→ ABORTED

RUNNING ─wait-subagent→ WAITING_SUBAGENT ─resume→ RUNNING
                                        ├─cancel→ CANCELLED
                                        └─timeout→ TIMEOUT

RUNNING ─wait-user→ WAITING_USER ─resume→ RUNNING
                     ├─cancel→ CANCELLED
                     └─timeout→ TIMEOUT

Terminal (COMPLETED/FAILED/CANCELLED/TIMEOUT/ABORTED) — no outgoing transitions
```

## v1 范围

- **仅投影／观测。** 注册表拥有一份进程内的仅追加事件日志。
- **不管理生命周期。** 原生子系统（后台任务、Goal 等）继续拥有其执行。
- **可选适配器。** jobs 适配器（位于 `dsh-jobs`）是安全的：`ctx.executions` 缺席时，jobs 通过 `ctx.get('executions')` 照常工作。
- **与诊断无关。** 产品插件不注入 `invariants`；该注入位于 `./invariant` 配套组件上。发行配置不会把 invariants 注册表作为插件行挂载。

## API

### `ExecutionService` (`ctx.executions`)

```ts
import type { Context } from '@deepseek-ai/cordis'
import type { ExecutionEventTypeCode } from '@deepseek-ai/dsh-execution'
import type { ExecutionKind, ExecutionStatus } from '@deepseek-ai/dsh-execution/types'

declare const ctx: Context
declare const kind: ExecutionKind
declare const executionId: string
declare const options: Parameters<typeof ctx.executions.register>[2]
declare const eventCode: ExecutionEventTypeCode
declare const terminalStatus: ExecutionStatus
declare const listener: Parameters<typeof ctx.executions.on>[0]
declare const opts: Parameters<typeof ctx.executions.resources.acquire>[0]
declare const resourceId: string
declare const now: number

ctx.executions.register(kind, executionId, options)  // → CREATED state
ctx.executions.transition(executionId, eventCode)     // → new state (SM enforced)
ctx.executions.end(executionId, terminalStatus)       // → force terminal
ctx.executions.get(executionId)                       // → state copy | undefined
ctx.executions.list()                                 // → all states
ctx.executions.listByKind(kind)                       // → filtered states
ctx.executions.on(listener)                           // → subscribe to events
ctx.executions.resources.acquire(opts)                // → ResourceLease
ctx.executions.resources.heartbeat(resourceId)        // → extend TTL
ctx.executions.resources.release(resourceId)          // → released
ctx.executions.resources.get(resourceId)              // → lease copy | undefined
ctx.executions.resources.list()                       // → all lease copies
ctx.executions.resources.status(resourceId, now)      // now?: number → fail-closed status
ctx.executions.resources.sweep(now)                   // now?: number → orphaned leases
ctx.executions.resources.isLive(resourceId, now)      // now?: number → boolean health check
```

### 资源租约注册表

跟踪外部资源租约（chrome、pty、ida、workspace、subprocess），包括：

- **租约获取** — 设置 TTL、可选提供方、所有者执行、恢复策略。
- **心跳** — 从心跳时刻起延长 TTL。
- **遗留清理** — 检测已过期租约，将其转入 `orphaned`。
- **fail-closed 辅助函数** — `status()` 与 `isLive()`，用于不做修改的快速健康检查。

### 事件

每个执行生命周期事件都会发出 `ctx.emit('execution/event', { event })`。

每个资源租约事件（获取、心跳、释放、遗留）都会发出 `ctx.emit('executions/resource', { event })`。

## 模型体验

无。注册表只在进程内记录执行生命周期状态；其记录的所有模型可见投影都由消费方拥有。

#### KV Cache 影响

无；该包既不组装也不发送提供方请求。

## 已知限制与暂缓事项

- **持久性** — `ExecutionEvent` 仅存在于内存中；持久化计划在 v2 提供。
- **资源租约** — `resourceRef` 字段预留给 `ExecutionState` 中的 T3 租约集成；从执行到资源的实际关联（T3-v2）属于后续切片。
- **资源注册表持久性** — `ResourceLeaseRegistry` 仅存在于内存中（v1）；持久化资源事件与基于 SQLite 的崩溃对账计划在 v2 提供。
- **跨进程** — 注册表限于进程内；没有分布式协调。
