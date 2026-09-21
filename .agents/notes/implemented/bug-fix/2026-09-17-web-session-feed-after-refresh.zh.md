# Agent Note: Bounded web history pages and restored session feed

Status: implemented

[English](2026-09-17-web-session-feed-after-refresh.md) | 中文

## 问题

在长生命周期的 Web 会话上刷新浏览器后，对话标签可能先绘制数万条 execution 行，ask-user 弹层才出现。Host 日志显示 `session.history` 在 `maxMessages=50` 时返回 4 万到 7 万条事件，`session.list` 对约 1,700 条冷会话耗时 12–19 秒，`subagent.list` 反复做 2–4 秒的检查，mux 下行达到每秒 5–8 千帧。Chrome 随后报告 forced reflow 和长 `setTimeout` 任务，Telegram 镜像按钮在卸载时泄漏 `AbortError`。

历史分页和客户端 live 窗口只统计 `user/message` 与 `assistant/message`。若这类消息不足 50 条，页面会留下全部 chunk 和 tool 事件（`hasMore=false`）。Ask-user 帧与 `session/event` 共用同一 FIFO，因此实时问题会排在积压之后，直到新的 mux 套接字重放 `pendingQuestions`。

## 决策

`@deepseek-ai/dsh-host-apiproxy` 中的 `paginateWindow` 按请求的 append 来源消息数量计数，每次响应最多返回 400 条事件。事件上限不会让页面从消息组中间开始：若最旧的一组不完整且后面还有完整回合，则丢掉该组；否则页面从该组已定稿的消息开始，assembler 看不到无主 chunk。分片很多的一轮也可能成为带 `hasMore=true` 的短页，而不是整份日志。打开或重新连接会话时，客户端请求 500 条消息，并连续向前追加分页，直到取得 500 条或到达日志开头。每次主动加载更早历史最多增加 100 条消息；即使 400 事件上限将该批次拆成多次 RPC，也是如此。空页、失败页或不连续的页面会终止当前批次。

`Session.trimLiveWindow` 仅在消息完成后裁剪。它至少保留打开时请求的 500 条消息以及用户主动加载的更早消息，并在按消息数量裁剪前预留 200 条余量。原始事件目标为 12,000 条；保留请求的消息优先，因此分片密集的窗口可以超过此目标。流式 chunk 不会在每条事件到来时重建对话窗口。

如果缺口修复在更早历史请求尚未完成时替换了窗口，旧 `beforeSeq` 的响应会被丢弃，并从新窗口头部重新开始这一批。此前该响应与修复后的头部不连续，会把 `hasMore` 置为 `false`，只留下受上限约束的尾页。

冷路径 inspect 通过 `persistence.inspect(sessionId)` 查找，并将后端缺失 `session "<id>" not found`（以及没有 `cwd` 的 header）映射为 `ApiRemoteSessionNotFound`。它不会调用 `persistence.list()` 来证明缺失。

`FrameQueue.prepend` 加上 `enqueueMux` 把 `question/*` 和 `approval/*` 帧放到每条 mux 下行的队头。Host 记录 `mux.question.enqueue`；客户端记录 `session.question.requested`。

`ExecutionView` 用一次 `requestAnimationFrame` 写入 `scrollTop` 跟随尾部。测量后的虚拟行限制挂载 DOM 的数量，同时保留向前翻页。ResizeObserver 不再在每次增高时把几何读入 React state。

`listVisibleSessionSummaries` 每次批处理 64 条冷行，并在缓存的 `blank` 不是 `false` 时仍做探测。`subagents.list` 将成功的父级目录复用 3 秒。`listChildren` 一次最多检查 16 个冷子会话。`TelegramMirrorButton` 在卸载时中止 status 探测，并忽略 `AbortError`。

## 考虑过的替代方案

- **实时窗口维持 400 条原始事件**：分片密集的流式输出会使活动记录消失；刷新后也只能看到最后几项。因此 Host 响应继续受限，而客户端按完成的消息组保留事件。
- **在 inspect 前保留目录 `list()`**：不予采纳。用枚举整个 home 会话来证明缺失，会使一次 history 读取变成完整目录扫描。
- **只要存在 metadata 就跳过冷 blank 探测**：不予采纳。过期的 `blank: true` 必须重新探测，否则列表会隐藏已经有回合的对话。
- **缓存失败的 subagent 目录**：不予采纳。被取消或内部失败的读取不应把空侧栏钉住 3 秒。

## 后果

- 一次 history 响应在线路上最多包含 400 条事件。打开时恢复最多 500 条 append 来源消息；每次加载更早历史最多增加 100 条，且会话流式输出期间已加载窗口保持可读。
- 同一 mux 套接字上，实时的 ask-user 或 approval 帧会先于 `session/event` 积压送达。
- `session.list` 仍会探测未知或过期 blank 行；它不再一次只串行处理 16 条探测。
- 导航时卸载 Telegram 镜像不再在控制台出现 `AbortError`。
- ExecutionView 对较长的行列表使用虚拟化；展开详情仍由已有的工具卡片显示记录内容。
