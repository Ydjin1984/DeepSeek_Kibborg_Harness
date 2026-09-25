# 对话动作流与底部跟随实现计划

[English](2026-09-19-conversation-feed-and-follow.md) | 中文

> **面向 agentic worker：** 必需 sub-skill：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现本计划。步骤使用 checkbox（`- [ ]`）语法跟踪。

**目标：** 在「执行」中建立沉静、信息充分且快速的动作流，在「对话」与「执行」中提供请求导航，统一三个标签页，并实现由用户掌控的对最新动作的实时跟随。

**架构：** 「执行」继续投影现有 Chat node，并把详情交给现有 Tool renderer；分组依据已登记的轮次与步骤边界。大型日志使用带展开卡片高度测量的虚拟行窗口。一个明确的跟随模式状态机控制三个标签页的行为，每个标签页各自把它应用到自己的滚动容器，并在切换标签页期间保留阅读位置。

**技术栈：** React、TypeScript、CSS modules、`@tanstack/react-virtual`（Trajectory 中已在用）、Vitest、Testing Library、无密钥 web 快照。

**规格：** [动作流与用户代码](../specs/2026-09-19-conversation-activity-design.md)。面向三个反引号的独立计划：[用户代码围栏](2026-09-19-user-code-fences.md)。

## 全局约束

- 「对话」与「执行」使用 Conversation Runtime；「轨迹」保留自己的投影。纯视觉变更不需要新增 session events。
- 记录中不出现杜撰的阶段、时间、文件内容或结果；精确数据来自已保存的快照。
- 文件与 Tool card 通过现有 renderer 展开；Host open-file 仍是独立动作。
- 侧边刻度只呈现真正已加载的用户请求；历史很长时，同时挂载的按钮数量受限。
- 用户向上离开底部会立即关闭跟随；手动回到底部，或使用现有的「跳至最新」按钮，会重新开启跟随。
- 流式输出期间不得排队 smooth-scroll；手动操作始终取消程序化跳转。
- 键盘、屏幕阅读器、`prefers-reduced-motion`、`en`/`ru`/`zh` locale 与干净的 tree dispose 都是必需项。
- 行为变更按仓库规则随关键的 web 快照、配对 README、JSDoc 与 Agent Note 一并补充。
- 实现之前先阅读[架构](../../architecture.md)、[防御性模式](../../defensive-patterns.md)与 [packages 说明](../../../packages/AGENTS.md)；修改 packages 之前先查询本地 graphify。

---

## 文件与职责地图

