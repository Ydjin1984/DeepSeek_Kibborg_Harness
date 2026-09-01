# Agent Note: 技能生命周期管理、基准评测与 Skill Creator

Status: implemented

[English](2026-08-31-skill-manager-and-benchmark.md) | 中文

## 问题

技能曾是一种静态存储系统：文件系统提供者发现 `SKILL.md` 树，tool-skill 消费者提供服务。没有从描述创建技能、在保存前用共享解析器校验、对指令做安全分类、保留版本历史、安全回收、度量技能是否真的帮助模型、或依据度量结果改进技能的途径。用户能做的一切都是手工编辑文件与人工检查。

任务是在现有机制之上增加完整生命周期——CREATE → VALIDATE → SECURE → TEST → EVALUATE → IMPROVE → VERSION → DEPLOY → USE → ROLLBACK——且不派生技能格式、解析器、发现、调用或 `skill({ name })`。

## 决策

主机平面 **skill manager** 包（`@deepseek-ai/dsh-skill-manager`）拥有生命周期，**系统技能**（`skill-create`）拥有面向模型的工作流。两者严格分离：技能指导模型完成 创建 → 分析 → 提问 → 生成 → 校验 → 安全 → 预览 → 测试 → 改进 → 保存 的工作流，并经由 `skill_manage` 工具驱动每个文件操作；包负责实现操作。

**管理器是现有根目录之上的一个层。** 它写入文件系统提供者发现的同一批目录（`<root>/.dsh/skills`、`<root>/.agents/skills`、`<dshHome>/skills`），复用提供者的共享解析器（`parseSkillSource`）与项目根规则，并依赖提供者的 watcher 在此包的变更上使注册表失效。技能保持原生 `<name>/SKILL.md` 布局。两个伴随产物位于技能目录内，对发现与 watcher 不可见：`SKILL.manager.json`（版本历史、基准评测摘要、时间戳）与 `.versions/<vN>/SKILL.md`（版本正文）。每个版本（包括活动版本）都会快照，因此回滚与激活从快照读取，而非重新推导内容。

**冲突解决是显式的。** 创建拒绝同名已有技能（除非 `replace`）；`blocked` 安全结论拒绝保存（除非 `force`）；回收站拒绝同名冲突；内置技能拒绝删除。任何地方都没有静默覆盖或静默删除。

**启用/禁用是提供者认可的标记。** 禁用写入 `<name>/.disabled`；文件系统提供者跳过携带它的目录技能，watcher 在标记变更时使目录失效。正文与调用 frontmatter 永不被触碰，因此 `user-invocable` 与 `disable-model-invocation` 保持精确语义。

**安全验证器是静态且保守的。** 它将正文分类为 VALID / WARNING / BLOCKED，并带匹配证据，标记显式指令覆盖、隐藏、策略绕过、凭据外泄、破坏性命令（blocked），以及远程执行、提权、外部 URL 与脚本执行（warning）。它从不改写内容。

**基准评测引擎运行对称 A/B。** 对每个生成的用例，一次不带技能的任务执行与一次带技能的执行使用相同的输入、工作区、任务模型与环境；唯一差异是以运行时技能注册到任务 agent 作用域的技能正文。评估器模型（默认等于任务模型）将两份输出匿名作为 `Candidate A`/`Candidate B` 接收，并按派生标准各打 0–100 分。套件规模随技能复杂度自适应（3/5/7）。结论（`improvement`/`worse`/`no-significant-improvement`）由聚合得出，绝不由单一指标得出，逐用例回退以原因形式报告。

**Auto Improve 保护最佳版本。** 候选被生成、校验、安全审查、作为非活动版本发布、评测，并且只在超出当前最优 `minImprovementPercent` 时激活；`maxIterations` 与 `stopOnRegression` 约束循环。更差的候选绝不替换活动的最优版本，取消也绝不回滚已保存的最优版本。

**系统技能依托现有手势。** `skill-create` 以真实 `SKILL.md` 资产发布，用共享解析器解析，并注册为用户可调用的运行时技能（`user-invocable: true`、`disable-model-invocation: true`），因此 `/skill-create` 通过现有 tool-skill pre-step 边界注入工作流，无需新命令面。UI Create Skill 按钮复制同一手势，保持单一工作流。

**网关暴露生命周期。** `skills` RPC 域新增 listManaged/read/save/remove/restore/permanentDelete/trash/setEnabled/versions/rollback/validate/securityCheck/benchmarkStart/benchmarkPoll/benchmarkCancel/benchmarkBatchStart/autoImprove，全部按会话寻址（客户端永不提交原始路径）。管理器失败携带稳定 `skill-manager-error` 码，details 中带管理器自身码。变更面与 settings、credentials 一样钉到 loopback。批次方法、工具栏模型字段与运行后的状态刷新见[批量评测笔记](2026-09-01-skills-benchmark-batch-and-status-refresh.md)。

## 已考虑的替代方案

- **仅模型的创建者 + 文本文件指令。** 被任务否决：文件操作必须程序化。`skill_manage` 工具即编程面，每个操作都经过管理器服务。
- **将版本存入独立的旁车根目录。** 被否决：任务禁止非标准存储格式，并要求物理路径匹配现有根目录；每技能 `.versions/` 与 `SKILL.manager.json` 将一切保持在提供者已忽略（深度二以下）的技能目录内。
- **通过重命名技能目录启用/禁用。** 被否决：发现解析 frontmatter 而非目录名，因此 `<name>.disabled` 目录仍会按其 frontmatter 名被发现。提供者认可的标记文件是唯一精确机制。
- **通过完整 agent 与文件级技能暂存做基准评测。** 被否决，改为在任务 agent 作用域内做运行时注册：这是 A/B 所需的唯一差异，无需文件系统变动，也不会与 watcher 竞争。
- **Auto-improve 作为创建者技能中的模型驱动循环。** 被否决：循环需要程序化限制（迭代、阈值、回归停止）与最佳版本簿记；引擎拥有它，模型只编辑内容。
- **为 `/skill-create` 单独注册命令目录条目。** 被否决：命令在行成为提示之前于客户端解析，因此命令不会到达模型；技能手势是原生路径。

## 后果

用户可以从描述或完整 ТЗ 创建技能，在保存前校验与安全审查，选择 user/project/agents 作用域，用所选任务与评估器模型对基线做 A/B 基准评测，逐用例查看质量/token/时间/工具指标，以回归保护手动或自动改进，回滚到任意版本，并从新的 Skills 页管理它——同时现有技能、解析器、发现与调用保持不变地工作。

文件系统提供者获得两项附加行为（`.disabled` 标记与导出解析器），完全向后兼容；apiproxy 网关新增 16 个方法与一个错误码；web 配置文件挂载一个主机行（`skill-manager`）与一个客户端行（`ui-settings-skills`）。

两个代价是真实的。基准评测任务是隔离 agent，因此任务 agent 必须能触达技能所需的工具；安全验证器基于模式，无法证明任意指令中不存在 prompt-injection。版本是全文快照，因此历史随正文大小增长；尚无增量存储或跨版本基准评测复用。

## 要求的验证

- `packages/skill/skill-manager` 测试达到每个文件 100% 覆盖（manager、benchmark、security、tool、skill-create、plugin）。
- `packages/host/apiproxy` 测试覆盖新的 skill-manager 方法与 wire round-trip。
- 系统技能 `skill-create` 在加载时通过共享解析器（其自身资产即夹具）。
- 现有技能测试保持通过；提供者的 `.disabled` 标记与解析器导出已覆盖。
