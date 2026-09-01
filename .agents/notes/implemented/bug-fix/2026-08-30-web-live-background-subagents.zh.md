# Agent Note: Web GUI 让运行中的后台 subagent 保持实时可见

Status: implemented

[English](2026-08-30-web-live-background-subagents.md) | 中文

## 问题

Web GUI 中的后台 subagent 在用户打开它们之前看起来像卡住了：客户端的 `SessionManager` 刻意丢弃从未打开过窗口的会话的 `session/event` 帧（「不做惰性建窗；打开时用 history 回补」），而 `Session.acceptLiveEvent` 在窗口处于冷态时也丢弃 live 事件。因此，生成的 subagent 在侧边栏只显示「运行中」状态，其转录从不移动。打开子级会回补全部历史并开始实时流，这看起来就像「切换到 subagent 它就活了」。

服务端经实证是健康的：从活动会话生成的探针 subagent 在父级继续工作时完整跑完了一轮（后台任务、`job_output`、报告）；一对看似卡死的父子会话实为处于合法的有界 `job_output` 等待中（上限 10 分钟），并非死锁。

## 决策

在不触碰服务端循环的前提下，让运行中的 subagent 子级在客户端保持实时、在侧边栏可见。

### 客户端：自动打开运行中的 subagent 窗口（`dsh-client-runtime`）

`SessionManager` 在三个钩子处打开运行中的 subagent 子级窗口，全部经 `Session.open()` 幂等：

- 目录刷新完成（`refreshSubagents`）：每条报告为 `running` 的条目打开其窗口，用目录条目作为 history 路由所需 `mode` 的权威来源；
- `host/session-status` 且 `running: true`：地址已知（已保留或已在目录中）时直接打开窗口；否则先加载父级目录，因为猜测 `mode` 会错误路由 one-shot 子级的 history；
- 已知运行子级的首个 `session/event` 帧：打开窗口，使该帧本身被消费而非丢弃。

地址被保留供后续导航使用（`selectSubagent`），`SessionRuntime.followCurrent` 仍照旧打开当前选中的会话——切换到已拥有实时窗口的子级只是纯粹的聚焦动作。

### 服务端：`subagentActivity` 投影（`dsh-subagent`）

新增投影单元折叠 `turn/start`、`tool/call`、`assistant/message`、`turn/end` 为 `{ status: 'running' | 'idle', detail }`，其中 `detail` 是最后一个工具名或一段有界（60 字符）的折叠空白回复片段。api-proxy 的 `session/projection` 广播对非 subagent 会话丢弃该键，因此普通会话不会产生额外帧。subagent 目录行（`SubagentCatalogAction`）在子级运行时于次要行渲染 `detail`。

### 已拒绝：周期性「戳」后台子级

每隔几秒重发一条消息的看门狗会在每次戳动时唤醒模型——每个子级每个间隔一次 LLM 请求——而服务端本来就正确执行子级；症状是可见性而非执行。戳动只会烧掉 token 而不修复显示。

## 后果

- **内存**：每个运行中的子级在客户端保留一个打开的事件窗口，受并发运行子级数量约束。
- **线路**：每个 subagent 来源会话每次工具调用或组装消息至多产生一个 `session/projection` 帧。
- **历史路由**：mode 未知的子级窗口要等其父级目录落地后才打开；此窗口内被丢弃的帧由既有的 open/backfill 机制覆盖。

## 测试

- `manager.client.spec.ts`：目录刷新打开运行子级窗口；目录滞后时状态帧打开它；目录已知的子级从状态帧立即打开。
- `activity-projection.spec.ts`：围绕 turn/tool/message 边界的折叠、文本截断、稳定引用 no-op、注册表注册。
- `api-proxy-projections.spec.ts`：`subagentActivity` 帧只对 subagent 来源会话到达 mux 消费者。
- `conversation-ui.client.spec.tsx`：运行子级行显示活动细节；空闲子级省略它。
- `pnpm run test:gui` 全绿，唯一例外是既有的、与本次无关的 `ui-settings-models` provider-form 失败。完整 web e2e replay 门禁无法在本机运行：根包的 `lib/types/{index,invariant,startup}.js` 入口在本检出上从未存在过，`pnpm run build` 在浏览器跑道之前的 tsdown 步骤即停住；subagent e2e 快照改为人工核查——它们只捕获 inactive 子级，本次改动不会改变其字节。

## 工作树修复（同一次改动）

本检出带有一个未完成的 `git stash pop`，来自 runtime `sessions/*`/`agents/*` → `contract/*` 重构：三个文件带显式冲突标记（`contract/notifier.ts`、`contract/agent-scope.ts`、`contract/conversation-snapshot.ts`），另有两个被自动合并静默损坏（`contract/pending.ts`、`contract/context-provenance.ts` 变成了自引用 shim，丢掉了 `PendingWait` 类和 provenance 函数）。冲突按保留重构后的 contract/ 实现解决（旧路径 shim 已存在，导入图也要求类位于 contract/），两个损坏文件从 HEAD 恢复。这是运行客户端测试套件的必要前提；既有的 `ui-settings-models` 失败仍保留。
