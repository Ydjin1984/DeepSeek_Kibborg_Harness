# @deepseek-ai/dsh-orchestrator

[English](README.md) | 中文

编排模式（宿主半区）。启用后，部署将模型角色拆分：会话当前的聊天模型担任「头部（规划者）」，并通过 `executor` 工具把繁重的工具驱动工作委托给始终运行在配置的「本地模型」（`executorProvider` / `executorModel`）上。云端 token 花在规划与综合上，本地模型为长工具链（搜索、批量读文件、shell 命令）买单。头部角色无需路由字段：它就是会话在输入框中由模型选择器选中的那个模型。

该插件在一个生命周期 effect 内注册两样东西：

- **`executor` 工具** —— 通过 `ctx.subagents`（`subagentProvider`，默认 `spawn`）向配置的本地路由发起一次前台委托。子代理收到完整独立的 prompt 与完整工具集，但绝不继承头部角色：spawn 会向子代理隐藏 `executor` 工具（`toolFilter`），把委托深度限制为一级（`maxDepth: 1`），并注入一段精简的工作者 persona——每项都仅在所选 provider 声明相应能力时生效。子代理未干净结束时，错误中会保留部分输出。
- **系统提示词 section** —— 启用期间告诉顶层头部模型加载 `orchestrator-head` 技能并通过 `executor` 委托。对委托代理（`subagentDepth > 0`）该 section 渲染为空，工具也拒绝从委托代理执行——递归在任何路径上都被限制。

配置位于插件的实时 `orchestrator` SETTINGS NAMESPACE（在 Settings → Models →「编排器」中编辑，或直接在宿主平面修改）；编辑即时生效——工具与提示词 section 在每次调用/渲染时读取已解析的 namespace，设置 watcher 随模式开关挂载或卸载工具。`enabled: true` 而没有模型时，工具保持未挂载、section 为空；UI 表单会把 executor 路由标为必填。配套技能 `orchestrator-head` 与 `orchestrator-executor`（`.agents/skills`）承载操作协议。

## 模型体验

直接影响：启用模式会添加一段系统提示 section 指导头部；头部的 `executor` 调用会在本地模型上运行一个完整子代理——每次调用都是独立的代理回合，有自己的会话，像任何子代理委托一样记录。模式关闭时，插件不添加任何模型可见输入；section 不渲染。

#### KV Cache 影响

启用时 section 会改变头部系统提示词，因此会使其缓存前缀失效一次。executor 调用本身是独立子会话，不影响头部缓存。

## 已知限制与延后工作

- **基于设置的配置** —— executor 路由与模式开关位于 `orchestrator` settings namespace，而非 cordis config；插件按设计不暴露 `Config` 对象。
- **角色拆分靠提示引导** —— 没有硬性机制强制头部委托；executor 路由在工具本身被钉死，这才是 token 花费的关键强制边界。
- **executor 运行为串行** —— 工具声明 `isConcurrencySafe: false`，因此重叠的 executor 调用会排队，而不会在共享文件与 shell 上竞争。
- **头部没有路由选择器** —— 头部就是会话当前的聊天模型；Settings → Models →「编排器」只配置本地 executor 路由。
- **技能注入并非自动** —— 头部必须通过 `skill` 工具自行加载 `orchestrator-head`；技能位于 `.agents/skills`，仅当会话 cwd 为本仓库时可见。相比之下，工作者 persona 会通过 spawn composition 注入每个 executor 子代理。
