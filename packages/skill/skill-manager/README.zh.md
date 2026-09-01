# @deepseek-ai/dsh-skill-manager

[English](README.md) | 中文

DeepSeek Harness 的技能生命周期管理：原生 `SKILL.md` 格式之上的受管文件 CRUD 层、回收站、版本历史、回滚、启用/禁用、校验、静态安全分类，以及带 Auto Improve 的对称 A/B 基准评测引擎。

本包在现有技能机制**之上**增加自动化和管理层——它绝不替代现有机制。它复用文件系统提供者的共享解析器和项目根规则（`@deepseek-ai/dsh-skill-filesystem`），写入提供者发现的同一批根目录，提供者的 watcher 会在此包的变更上使注册表失效。`ctx.skills`、`available_skills`、`skill({ name })` 以及调用策略契约均未改动。

## 插件

需要 `ctx.skills` 和 `ctx.tools`（`inject: ['skills', 'tools']`）。

### 配置

| 字段 | 默认值 | 含义 |
|---|---|---|
| `dshHome` | `$DSH_HOME` 或 `~/.dsh` | DeepSeek Harness 配置根；`user` 作用域写入 `<dshHome>/skills`。 |
| `agentsHome` | `$DSH_AGENTS_HOME` 或 `~/.agents` | 共享 agent 配置根（当前仅作信息）。 |

### 提供的服务

- `ctx.skillManager` — {@link SkillManager} 服务（CRUD、回收站、版本、回滚、启用/禁用、校验、安全、后台基准评测）。
- `skill_manage` 模型可见工具——Skill Creator 模型驱动每一项操作的程序化接口。
- `skill-create` 系统技能——用户可调用（`user-invocable: true`、`disable-model-invocation: true`）的运行时技能，正文随包发布为 `assets/skill-create/SKILL.md`，并通过现有 `/skill-create` 手势边界注入。

## 存储作用域

| 作用域 | 路径 | 注册表来源 |
|---|---|---|
| `user` | `<dshHome>/skills/<name>/SKILL.md` | `user-dsh` |
| `project` | `<projectRoot>/.dsh/skills/<name>/SKILL.md` | `project-dsh` |
| `agents` | `<projectRoot>/.agents/skills/<name>/SKILL.md` | `project-agents` |

项目根是最近的包含 `.git` 的祖先目录，与文件系统提供者一致。技能保持原生 `<name>/SKILL.md` 布局；管理器在技能目录内新增两个伴随产物（发现与 watcher 会忽略它们）：`SKILL.manager.json`（版本历史、基准评测摘要、时间戳）和 `.versions/<vN>/SKILL.md`（版本正文）。禁用会写入文件系统提供者认可的 `.disabled` 标记。回收站位于 `<root>/.system/trash/` 下。

## 操作

- **save** —— 用共享解析器校验、运行安全检查、写入 `SKILL.md`，并将先前正文快照为版本。创建会拒绝同名已有技能（除非 `replace`）；`blocked` 安全结论会拒绝保存（除非 `force`）。
- **remove / restore / permanentDelete** —— 移入回收站、移回（拒绝同名冲突）、或永久删除。内置技能拒绝删除。
- **setEnabled** —— 切换 `.disabled` 标记；禁用从不触碰正文或调用 frontmatter。
- **versions / rollback / activateVersion / publishVersion** —— 带每版本基准评测摘要的版本历史；回滚发布一个正文为目标版本的新版本（历史永不销毁）；激活在已发布版本中选择而不产生新事件（基准评测最佳版本规则）。
- **validate / securityCheck** —— 共享解析器校验（带精确失败原因）；静态安全分类 `valid` / `warning` / `blocked`，带发现与匹配证据。

## 基准评测

基准评测引擎运行对称 A/B 测试：对每个生成的用例，一次不带技能的任务执行和一次带技能的执行，使用相同的输入、工作区、任务模型和环境——唯一差异是作为运行时技能注册到任务 agent 作用域的技能正文。

- **自适应套件** —— 短正文 3 个用例，中等 5 个，长/复杂 7 个（可用 `caseCount` 覆盖）。
- **盲评** —— 评估器模型（默认等于任务模型）将两份输出作为匿名 `Candidate A` / `Candidate B` 接收，并按派生标准各打 0–100 分。
- **指标** —— 质量得分、输入/输出/总 token、执行时间、工具调用次数，以及带评论的逐用例详情。
- **结论** —— 由聚合得出 `improvement`、`worse` 或 `no-significant-improvement`，绝不由单一指标得出；逐用例回退以原因形式报告。
- **Auto Improve** —— 迭代生成候选、校验并安全审查每个候选、逐个评测，并且只激活比当前最优超出 `minImprovementPercent` 的候选（`maxIterations`、`stopOnRegression` 限制）。更差的候选绝不替换活动的最优版本。
- **运行** —— `startBenchmark` / `startAutoImprove` / `startBenchmarkBatch` 返回实时运行视图；`pollBenchmark` 与 `cancelBenchmark` 观察与取消。批次按序对每个指定技能各运行一次评测，每个运行各自记录，失败技能之后继续，取消其中任一运行即中止整个批次。每个完成的运行都会持久化到被测试的版本（候选摘要重新绑定到实际测试的候选版本），评测后编辑技能会将评测标记为过期（状态 `benchmark-outdated`）。

## Model Experience

`skill-create` 系统技能指导模型完成 创建 → 分析 → 提问 → 生成 → 校验 → 安全 → 预览 → 测试 → 改进 → 保存 的工作流，所有文件操作都调用 `skill_manage`。工具渲染紧凑的文本结果（校验原因、安全结论与发现、保存路径、基准评测摘要）。基准评测与 Auto Improve 在后台运行，模型不会阻塞于长时间任务执行。

#### KV Cache effect

无直接影响。运行时技能注册是每个任务 agent 作用域级的，因此基准评测任务运行不会改变调用会话的请求历史。

## 已知限制与后续工作

- **仅限本地宿主机文件系统** —— 受管写入使用 Node 文件系统 I/O 访问本地根目录，与文件系统提供者的 trusted-host 路径一致；远程/沙箱文件系统后端不用于变更。
- **静态安全启发式** —— 安全检查基于模式且刻意保守；无法证明任意指令中不存在 prompt-injection 或其他风险。
- **基准评测任务是隔离 agent** —— 每次 A/B 执行都使用任务模型创建全新 agent；工具目录来自所挂载的 preset 组合，因此任务 agent 必须能触达技能所需的工具。
- **无跨版本基准评测复用** —— 每次基准评测运行都会重新执行完整套件；尚无增量或缓存评测。
