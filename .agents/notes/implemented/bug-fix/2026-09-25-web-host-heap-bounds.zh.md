# Agent Note: Bounded host heap for prepared sessions, stream frames, and history reads

Status: implemented

[English](2026-09-25-web-host-heap-bounds.md) | 中文

## 问题

在一次压力测试中，`dsh web` 的宿主进程连续两次以 `FATAL ERROR: Ineffective mark-compacts near heap limit — JavaScript heap out of memory` 退出（退出码 134，运行约 18 分钟，heap 为 3576 MB 中的 3430 MB）。测得的主要开销来自一次 `session.history` 调用：宿主读取了某个会话的整份日志，把压缩的 chunk 段展开为独立事件，并保留了结果。该日志有 62,247 条存储行；这次读取产生了 1,898,119 个事件和 575 MB 存活 heap，而返回给客户端的数据只有 21 KB。展开后的结果随后一直驻留在 session-persistence 协调器的 prepared-session 池中，而该池只约束保留的条目数量，不约束这些条目的重量。一个 ready 条目就是一整份解码后的日志，因此五个由数十万事件构成的会话可以达到数 GB，而计数仍显示为五。

流路径存在同样形态的无界保留。当浏览器繁忙时，mux 与 host 帧队列会随 session 事件总线的产出一起增长，而 SSE 载体用 `for await` 循环推送来源，从不等待消费者需求。另外，两处 attached 会话读取会在每次调用时复制整个事件数组。

## 决策

`SessionPreparations` 除了按条目数量，也按保留重量约束其 ready 集合。构造函数接收 `capacity`、`maxReadyWeight` 和 `weightOf(source)`；`evictReady()` 会持续丢弃最旧的 ready 条目，直到两个预算都满足；而单个权重超过整个预算的条目根本不会被保留，因此一份超重日志无法占据该池。`PersistenceCoordinator` 以 `source.inspection.events.length` 作为权重，并在 `PersistenceCoordinatorOptions` 中暴露 `preparedSessionCacheMaxEvents`，与 `preparedSessionCacheSize` 一样按正安全整数校验。`DEFAULT_PREPARED_SESSION_CACHE_MAX_EVENTS` 为 500,000，并从 `@deepseek-ai/dsh-session-persistence` 再导出。

两个第一方后端在其 Schemastery `Config` 中携带同一字段并以该值作为默认，然后传给协调器：`@deepseek-ai/dsh-session-persistence-jsonl` 与 `@deepseek-ai/dsh-session-persistence-sqlite`。两者的 README 记录了该字段与默认值。

`@deepseek-ai/dsh-host-apiproxy` 中的 `FrameQueue` 最多持有 `MAX_QUEUED_STREAM_FRAMES`（4096）帧。达到上限时，它丢弃最旧的、消费者能够重建的帧，而不是继续增长，并累计丢弃次数，通过 `uiDebugTick('mux', 'drop', …)` 上报总数。在 mux 流上只有 `session/event` 帧可恢复：客户端会发现 seq 缺口并通过 `repairGap` 重新拉取尾部。改变客户端持有状态、消费者无法用其他方式重新获知的帧——`question/*`、`approval/*`、列表状态——绝不会为更晚的帧让路。当队列中已无可恢复帧时，流会结束，客户端重新订阅，而不是让宿主保留积压。host 流声明所有帧都不可恢复（`() => false`），因此其队列满时该流结束，重连时重新获取列表。

两处按调用复制的事件数组已移除。`readSessionState` 与 `subagent.history` 的 attached 分支改为直接给出 `attached.events`——即已冻结的 `Session.events` 快照——而不再做展开复制。

`fetch/handler.ts` 中的 `sseResponse` 改为每次消费者读取拉取一帧，而不再用 `for await` 加 `controller.enqueue` 推送来源。`cancel()` 通过 `iterator.return()` 关闭帧来源，`closeQuietly` 关闭可能已被消费者取消的 controller。

历史请求在 schema 层受限：`MAX_HISTORY_MESSAGES`（1,000）在 `sessions.schema.ts` 与 `subagents.schema.ts` 中同时限制 `maxMessages`。