| 领域 | 负责方 | 计划变更 |
|---|---|---|
| 事件入口 | [Conversation session](../../../packages/client/runtime/src/client/sessions/session.ts)、[assembler](../../../packages/client/runtime/src/client/sessions/conversation-assembler.ts)、[Chat snapshot builder](../../../packages/client/ui-conversation/src/client/conversation-nodes/chat-snapshot-builder.ts) | 只读与性能测量；不建立第二套事件日志。 |
| 「执行」投影 | [execution-event.ts](../../../packages/client/ui-conversation/src/client/execution/execution-event.ts)、[execution-summary.ts](../../../packages/client/ui-conversation/src/client/execution/execution-summary.ts)、新增 `execution-groups.ts` | 稳定的行、真实分组、对可见变更的增量处理。 |
| 「执行」界面 | [ExecutionView.tsx](../../../packages/client/ui-conversation/src/client/execution/ExecutionView.tsx)、[ExecutionEventRow.tsx](../../../packages/client/ui-conversation/src/client/execution/ExecutionEventRow.tsx)、[ExecutionHeader.tsx](../../../packages/client/ui-conversation/src/client/execution/ExecutionHeader.tsx)、相邻 CSS modules | 紧凑层级、展开、「跳至最新」按钮、行窗口。 |
| Tool 详情 | [ToolRow.tsx](../../../packages/client/ui-tool/src/client/tool/components/ToolRow.tsx)、[read-row.tsx](../../../packages/client/ui-tool/src/client/tool/toolviews/read-row.tsx)、[README](../../../packages/client/ui-tool/README.md) | 保留 ReadBlock/DiffBlock，分离 inline preview 与 Host open-file。 |
| 对话与标签页 | [ChatView.tsx](../../../packages/client/ui-conversation/src/client/chat/ChatView.tsx)、[ConversationSession.tsx](../../../packages/client/ui-conversation/src/client/skeleton/ConversationSession.tsx)、[view contracts](../../../packages/client/ui-conversation/src/client/contract/slots.ts) | 跟随、标签页书签、辅助行的视觉对齐。 |
| 请求导航 | 新增 `packages/client/ui-conversation/src/client/contract/prompt-nav.ts` 与 `packages/client/ui-conversation/src/client/skeleton/PromptRail.tsx` | 受限的刻度窗口、活动请求，以及跳到稳定的 Chat node key。 |
| 「轨迹」 | [TrajectoryView.tsx](../../../packages/client/ui-trajectory/src/client/TrajectoryView.tsx)、[TrajectoryTable.tsx](../../../packages/client/ui-trajectory/src/client/TrajectoryTable.tsx)、[README](../../../packages/client/ui-trajectory/README.md) | 当前行增长时跟随，并保持虚拟窗口。 |
| 共享状态机 | 新增 `packages/client/ui-conversation/src/client/contract/bottom-follow.ts`；[公开 client entry](../../../packages/client/ui-conversation/src/client/index.ts) | 纯模式转移；DOM 仍由标签页负责。 |
| 检查 | [Execution tests](../../../packages/client/ui-conversation/tests/execution-view.client.spec.tsx)、[Chat tests](../../../packages/client/ui-conversation/tests/chat-view.client.spec.tsx)、[Trajectory table tests](../../../packages/client/ui-trajectory/tests/table.client.spec.tsx)、[web snapshots](../../../apps/web/tests/snapshots/) | 行为、长历史、组装后的应用与测量。 |

顺序：任务 1–5 构建并加速动作流；任务 6 增加请求导航；任务 7 固定跟随模式与书签；任务 8–9 集成各标签页；任务 10 统一验证全部内容。每个任务都以独立的检查收尾，并可单独评审。若某个阶段改变公开类型，则在同一阶段补充其所属 subsystem page 与 JSDoc。

### 任务 1：固定设计基准与基线性能

**文件：** [Execution tests](../../../packages/client/ui-conversation/tests/execution-view.client.spec.tsx) 旁边的测试 fixture；`apps/web/tests/` 中的测量场景；受影响的 CSS 只读不改。

**接口：** 输入是真实的 Chat node、Tool card 与 Trajectory records；输出是可复现的 50 个不同动作的场景，以及带有记录在案的初始数值的 1 000/5 000 条记录长场景。

- [ ] 用现有类型组装 fixture（测试前置数据）：用户请求、reasoning、read、edit/diff、shell success/error、搜索、subagent、approval、plan/todo、assistant answer；不得给数据赋予不存在的字段。
- [ ] 在短历史与长历史下截取三个标签页的当前外观，包括展开的读取卡片、错误与深色/浅色主题；在改动 CSS 之前，先固定规格中期望的视觉层级。
- [ ] 在浏览器中测量已挂载行数、首次挂载耗时，以及 1 000/5 000 条记录下一次流式更新、滚动与输入的 profile；把机器、浏览器与结果记录在场景旁边。
- [ ] 在检查点确认版式：动作的首行无需展开即可读；错误/等待/正在执行一目了然；路径与结果可以快速扫读，没有多余的 badges。
- [ ] 用窄范围测试校验 fixture，并把结果保存为基准；在重新测量之前不要宣称收益。

### 任务 2：仅按真实边界分组与稳定的 event index

**文件：** 新增 `packages/client/ui-conversation/src/client/execution/execution-groups.ts`；修改[execution-event.ts](../../../packages/client/ui-conversation/src/client/execution/execution-event.ts)、[ExecutionView.tsx](../../../packages/client/ui-conversation/src/client/execution/ExecutionView.tsx)；测试[execution-event tests](../../../packages/client/ui-conversation/tests/execution-event.client.spec.ts)、新增的 `execution-groups.client.spec.ts`。

