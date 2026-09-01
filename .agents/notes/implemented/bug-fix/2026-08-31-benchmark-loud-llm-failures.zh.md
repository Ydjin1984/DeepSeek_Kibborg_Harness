# Agent Note: 基准评测响亮失败并隔离任务代理

Status: implemented

English | [中文](2026-08-31-benchmark-loud-llm-failures.zh.md)

## 问题

两个缺陷使技能基准评测在真实组合中失败或行为异常。

第一，基准评测的 `callText` 辅助函数将汇集的流块过滤为仅文本并返回幸存文本，丢弃了流的终结 finish 原因。当 LLM 调用失败——未知的 provider 路由、认证错误或传输故障——adapter 流以不含文本块的 `error` finish 块结束，因此 `callText` 返回空字符串，`generateCases` 报出误导性的 `the model produced no usable test cases`，而非真实 provider 故障。这使误配置（例如 `provider/model` 路由中的拼写错误）隐藏在一个无法诊断的错误之后，并让整个基准评测看起来像坏了。

第二，基准评测任务代理通过普通代理工厂并以会话默认 preset 创建，因此继承了全局注册的 `skill_manage` 工具。任务模型因此能够通过管理器读取磁盘目录中的每个技能、改写正被测试的技能本身（真实运行创建了一个多余的版本），并在每个用例上循环调用管理器数十分钟。每任务 120 秒的截止时间也是死代码：它中止了一个无人监听信号的本地 `AbortController`，因此停滞的任务代理一直运行到人工取消整个基准评测。

## 决策

`callText` 在流完成后读取 `assembler.finish`，当 finish 原因为 `error` 时抛出携带底层 `LlmFailure.message` 的 `SkillManagerError`。信号中止保持优先：`signal.throwIfAborted()` 在 finish 检查之前运行，因此取消路径仍以 `cancelled` 结算。该检查仅对可合并扩展的 `FinishReason` 联合匹配 `kind === 'error'`；其他种类落到现有文本提取。由于 `callText` 支撑测试用例生成、用例评估与 auto-improve 候选生成，三者现在都会暴露真实故障。

`runTask` 在每个任务代理的 setup 中通过代理作用域的 `tools.restrict` 拒绝 `skill_manage` 工具，因此两条分支都无法通过管理器读取托管技能，也无法在被评分时改写被测技能。运行时注册的技能（with-skill 分支）通过代理作用域的 `ctx.get('skills')`（作用域绑定的 registry 实例）注册，因此 `register()` 只落入该代理的层；代理作用域不声明 inject，属性代理在那里不可用。每任务截止时间现在拥有中止链：本地 controller 在超时与基准评测级取消时都会中止，其 abort 调用 `agent.cancel({ kind: 'user' })`，因此停滞任务会结算而非拖垮整个基准评测。截止时间从 120s 提高到 300s，因为它现在真正生效且必须容忍较长的单次生成。

## 已考虑的替代方案

- **将错误消息作为文本载荷返回。** 被否决：这会把失败的生成变成看似成功的文本用例并污染评估。
- **对 `aborted` finish 也抛出。** 被否决：provider 侧中止很少见，且信号中止已由 `throwIfAborted` 重新抛出，把 `aborted` 当错误处理有将用户取消误标为失败的风险。
- **为 baseline 分支限制整个 `skill` 工具。** 被否决：`skill` 由 preset 按代理注册而非全局注册，因此作用域 `tools.restrict`（仅对照全局工具名校验）无法命名它；目录还会对 with-skill 分支隐藏，破坏 A/B。

## 后果

`benchmark-start` 或 `auto-improve` 中误配置或失败的模型路由现在以 provider 自身的消息使运行失败（例如 `model call failed: provider "dashscope" is not registered`），因此操作者修复路由，而非调试幻影般的 "no usable test cases" 失败。基准评测任务代理不再能改写技能或在管理器工具循环上停滞，因此运行在有界时间内完成且不破坏被测技能。变更仅限于基准评测引擎的错误与隔离路径；成功运行不变。

## 测试

`packages/skill/skill-manager` 新增三个用例：`fails loudly with the underlying LLM failure when the stream ends in an error finish`（fake LLM 产出 error finish 块）、`denies the skill manager tool to every benchmark task agent`（两条分支都记录该限制）与 `fails loudly when the with-skill agent scope lacks the skills service`。完整包测试套件（85 个测试）通过。现有 `no usable test cases` 路径对真正非 JSON 的模型输出仍响亮失败。