## 考虑过的替代方案

- **只按条目数量约束 prepared 池。** 不采用。capacity 计的是条目，而每个条目都是一整份解码日志，所以计数对 heap 没有任何约束力；重量预算才让一份超重日志无法被保留。
- **为释放重量而淘汰 reserved 或 committing 条目。** 不采用。预留是独占所有者，它持有精确的 Session 直至发布，因此按重量淘汰只作用于 ready 条目，绝不打断进行中的恢复。
- **无论帧承载什么，都丢弃最旧的帧。** 不采用。approval 或 question 帧是客户端必须回答的状态的唯一载体，丢掉它会让交互搁浅，直到重连重放。
- **保留 `for await` 加 `controller.enqueue` 的推送循环。** 不采用。帧来源由 session 事件总线推送且从不等待，因此不等待消费者需求的推送会在浏览器繁忙期间缓冲宿主的全部产出。拉取循环最多只让来源自身有界的队列处于在途状态。
- **依赖客户端自己给出的 `maxMessages`。** 不采用。该上限的存在是为避免手写请求要求宿主在一次调用中组装巨大的消息窗口，因此它属于宿主校验载荷的位置。

## 后果

- 一个协调器在其 ready 条目上最多保留 `preparedSessionCacheMaxEvents` 个存储事件，`preparedSessionCacheSize` 仍约束条目数量。比预算更重的日志绝不会被保留，因此下一次读取会重新加载它，而不是复用它。
- 两个默认值都按后端可配置：`preparedSessionCacheSize` 为 5，`preparedSessionCacheMaxEvents` 为 500,000。
- 停滞的 mux 消费者会从最旧的 `session/event` 帧开始丢失并重新拉取尾部；mux 队列中没有可恢复帧时，以及任何已满的 host 流队列，都会结束该流。
- 一次历史请求最多可索取 1,000 条消息；响应本身的边界仍由该页的事件上限承担。
- 该约束覆盖的是保留与复制，而不是物理冷读：两种编码的 JSONL 仍会解析整个文件，因此对日志超过重量预算的会话做冷 `session.history` 时，每次调用都会重新实体化该日志。按页从磁盘窗口读取——即 JSONL 从请求的 `beforeSeq` 开始读取——仍是未完成的剩余工作，而 `readFrom` 约束的是它返回的内容，不是后端解析的内容。

## 测试

`packages/session/session-persistence/tests/preparations.spec.ts` 通过 `evicts the oldest ready source once the retained weight exceeds the budget` 与 `never retains a single ready source heavier than the whole budget` 固定按重量淘汰，两者都经由 `preparationsOf(capacity, maxReadyWeight, weightOf)` 辅助函数。`packages/session/session-persistence/tests/persistence.spec.ts` 通过 `never retains a prepared log heavier than the cache weight budget` 固定协调器层的回归：对日志超过 1 事件预算的会话做两次检查时观察到两次后端加载；并以 `rejects invalid preparation cache weight budget` 拒绝非法预算。`packages/host/apiproxy/tests/fetch-carrier.spec.ts` 通过 `drops frames after the consumer aborts mid-stream` 与 `swallows a reader.cancel rejection on early exit` 覆盖 SSE 取消路径。

`FrameQueue` 的帧上限、丢弃计数器与 `MAX_HISTORY_MESSAGES` 上限没有专门测试。

## 相关

- [发布前可复用的 Session 准备](../architecture/2026-08-05-session-preparation.md)负责准备会话的生命周期，以及现在承载重量预算的 ready 条目 LRU。
- [有界的 Web 历史分页与恢复的会话信息流](2026-09-17-web-session-feed-after-refresh.md)负责历史分页尺寸（`MAX_PAGE_EVENTS`）与客户端 live 窗口裁剪。
- [Web 实时追赶、mux 背压与 Roy 池租约](2026-09-17-web-live-catchup-and-roy-pool.md)负责客户端侧 mux 泵，以及本队列 `end()` 路径所服务的重连拼接。