**接口：** `ExecutionGroup = { key: string; title: string; eventKeys: readonly string[] }`；`groupExecutionEvents(events: readonly ExecutionEvent[], timeline: ChatSnapshot['timeline']): readonly ExecutionGroup[]`。边界取自现有的 Chat timeline/turn metadata；不得按时间或文本推断轮次。事件行保留 `ExecutionEvent.key`。

- [ ] 增加红灯测试：两个 user turn、多个 step、partial tool 与 prepend 旧历史产生正确的分组、顺序与稳定键；未知边界不创建虚构分组。
- [ ] 运行 `pnpm exec vitest run packages/client/ui-conversation/tests/execution-event.client.spec.ts packages/client/ui-conversation/tests/execution-groups.client.spec.ts`；新测试必须因缺少 grouper 而失败。
- [ ] 抽出纯分组逻辑；分组标题只从已登记的 user/turn/plan 事实取文本，否则使用中性的轮次编号。
- [ ] 按 Chat node 身份缓存派生行，在流式尾部更新时不重建未变更的事件；筛选与 summary 必须对相关行的变化作出反应。
- [ ] 重跑窄范围测试，确认 inspect、筛选与搜索在 prepend 之后使用同一批键。另外查看任务 1 的 fixture 上索引构建耗时的差异。

### 任务 3：沉静记录与无障碍展开

**文件：** 修改[ExecutionView.tsx](../../../packages/client/ui-conversation/src/client/execution/ExecutionView.tsx)、[ExecutionEventRow.tsx](../../../packages/client/ui-conversation/src/client/execution/ExecutionEventRow.tsx)、[ExecutionHeader.tsx](../../../packages/client/ui-conversation/src/client/execution/ExecutionHeader.tsx)、`ExecutionView.module.css`、`ExecutionEventRow.module.css`、`ExecutionHeader.module.css`、[locale](../../../packages/client/ui-conversation/src/client/locales.ts)；测试[Execution tests](../../../packages/client/ui-conversation/tests/execution-view.client.spec.tsx)。

**接口：** 保留 `nodeKey`、`renderChatNode`、`owner`、`aria-expanded`、search/filter/expand-all 与现有 `jumpLatest`；group header 不替代 event row。

- [ ] 增加测试：group header → rows 的顺序、折叠形式下 running/error/approval 的显示、键盘展开，以及跨分组搜索。
- [ ] 重做页头与工具栏：用一份清晰的汇总取代重复；动作行紧凑地给出主要动词、次要目标、状态与时间；展开卡片仍留在自然流中。
- [ ] 在展开的正文中保留专门的 `renderChatNode` 调用，包括 Subagent strip、Terminal/Read/Diff 与 fallback。
- [ ] 去掉相互竞争的边框、重复的标签与 CSS 视觉噪音；通过现有设计系统给出密度 token、hover/focus、浅色/深色主题与 reduced motion。
- [ ] 运行窄范围测试并在浏览器中查看 50 个动作的 fixture；在虚拟化之前记录问题。

### 任务 4：文件的行内预览与在系统中单独打开

**文件：** 修改[ExecutionEventRow.tsx](../../../packages/client/ui-conversation/src/client/execution/ExecutionEventRow.tsx)、[ExecutionView.tsx](../../../packages/client/ui-conversation/src/client/execution/ExecutionView.tsx)，必要时修改[ToolRow.tsx](../../../packages/client/ui-tool/src/client/tool/components/ToolRow.tsx)；测试[Execution tests](../../../packages/client/ui-conversation/tests/execution-view.client.spec.tsx)、[Tool row tests](../../../packages/client/ui-tool/tests/tool-row.client.spec.tsx)、[Read card tests](../../../packages/client/ui-tool/tests/read-card.client.spec.tsx)。

**接口：** 单击文件名 → 在记录中展开对应的 logged Tool card；次要动作「打开文件」→ 现有 `openFile(path)`。文件 summary 使用 `executionTraceSummary` 中现有的 `firstKey`。

