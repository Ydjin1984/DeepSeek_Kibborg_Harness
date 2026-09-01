# Agent Note: 技能页中的批量评测与实时状态刷新

Status: implemented

[English](2026-09-01-skills-benchmark-batch-and-status-refresh.md) | 中文

## Problem

技能管理页存在两个评测不一致问题。其一，状态徽章仅在区块挂载时读取一次，之后不再刷新：技能被编辑、评测或自动改进后，`not-tested` 或 `benchmark-outdated` 会一直保留到区块重新挂载，刚完成的评测看起来就像没有保存。其二，Auto Improve 把候选版本的评测摘要以活动版本的 `version` 字段存到候选版本键下，激活胜出版本后 `lastBenchmark.version` 与活动版本不再匹配，状态检查会把刚改进的技能标为 `benchmark-outdated`。

评测本身只能逐个技能进行：没有一次性重测所有受管技能的操作，而模型选择（任务模型、评估模型、用例数）只存在于单个技能的对话框里，因此一次全面扫描意味着为每个技能各打开一次对话框。

## Decision

技能管理器新增了顺序批次执行器，wire 新增了批次方法，区块新增了带模型字段与 Run-all 操作的工具栏，以及实时状态刷新。

**顺序批次，由管理器拥有。** `SkillManager.startBenchmarkBatch` 启动一个后台任务，按序对每个指定技能各运行一次 `runBenchmark`，并把每个运行记录到既有的 `benchmarkRuns` 注册表中，因此 `pollBenchmark`/`cancelBenchmark` 无需改动。失败的技能以 `failed` 结算自己的运行，批次继续处理下一个名称。所有运行共享一个 `AbortController`：取消批次中的任何运行，都会把当前运行中止为 `cancelled`，并把所有尚未开始的运行标记为 `cancelled`。wire 方法 `skill.benchmarkBatchStart` 携带 `{ sessionId, names, taskModel, evaluatorModel?, caseCount? }`，穿过 rpc-map、zod schema、fetch carrier 与 connection 白名单；浏览器通过区块 `SkillsActions` 上新增的 `benchmarkBatchStart` action 调用它。

**Auto Improve 重新绑定候选摘要。** 候选运行的摘要以修正为候选版本的 `version` 重新挂到候选版本键下，使状态检查（`lastBenchmark.version === activeVersion`）对激活的胜出者保持为真。

**工具栏拥有模型选择。** `BenchmarkModelControls` 组件（任务模型、评估模型、同模型快捷方式、用例数）由区块工具栏与单技能对话框共享。工具栏通过 `initial` prop 为对话框的运行表单注入默认值，因此用户只需为全面扫描选择一次模型，对话框默认沿用同一选择。Run-all 按钮会对每个非内置受管技能启动批次；批次运行期间工具栏控件锁定，进度行显示当前技能，Cancel 按钮中止整个批次。

**运行结算时刷新状态徽章。** 单运行轮询 effect 与批次轮询 effect 都会在运行进入终态后重读目录（`refresh()`），使 `enabled`/`benchmark-outdated`/`not-tested` 立即反映已持久化的摘要。随后批次行报告裁定计数（`improved`/`worse`/`unchanged`/`failed`）或已取消提示。

## Alternatives considered

**并行批次。** 同时启动每个技能的评测会更快完成扫描，但 `runBenchmark` 已会为每个用例创建全新 agent 并流式调用模型；N 个并发套件会成倍增加任务模型的负载，并使取消与限流变得不可预测。顺序执行让扫描成本与逐个技能相同，这也正是单技能流程原本的开销。

**客户端循环调用 `benchmarkStart`。** 区块本可以在浏览器中逐个 `benchmarkStart` 并等待每个运行完成后再继续。这会重新实现运行注册表、共享取消与结算簿记，而且页面刷新会让半途运行悬空。管理器本就拥有运行；批次只是进入该注册表的另一个入口。

**模型选择仅保留在对话框。** 模型原本就在单技能对话框里；Run-all 可以复用最后一次对话框选择。但需求明确要求在与按钮同一窗口内选择扫描模型，而且共享组件避免了同一套控件出现两份分叉实现。

## Consequences

批次按构造比并行扫描慢，但负载被限制在单个评测规模的 agent 与模型调用之内，单技能对话框行为不变。工具栏模型字段是区块中新增的常驻可见状态；它们默认取目录首个模型，且仅在区块生命周期内保留。Run-all 排除内置技能，因为内置技能没有可挂摘要的受管版本（管理器的 `attachBenchmark` 需要文件系统条目）；卡片级 Benchmark 按钮仍然保留，若使用会报告管理器的拒绝。批次取消按设计是全有或全无（单一共享控制器），与单个 Cancel 按钮匹配。UI 无法触达的防御性分支（按钮禁用态、批次空状态）带有 `v8 ignore` 注解；可达分支由组件测试覆盖。
