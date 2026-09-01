# @deepseek-ai/dsh-client-ui-compact

[English](README.md) | 中文

手动上下文压缩控件（浏览器半区）：输入框工具栏行（`conversation.input.right`，位于模型选择与 ContextMeter 圆环左侧）中的一个压缩按钮。仅当宿主为当前会话挂载了压缩后端时才渲染——`compaction` 会话投影键就是能力门控，因此未装载 `dsh-compaction-basic` 的部署不会付出任何布局成本。按钮读取与该表层其他部分相同的两个投影：后端的 `compaction` 投影（`auto` 标志、当前路由解析出的 `thresholdRatio`，以及进行中的锁 `active`）与 token-meter 的 `contextPressure` 占用率（`projectedTokens / contextWindow`）。

点击按钮会通过 `ctx.remote.commands.execute` 运行 `/compact` 宿主命令——与输入斜杠命令完全相同的准入路径，因此已落定的生命周期会渲染为持久命令节点与 `CompactionCommandCard` 检查点披露，插件自身不持有任何状态。失败以锚定到输入框卡片的瞬时 toast 呈现；成功的压缩不需要本地回显，因为流节点已拥有该呈现。

以下情况按钮会禁用：agent 忙碌（`session.running`）、会话已移除、压缩已在进行（`active`），或其自身请求挂起。当投影占用率达到自动压缩阈值时，按钮以警告别名着色，tooltip 显示"已接近自动压缩阈值"；当后端以 `auto: false` 运行时，tooltip 显示"仅手动压缩"。自动的步骤边界压力与溢出压缩完全由后端负责——本插件从不触发它，也从不打扰模型。

`/client` 导出为插件主体（`apply`/`inject`）、`CompactControl` 组件以及注入面类型。

## 模型体验

间接影响：按钮调用 `/compact`，其 handler 执行一次摘要压缩——模型调用与表层替换都是后端自己的行为，记录为 `compaction/start…end` 括号加检查点 `user/message`。按钮本身不新增提示内容，也不新增会话事件；它读取的两个投影只读。

#### KV Cache 影响

按钮本身无影响。它触发的压缩会复用对话自身的系统提示、工具与前置消息进行摘要调用（后端行为），从而保留已摘要前缀的提供方热 KV cache。

## 已知限制与延后工作

- **阈值一致性**——警告着色将 `contextPressure.projectedTokens` 与 `thresholdRatio × contextWindow` 比较。两者都是投影，压力数值以提供方为锚并带启发式增量，因此着色是面向用户的参考，并非自动压缩恰好在该时刻触发的保证。
- **空闲要求延迟**——agent 处于轮次中时点击会被客户端拒绝（按钮禁用）；并发唤醒轮次造成的忙碌错误通过 toast 呈现。