- [ ] 增加测试：在 `execution-view.client.spec.tsx` 中，read event 上的单击恰好显示已保存的 ReadBlock，包含行范围、行数、语言与复制，且不触发 Host open。
- [ ] 增加测试：即使行在 viewport 之外，文件 summary 也会跳到真实 event；edit path 展开 DiffBlock；缺少 read/diff 数据时显示可用的 Host open 动作，而不杜撰内容。
- [ ] 让文件名成为独立的键盘 button/link，不在 `button` 内嵌套 `button`；点击行的其余部分仍然展开卡片。
- [ ] 在 UI 中保留现有的 Host open 错误处理，并在窄范围测试中校验两条路径。

### 任务 5：高度可变的「执行」虚拟窗口

**文件：** 修改[ExecutionView.tsx](../../../packages/client/ui-conversation/src/client/execution/ExecutionView.tsx)、[execution-virtual.ts](../../../packages/client/ui-conversation/src/client/execution/execution-virtual.ts)、`ExecutionView.module.css`；测试[execution-virtual tests](../../../packages/client/ui-conversation/tests/execution-virtual.client.spec.ts)、[Execution tests](../../../packages/client/ui-conversation/tests/execution-view.client.spec.tsx)。

**接口：** `@tanstack/react-virtual` 把 `visibleKeys`/分组用作稳定的 `getItemKey`；DOM 行保留 `data-execution-row-key`。定向展开时，先用键 → 索引的 map 调用 `virtualizer.scrollToIndex`，挂载后再聚焦。

- [ ] 编写失败测试：5 000 个元素时 DOM 只包含窗口与 overscan；展开卡片改变高度且不重叠；筛选与 prepend 保留参照行；inspect/reveal 能找到不在 DOM 中的行。
- [ ] 从 event/group rows 建立虚拟模型，测量实际高度并使用稳定索引。不要把嵌套的 ReadBlock 与 TerminalBlock 从其父行中单独虚拟化。
- [ ] 稳定 callbacks 与订阅：替换某一行的 stream content 不会触发所有 `ExecutionEventRow` 更新；不要在每次 parent render 时为每一行新建 `onToggle` 函数。
- [ ] 通过 index 实现跳到不可见行，并在测量后重新对齐；search/filter、expand/collapse all 与 keyboard focus 必须在窗口切换时仍然可用。
- [ ] 运行测试并重新测量 1 000/5 000 个事件；典型 viewport 下已挂载行数的目标上限是 120。

### 任务 6：用于在请求之间跳转的纵向刻度

**文件：** 新增 `packages/client/ui-conversation/src/client/contract/prompt-nav.ts`、`packages/client/ui-conversation/src/client/skeleton/PromptRail.tsx`、`packages/client/ui-conversation/src/client/skeleton/PromptRail.module.css`；修改[ChatView.tsx](../../../packages/client/ui-conversation/src/client/chat/ChatView.tsx)、[ExecutionView.tsx](../../../packages/client/ui-conversation/src/client/execution/ExecutionView.tsx)、[locale](../../../packages/client/ui-conversation/src/client/locales.ts)；测试新增的 `prompt-nav.client.spec.ts`、`prompt-rail.client.spec.tsx`、[Chat tests](../../../packages/client/ui-conversation/tests/chat-view.client.spec.tsx)、[Execution tests](../../../packages/client/ui-conversation/tests/execution-view.client.spec.tsx)。

**接口：** `PromptEntry = { key: string; seq: number; preview: string }`；`promptEntries(chat: ChatSnapshot): readonly PromptEntry[]` 只取 user/steering node；`visiblePromptWindow(entries, activeKey, maxVisible = 9)` 返回不超过 9 个刻度，以及被省略区间的边界。`PromptRail` 接收 entries、activeKey、onSelect(key) 与标签；两个标签页使用同一组件。

