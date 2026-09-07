# Agent Note: Orchestrator head tool schema visibility

Status: implemented

[English](2026-09-07-orchestrator-head-tool-schema-visibility.md) | 中文

## Problem

编排模式把会话的聊天模型（HEAD 规划者，委托 depth 0）与本地 executor 工作进程（depth ≥ 1）拆开。`headDenyTools` 已在审批之前于 `tools/pre-execute` 拒绝所列名称，但 HEAD 仍会在 `systemPrompt.assemble()` 面向模型的 schema 中收到这些工具。模型因此为用不到的定义花费 token，并尝试随后会被策略拒绝的调用。

`tools.restrict()` 不能拥有这份列表。加在 HEAD 作用域上的限制会继承到同进程的 executor 子代理，而子代理必须保留完整工具集。

## Decision

`@deepseek-ai/dsh-orchestrator` 在 `system-prompt/assemble` waterfall 上过滤已组装的 schema，生命周期与 pre-execute 监听器相同，都由实时设置驱动。模式启用且 `headDenyTools` 非空时，插件注册这两个监听器；关闭模式、清空列表或拆除 fiber 会一并释放它们。

过滤使用与执行相同的纯决策：[`headToolDeny`](../../../../packages/context/orchestrator/src/policy.ts) / [`filterHeadToolSchemas`](../../../../packages/context/orchestrator/src/policy.ts)。Depth-0 组装在 `next()` 之后去掉所列 `ToolSchema.name`，因此后续 waterfall 监听器无法把被拒绝的工具加回去。Depth ≥ 1、没有 `agent` 的组装（宿主诊断）、空 deny 列表以及关闭模式都保持 `assembly.tools` 不变。

`dsh-agent` 的 `assembleContextFor(agent)` 已经把 `agent` 放进 `AssembleContext`，编排器的提示词 section 已经读取该字段。插件不改动 `dsh-agent-loop`、`dsh-system-prompt` 或 `dsh-tools`。

隐藏 schema 不是安全边界。伪造或残留调用仍由 pre-execute 拒绝作为执行检查。两个监听器共用一个 disposer，因此不会各自开关。

## Alternatives considered

**在 HEAD 作用域上使用 `tools.restrict()`。** 注册表的限制会继承到尚未发布的同进程子代理。这会让 executor 工作进程也看不到这些名称，而它必须运行它们。T6 否决了这条路径。

**在 `dsh-agent-loop` 的 assemble 与 `buildRequest` 之间过滤。** 循环将不得不了解 `headDenyTools`。策略属于编排器包，它已经拥有设置命名空间和 pre-execute 监听器。

**用 tools 提供方省略 schema。** 提供方只能添加 schema，不能删除其他提供方的贡献。assemble waterfall 才是文档中具有权威性的变换。

**只隐藏 schema、不做 pre-execute 拒绝。** 仅展示层过滤会让残留调用或 Code Mode 调用执行提示词中已省略的工具。执行拒绝已经落地；本次只对齐 schema。

## Consequences

HEAD 的 LLM 请求不再列出被拒绝的工具，因此模型无法从 schema 中选择它们。executor 子代理仍看到完整集合。更改 `headDenyTools` 或开关模式会改变 HEAD 的 tools 头，并使该缓存前缀失效。

若部署需要让 HEAD 看不到某工具，必须把它写进 `headDenyTools`。未列入的工具仍然可见且可调用；提示词仍要求 HEAD 通过 `executor` 委托繁重工作。
