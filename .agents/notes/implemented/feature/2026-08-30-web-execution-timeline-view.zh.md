# Agent Note: Web 执行轨迹时间线视图

Status: implemented

[English](2026-08-30-web-execution-timeline-view.md) | 中文

## 问题

Web 对话把智能体的步骤渲染成聊天流：工具行、助手 Markdown、命令和回合尾随其后，彼此之间没有统一的时间线语义。读者无法一眼看出智能体正在做什么、正在修改哪个文件、正在运行哪条命令、哪些步骤失败，以及整个轨迹的全貌——没有逐事件的类型/状态/时钟装饰，没有摘要头部（计数器、当前动作、计划、涉及文件），没有对轨迹的搜索或分类过滤，也没有虚拟化，长时间自治运行会在无条件下渲染数千个节点。

## 决策

`ui-conversation` 新增第二个视图环条目——执行视图（`id: 'execution'`，order 5），并成为对话默认视图（Chat 视图仍一键可达；持久化选择或未注册该条目的配置仍回退到 Chat）。该视图是现有对话快照之上的纯展示层——执行引擎、会话事件管道和聊天流均未改动。

**规范化事件模型。** 新增 `execution/` 域将每个最终 Chat 节点投影为规范化的 `ExecutionEvent`（`execution-event.ts`）：类型（analysis/thinking、tool_call/tool_error、command、file_read/edit/write/create/delete、git_*、task_completed/task_failed、warning、user_message 等）、类别（工具栏过滤桶）、状态（running/success/warning/error/info）、标题/描述、涉及路径、diff 行数和时长。类型映射由节点类型加线上工具名推导；diff 计数与路径来自工具渲染意图视图（`card: 'diff'`），与聊天 diff 卡片使用同一来源。`execution-summary.ts` 将事件折叠为头部事实：回合/步骤/工具/错误计数器、当前动作（最新运行事件、流式 partial 或空闲）、以及按文件的活动（状态字母、新增/删除行数、用于滚动定位的首个事件）。

**共享节点席位。** 槽位每个 key 只允许一个声明者，因此 Chat 与执行视图不能各自声明 `'conversation.chat.node'`。声明（连同 `'conversation.message.images'`）从 chat 条目上移到 `'conversation.session'` 主体条目，主体通过 `'conversation.view'` owner share（`ConvViewOwnerProps`）把 `renderChatNode` 与 `renderMessageImages` 交给每个视图。ChatNodeSeat 与执行行都经由该回调分发，因此 ui-tool 的各工具渲染器（diff/terminal/read/search/web 卡片）、助手 Markdown 和命令行在两个视图中经同一分发点以相同方式渲染。主体条目的 inject 增加 `loadImage`；视图 inject（`ChatViewInjected`）移除它。

**时间线展示。** 每个事件一行：前导图标、时钟、类型徽章、标题字段、diff 计数、时长、状态点、展开箭头；展开后的主体经共享席位渲染所属 Chat 节点（技术行默认折叠，散文行默认展开）。粘性头部投影会话标题、运行状态胶囊、计数器、当前动作、作为计划条的 `todos` 投影，以及涉及文件列表（点击滚动到首个相关事件）。工具栏提供自由文本搜索（匹配高亮）、分类胶囊（全部/分析/工具/文件/终端/Git/错误/成功）、全部展开/全部折叠，以及跟随滚动与跳至最新。事件列表是带测量行高的窗口化虚拟列表（`execution-virtual.ts`），只挂载可见窗口加 overscan；流式追加在快照交换后重新推导而无需重挂载行。复制、ANSI 终端、diff 与 Markdown 表面复用现有原语（`DiffBlock`、`TerminalBlock`、`CodeBlock`/`MarkdownText`、`StateDot`、`JsonBlock`）；视图经现有 `data-conversation-composer-overlay` 模式自持滚动视口，并将滚动条间接值重绑定到 l2 对。

## 备选方案

**独立的 `ui-execution` 插件包。** 视图必须渲染 `'conversation.chat.node'`，该槽由 ui-conversation 声明一次；新包不能重新声明（每槽一个声明者），且客户端包规则禁止跨包值导入，因此只能重实现每个节点渲染器。否决。

**在执行视图内重实现节点渲染。** 重复 ui-tool 的卡片与 Markdown 表面，违背"每事件一个专用渲染器"的方向。否决；共享席位保持单一分发点。

**保留 Chat 为默认视图。** 风险更低，但轨迹视图会被埋在一个标签之后，产品仍以旧表面为主体验。否决；过期的持久化选择与不含该条目的 bench 仍回退到 Chat（`resolveActiveView` 依次回退到默认、`chat` 标签、首个标签）。

## 后果

Chat 行为不变：聊天流、分页、流式隔离与输入区交互保持其测试，节点席位声明的上移保持同样的 ledger 规格（`kind: 'keyed'`、`scope: 'session'`、turn-data inject）。ui-tool 中现有的 real-machinery 套件通过持久化的按会话选择恢复 Chat 视图，对话套件断言扩展后的环。长轨迹保持响应：虚拟列表只挂载可见窗口，行自测高度，头部摘要随快照增量推导。执行视图仅是展示层——没有新内容进入模型请求，也没有新增或改动任何会话事件。