- [ ] 编写红灯测试：5 个请求给出 5 个按钮；200 个请求最多挂载 9 个刻度，外加两个用于相邻区间的控件；prepend 之后的顺序以及上下文/system 节点的缺失都不改变键的对应关系。
- [ ] 按稳定的 Chat node key 构建条目；每个 animation frame 最多根据可见区域计算一次活动请求，不在每个 scroll event 上遍历全部 5 000 行。虚拟化的「执行」使用可见 virtual index，「对话」使用可用的 DOM anchor 与几何缓存。
- [ ] 把刻度栏放在滚动容器右边缘、大致对齐可见高度的中点，不压在文字、滚动条、「跳至最新」按钮或 composer 之上；窄屏下通过紧凑模式保留对请求的访问。
- [ ] 单击/Enter/Space 跳转到对应消息；在虚拟窗口之外使用 index-based scroll。每个标签页的处理函数在跳转到较早请求时显式关闭它当前的本地 follow；跳转到最后一个请求时，在到达底部之前不开启 follow。任务 7 会用共享状态机替换这些本地标志。标签朗读已加载历史中的编号与文本开头，活动刻度带有 `aria-current`。
- [ ] 运行新增与受影响的测试，然后在浏览器中检查 5、50 与 200 个请求，以及历史部分加载的情形。

### 任务 7：共享的跟随模式与标签页书签

**文件：** 新增 `packages/client/ui-conversation/src/client/contract/bottom-follow.ts`；修改[client entry](../../../packages/client/ui-conversation/src/client/index.ts)、[view contracts](../../../packages/client/ui-conversation/src/client/contract/slots.ts)、[ConversationSession.tsx](../../../packages/client/ui-conversation/src/client/skeleton/ConversationSession.tsx)；测试新增的 `bottom-follow.client.spec.ts`、[skeleton tests](../../../packages/client/ui-conversation/tests/skeleton.client.spec.tsx)。

**接口：** `FollowMode = 'following' | 'reading' | 'jumping'`；`FollowAction = 'reader-left' | 'reader-at-floor' | 'jump' | 'jump-complete' | 'jump-interrupted'`；`nextFollowMode(mode, action): FollowMode`。在 owner `conversation.view` 中为 session/view 对增加书签读写：`{ mode, anchorKey, anchorOffset, scrollTop }`；存放在活跃的 Session 壳中，sessionId 变化时重置。

- [ ] 用测试确定全部状态转移：启动为 following；向上手势 → reading；程序化 scroll/resize 不引发转移；手动到底 → following；jump → jumping → following；jump 期间的干预 → reading。
- [ ] 实现不访问 DOM、时间或全局 singleton 的纯 reducer；通过公开 client entry 导出它供 Trajectory 使用。
- [ ] 增加共享的 owner 书签 API，不把像素位置写入长期 session log；切换标签页时保存锚点与 offset，返回时恢复，且不会误开启 following。
- [ ] 校验 sessionId 变化、卸载、不残留 observers/listeners，以及每个标签页的恢复。

### 任务 8：「对话」与「执行」中的实时跟随

**文件：** 修改[ChatView.tsx](../../../packages/client/ui-conversation/src/client/chat/ChatView.tsx)、[ExecutionView.tsx](../../../packages/client/ui-conversation/src/client/execution/ExecutionView.tsx)、对应的 CSS modules；测试[Chat tests](../../../packages/client/ui-conversation/tests/chat-view.client.spec.tsx)、[Execution tests](../../../packages/client/ui-conversation/tests/execution-view.client.spec.tsx)。

**接口：** 来自任务 7 的模式；带 `aria-label="К последнему"` 的现有 `.jumpLatest` 按钮仍是入口；程序化 scroll 不发送 `reader-at-floor`。

- [ ] 为每个标签页分别增加测试：首次落位在底部；新行流入；最后一行在无新 key 的情况下增高；有意用 wheel/touch/key 向上移动 1–5 px；reading 状态下新事件不移动 viewport；手动到底会开启 follow。
- [ ] 增加按钮测试：平滑跳到末尾、到达底部后 follow、被滚轮/触摸/按键中断；reduced motion 下跳转瞬时完成。在测试中替换 `scrollTo` 与 rAF，而不是等待真实动画。
- [ ] 区分 scroll 的来源：手势 listeners 改变模式，而数据更新与 ResizeObserver 在 following 时只安排一次 rAF write。streaming 期间按最新几何跟随，不重复使用 `behavior: 'smooth'`。
- [ ] reading 状态下，在 prepend、上方内容展开、筛选与 composer 高度变化时保持可见 anchor；单纯的标签页切换不得强制把「对话」拉到底部。
- [ ] 检查 composer 上方的 wheel chaining、现有 inspect scroll，以及离开底部时按钮的可见性。

