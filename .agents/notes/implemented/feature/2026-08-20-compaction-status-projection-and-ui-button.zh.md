# Agent Note: 压缩状态投影与手动压缩按钮

Status: implemented

[English](2026-08-20-compaction-status-projection-and-ui-button.md) | 中文

## Problem

压缩已作为能力接缝存在，并具备自动的步骤边界压力与溢出恢复，但 Web 界面既不提供直接的手动控制，也不提供策略可见性。唯一的手动路径是在输入框中输入 `/compact`；输入框的 ContextMeter 只显示占用率，却不显示自动压缩会在哪里触发；也没有任何信号表明压缩正在进行，因此第二次手动请求会与锁竞争。在使用本地 128k 模型时，长任务会频繁越过默认 0.8 阈值，用户既需要一键立即压缩，也需要知道自动压缩何时（或不会）介入。

## Decision

### 一个只读的 `compaction` 会话投影单元

`dsh-compaction-basic` 注册一个 `compaction` 会话投影单元（纯折叠，无 store，无自有事件），发布浏览器可读的三项事实：

- `auto` — 当前部署是否启用自动压力/溢出压缩（`BasicCompactionConfig.auto`）。
- `thresholdRatio` — 当前路由解析出的压力阈值比例：精确的 `modelPolicies` 覆盖或顶层默认值，与请求时的解析路径完全一致（`resolveTargetPolicy`）。在出现 `request/context` 路由记录之前缺席。
- `active` — 压缩事务正在进行（`compaction/start` 尚未配对的 `compaction/end`），并由 `session/end-seed` 重置，与后端对生命周期前孤立标记的分类完全一致。

该单元的 `apply` 是对持久日志的纯折叠（`compaction/start`/`compaction/end`、`request/context`、`session/end-seed`），并闭包捕获引擎校验后的配置，因此 `auto` 与阈值永远不会与注册它的实例产生漂移。注册是引擎构造函数的可选子项（`ctx.inject(['sessionProjections'], …)`），因此没有注册表的 headless 组合保持独立的读取形态——与 `dsh-token-meter` 注册其单元的模式相同。该值是模型不可见的：它是只读的投影状态，绝不是会话事件。

投影类型位于 `@deepseek-ai/dsh-compaction/projection`（纯类型 + `SessionProjectionMap` 合并），并新增 `@deepseek-ai/dsh-compaction/client` 出口，与 `checkpoint` 叶子模式一致，客户端程序无需加载宿主插件的 Context 合并即可引用该键。

### 一个 `ui-compact` 客户端插件：一个输入框按钮

新的 `@deepseek-ai/dsh-client-ui-compact` 包向现有 `conversation.input.right` 列表插槽（输入框工具栏行，模型选择与 ContextMeter 圆环左侧）注册一个按钮。当 `compaction` 投影键缺席时它不渲染任何内容——这是投影注册表的“能力缺失”契约，因此未挂载压缩后端的部署不会付出任何布局成本。

该按钮：

- 通过 `ctx.remote.commands.execute` 执行 `/compact`，与输入斜杠命令的准入路径完全相同，因此已落定的生命周期以持久命令节点与 `CompactionCommandCard` 检查点披露的形式渲染，插件自身不持有任何状态；
- 在 agent 运行中、会话已移除、`active` 为真（压缩已在进行）或自身请求挂起时禁用；
- 当 `contextPressure.projectedTokens / contextWindow` 达到 `thresholdRatio` 时，以警告别名着色并将文案改为“已接近自动压缩阈值（{percent}% / {threshold}%）”；当 `auto` 为假时显示“仅手动压缩”。

该插件不持有 store、事件监听器或刷新链：两项事实都通过标准套件的 `useProjection` 到达，变更动词只是命令 Remote 之上的普通注入回调。`dsh-compaction` 声明为 peer 依赖，因为插件对投影合并做类型导入。

## Alternatives considered

- **在 `ui-conversation` 内部放一个压缩按钮** — 已拒绝：仓库规则是每个 UI 功能一个插件包，且 ui-conversation 需要学习压缩词汇（命令 Remote、投影合并）。该按钮是既有插槽之上的独立表面。
- **在客户端硬编码阈值** — 已拒绝：阈值是部署级且按路由可配置的（`modelPolicies`）；客户端常量恰恰在最需要的时候（不同的本地模型、调优的策略）会与真实触发器漂移。投影从与引擎相同的代码路径解析它。
- **从会话 `running` 推导进行中状态** — 已拒绝：`compactNow` 作为空闲维护操作运行，压缩期间会话并非 `running`；只有 `compaction/start…end` 括号能报告锁，而这正是投影折叠的内容。
- **专用命名席位（`conversation.input.compact`）** — 暂缓：现有列表插槽提供相同的排序，且无需在 ui-conversation 中改动 SlotMap/children；若未来该控件需要单占用者语义，命名席位仍可用。
- **在 ContextMeter 面板内显示阈值线** — 暂缓：仪表保持只显示占用率，按钮的 tooltip 已携带阈值事实；将仪表读取并入 ui-conversation 会引入独立包所避免的耦合。

## Consequences

- **包**：`dsh-compaction` 新增 `projection` 叶子与 `./client` 出口（并新增 `dsh-session-projection` peer/dev 依赖）；`dsh-compaction-basic` 新增 `projection.ts` 单元并从引擎构造函数注册；`dsh-client-ui-compact` 是接入 web-app 打包清单的新动态客户端包。
- **投影按会话且引用计数**：同一预设的 N 个会话按会话共享折叠单元；同一键的多个预设挂载共享一个单元（先注册者生效）；随附预设都携带相同的压缩默认值，因此跨预设共享键时 `thresholdRatio` 不同是一个文档化的非目标。
- **模型可见 ⟺ 日志记录 仍然成立**：按钮不新增会话事件；它触发的压缩本就是后端记录的括号 + 检查点替换。
- **暂缓**：ContextMeter 面板内的阈值标记、显式的“刚刚完成压缩”瞬时提示（流节点已拥有该呈现），以及按路由暴露 `retainRatio`。

## Testing

- **宿主单元**（`compaction-projection.spec.ts`）：真实 SessionStore + 注册表 harness 驱动对 `compaction/start`/`end`、`request/context`（默认比例、`modelPolicies` 覆盖、回退）与 `session/end-seed` 重置的折叠，并固定 `auto: false` 视图。
- **客户端组件**（`compact-control.client.spec.tsx`）：能力门控（无键时不渲染）、基础文案、恰好到达阈值时的警告着色与改文案、阈值以下的中性、`running`/`active`/挂起时的禁用、仅手动文案、静默成功，以及错误/未匹配提示的 toast 呈现。
