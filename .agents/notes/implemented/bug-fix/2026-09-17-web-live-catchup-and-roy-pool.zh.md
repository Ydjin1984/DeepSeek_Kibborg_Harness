# Agent Note: Web 实时追赶、mux 背压与 Roy 池租约

Status: implemented

English | [2026-09-17-web-live-catchup-and-roy-pool.md](2026-09-17-web-live-catchup-and-roy-pool.md)

## Problem

Host 重启后网页对话空白或极慢，而 Telegram 已经在出字：冷路径 `session.history` 先列出全部会话再解码整份 JSONL，重连清空 `subscribedLastSeq`/`liveBuffer` 和屏幕上的窗口，live 事件没有上限，默认 Execution 视图不跟随最后一行增高，mux 对每个 `assistant/chunk` 串行 `await send` 且无 keepalive。编排器声称 429 会换模型，但头模型拒绝列表为空且闭包过期，spawn 结果没有 diagnostic，OpenRouter 默认路由覆盖付费 `openrouter` 配置，分钟级 429 被记成耗尽当天配额。

## Decision

冷 inspect 不再先 `list()` 整个 home；history 分页只切片当前页。重连保留当前窗口、mux 基线和 live 缓冲再拼接。客户端把 live 窗口裁到一页消息。mux 泵发送 ping，只在高水位等待。Execution 跟随观察 flow 尺寸。头模型默认拒绝 `grep`/`glob`/`pwsh`/`bash`，并从 live settings 读取。spawn 的 `turn/end` error 写入 `diagnostic`，429 才能重试。免费池发布 `openrouter-free`，未发布路由不租约，短 429 只冷却一分钟，扫描必须有 API key。

## Alternatives considered

**可定位的 JSONL 尾读。** zstd 帧仍要从头解；改盘上布局要 bump 格式。此次只去掉整库 list 和整表拷贝。

**把 ExecutionView 做成虚拟列表。** 默认仍是轨迹页；虚拟化是更大的 UI 重写。先用跟随增高和窗口上限去掉无界 React 树。

**让网页走 Telegram 的进程内监听。** 网页是另一进程；mux 仍是导线。背压和 ping 避免长标签页把这条导线堵死。

## Consequences

- 重连标签页在 history 返回前继续显示旧窗口，然后拼接主机已经发出的 live 帧。
- 长会话不能把 assembler 撑过一页；更早的消息留在 `hasMore` 后面。
- 打开编排器而不填 `headDenyTools` 时，头模型不再看到侦察工具。若要让头模型自己 grep，必须清空该列表。
- 已有的 `llm-pi-ai` `providers.openrouter` 配置不再被免费池覆盖。池自己的配置里若仍写着 `providerRoute: openrouter`，会继续发到那个键，直到改掉。

## Testing

Host 分页与 inspect：`packages/host/apiproxy/tests/api-proxy-view.spec.ts`。客户端 resync：`packages/client/runtime/tests/session.client.spec.ts`。mux：`packages/client/connection/tests/websocket-downlink.host.spec.ts`。编排器：`packages/context/orchestrator/tests/composition.spec.ts`。池：`packages/llm/llm-openrouter-free/tests`。spawn diagnostic：in-process driver。技能与 fetch IPv6：对应 package tests。
