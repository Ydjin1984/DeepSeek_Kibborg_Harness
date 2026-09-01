# Agent Note: 技能描述本地化与菜单过滤

Status: implemented

[English](2026-08-30-web-skill-description-localization-and-menu-filtering.md) | 中文

## 问题

web 编辑器的「/」菜单在本地化测试中暴露出两个缺口。技能分组用 `skill.name.startsWith(query)` 过滤候选——区分大小写的前缀匹配，因此输入 `/sk` 什么都匹配不到（没有任何已安装技能的名字以 `sk` 开头），而命令分组按模糊子序列过滤；两组行为差异之大，让技能过滤看起来像坏了。此外，任何语言下每一行技能都渲染原始的英文 frontmatter 描述，因为技能格式只有一个面向模型的 `description`，而菜单是唯一感知语言的消费端。

## 决策

**技能过滤对齐命令分组的按名称匹配。** `ui-skill` 候选现在按技能名称的不区分大小写子串过滤，因此查询可以匹配 id 中的任何位置（`/eploy` 找到 `deploy`，`/sk` 找到 `find-skills`）。空查询保留所有行。与命令分组完全一致，过滤只针对名称。

**技能描述端到端获得按语言变体。** 技能核心（`dsh-skill`）为 `SkillDefinition`、`SkillCandidate` 与 `SkillSummary` 增加可选 `localizedDescription` 映射（`zh`/`ru` 键），并在每个边界校验（提供方候选、加载的定义、运行时注册），基础 `description` 仍然必填且是面向模型的默认值。文件系统提供方读取可选的 `description.zh` / `description.ru` frontmatter 键，内置 `dsh-badge` 提供方也携带同一映射。apiproxy 的 `skill.list` 线上契约（`SkillEntry`）把映射投影到浏览器，`ui-skill` 渲染当前语言对应的条目，并在 `en` 与未知语言时回退到原始描述。模型目录（`dsh-tool-skill`）不受影响：它只映射 `name`/`description`，因此本地化变体永远不会进入模型请求。

已发布的 DSH 技能（`.agents/skills` 的 dsh-* 集合、`record-browser-gif`、cordis preset 技能以及 `dsh-badge`）现在都带有 `description.zh` 与 `description.ru`。用户安装与第三方技能保持英文，直到其作者添加这些键——本地化是增量内容，而不是客户端字典，因为技能目录是部署内容，字典无法覆盖。

## 备选方案

- **按技能名称的客户端翻译字典。** 否决：目录是用户可安装的内容（仅本次部署就有 65 个个人技能），因此内置字典只能覆盖 harness 自己的技能，并且会随技能变化而腐化。技能文件是描述被编写的地方，所以翻译也应放在那里。
- **直接翻译候选的 `name`。** 否决：与命令菜单同样的原因——`name` 是选择与词表键；只有展示文本被本地化。
- **Host 端语言协商（`skill.list` 接收语言参数）。** 否决：目录已经按会话缓存且映射很小；返回所有语言并让感知语言的客户端选择，可保持线上契约无状态、缓存仅按会话键控。

## 影响

俄语或中文会话会在菜单中看到带本地化描述的技能行——只要技能带有这些描述，而已发布的 DSH 技能现在都有了。输入部分名称时，技能分组与命令一致地过滤。面向模型的目录逐字节不变。frontmatter 格式新增两个可选键；现有技能不受影响，格式错误的映射会让技能在校验时响亮失败，而不是被静默丢弃。

## 测试

- Host：技能核心校验拒绝非对象、未知语言与空值的本地化映射，并通过 `list()`/`get()` 携带映射；文件系统解析器从 frontmatter 读取 `description.zh`/`description.ru`；apiproxy 的 schema 与投影透传映射；`dsh-badge` 发布该映射。
- 客户端：ui-skill 候选断言不区分大小写的子串过滤（中段与大小写变体匹配、无匹配为空）、按当前语言选择描述并回退原始描述，以及本地化描述上的仅用户前缀。