### 任务 9：虚拟化「轨迹」中的实时跟随

**文件：** 修改[TrajectoryView.tsx](../../../packages/client/ui-trajectory/src/client/TrajectoryView.tsx)、[TrajectoryTable.tsx](../../../packages/client/ui-trajectory/src/client/TrajectoryTable.tsx)、`TrajectoryTable.module.css`；测试[Trajectory table tests](../../../packages/client/ui-trajectory/tests/table.client.spec.tsx)、[view tests](../../../packages/client/ui-trajectory/tests/views.client.spec.tsx)。

**接口：** 共享的 `FollowMode` 与书签；定位沿用现有 virtualizer，而不是完整的 DOM scan。当前测试中的 `streamingCells` 场景会改变：following 时最后一行的增高保持贴底，reading 时不出现重复的 tail-scroll。

- [ ] 为 content-only streaming 下的两种模式、以及 reading 期间加载旧页的情况编写红灯测试；保留稳定的 semantic row key 与 ARIA 索引。
- [ ] 把现有 `followsTableTail` 迁移到共享状态机；用户处于 following 时，在最后一个 virtual item 的测量更新之后调用一次 scroll-to-end。几何未变化时不要为每个 content chunk 滚动。
- [ ] 在 prepend 与切换标签页时保留虚拟参照行的坐标；单击现有的跳到尾部入口会开启 following，手动向上离开会中断它。
- [ ] 运行窄范围测试，并在浏览器中检查 500+ 条记录下的表格与时间线。

### 任务 10：集成、无障碍、应用快照与文档

**文件：** 修改[Conversation README](../../../packages/client/ui-conversation/README.md) 及其 `README.zh.md`、`README.i18n.yaml` 配对；[Trajectory README](../../../packages/client/ui-trajectory/README.md) 及其配对；若 Tool UI 变化，还要加上[Tool README](../../../packages/client/ui-tool/README.md) 及其配对；在 `.agents/notes/implemented/feature/` 中创建 Agent Note；在[web snapshot suite](../../../apps/web/tests/) 下新增或更新无密钥快照。

**接口：** 任务 1–9 的最终状态。组装后的 web 快照必须使用真实的可运行示例/replay，而不是 mock-only UI fixture。

- [ ] 创建可运行用例 `apps/web/tests/conversation-feed.snapshot.ts` 与测试 `conversation feed and follow`：用户轮次、read/edit/错误、展开、请求导航，以及真实组装后应用中的执行状态。
- [ ] 在 Chrome/Edge 与可用的 Firefox/Safari 上走完规格的核对清单：鼠标、touch、键盘、screen reader 标签、窄宽度、浅色/深色主题、reduced motion、长路径与 Tool card 中的长代码。
- [ ] 检查位于动作流中央的刻度栏：reading 时活动刻度会改变，跳转在 prepend 之后打开正确的请求，可见刻度数量受限且不遮挡「跳至最新」按钮。
- [ ] 重做任务 1 的性能测量；在同一台机器上记录基准与结果、DOM count、帧 p95、最长帧、任何超过 50 ms 的原因与修复。
- [ ] 更新 JSDoc、README 配对、Agent Note 与图：`D:\Deepseec_DaVinchi\.venv-graphify\Scripts\graphify.exe update packages`。
- [ ] 运行受影响的 Vitest 文件、`pnpm run test:snapshot -t "conversation feed and follow"`、`pnpm run typecheck`、`pnpm run doc-sync`、`git diff --check`；只报告实际执行过的命令与结果。
- [ ] 把规格的每一条与测试、浏览器观察或 profile 逐条对照；只有完成这项检查之后，代码改动才算完成。

## 对齐确认

- [ ] 50 个动作的视觉基准与行密度已对齐。
- [ ] 请求导航刻度的位置与行为已对齐。
- [ ] 任务顺序与三个标签页中行为的一致性已对齐。
- [ ] 对齐之后从任务 1 开始实现；在此之前，本文件是计划，而不是已完成变更的报告。
