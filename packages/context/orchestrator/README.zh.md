# @deepseek-ai/dsh-orchestrator

[English](README.md) | 中文

编排模式（宿主半区）。启用后，部署将模型角色拆分：会话的当前聊天模型担任 HEAD（规划者），把繁重的工具驱动工作委托给 `executor` 工具，而该工具始终运行在配置的本地模型（`executorProvider` / `executorModel`）上。云端 token 花在规划与综合上，本地模型为长工具链（搜索、批量读文件、shell 命令）买单。HEAD 角色不需要单独的路由字段：它就是会话在输入框模型选择器中选中的模型。

插件在同一个生命周期 effect 中注册两样东西：

- **`executor` 工具** —— 通过 `ctx.subagents`（`subagentProvider`，默认 `spawn`）向配置的本地路由发起一次前台委托。子代理收到完整独立的 prompt 和完整工具集，但不会继承 HEAD 角色：spawn 会向子代理隐藏 `executor` 工具（`toolFilter`），把委托深度限制为一级（`maxDepth: 1`），并注入一段精简的执行器 persona——每一项仅在所选 provider 声明对应能力时生效。若子代理未干净结束，错误中会保留部分输出。
- **系统提示词 section** —— 启用期间告诉顶层 HEAD 模型加载 `orchestrator-head` skill（技能）并通过 `executor` 委托。对已委托的 agent（`subagentDepth > 0`），该 section 渲染为空；工具也拒绝在委托路径上执行——每条路径上的递归都有界。

配置位于该插件的实时 `orchestrator` 设置命名空间（在 Settings → Models → 「Оркестратор」中编辑，或直接在宿主平面编辑）；编辑在运行时生效——工具和提示词 section 在每次调用/渲染时读取已解析的命名空间，设置监视器随模式开关挂载或卸载工具。`enabled: true` 但未设置模型时，工具保持未挂载、section 为空；UI 表单把执行器路由标为必填。配套 skill `orchestrator-head` 与 `orchestrator-executor`（`.agents/skills`）承载操作协议。

## 模型体验

直接影响：启用模式会添加一段系统提示 section 指导 HEAD；HEAD 的 `executor` 调用会在本地模型上运行一个完整子代理——每次调用都是独立的代理回合，有自己的会话，像任何 subagent 委托一样记录。模式关闭时，该 section 文本是本插件添加的唯一模型可见输入；section 不渲染。

#### KV Cache 影响

启用时 section 会改变 HEAD 的系统提示词，因此会使其缓存前缀失效一次。executor 调用本身是独立子会话，不影响 HEAD 的缓存。

## 已知限制与延后工作

- **基于设置的配置** —— 执行器路由和模式开关位于 `orchestrator` 设置命名空间，而不是 Cordis 插件配置；该插件按设计不暴露 `Config` 对象。
- **角色拆分靠提示引导** —— 没有硬性机制强制 HEAD 委托；执行器路由在工具本身被钉死，这才是 token 花费的关键强制边界。
- **执行器运行串行** —— 工具声明 `isConcurrencySafe: false`，重叠的 executor 调用会排队，而不是在共享文件和 shell 上竞态。
- **HEAD 没有路由选择器** —— HEAD 就是会话的当前聊天模型；只有本地执行器路由在 Settings → Models → 「Оркестратор」中配置。
- **skill 不会自动注入** —— HEAD 必须通过 `skill` 工具加载 `orchestrator-head`；这些 skill 位于 `.agents/skills`，仅当会话 cwd 是本仓库时可见。相比之下，执行器 persona 通过 spawn 组合注入每个 executor 子代理。
