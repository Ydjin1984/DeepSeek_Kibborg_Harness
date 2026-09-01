# Agent Note: 本地化的命令菜单与插件启用控制

Status: implemented

[English](2026-08-30-web-command-menu-localization-and-plugin-toggle.md) | 中文

## 问题

Web GUI 的本地化测试暴露出两个缺口。编辑器里的「+」按钮打开共享斜杠菜单并只筛选命令候选，而每一行都渲染 Host 目录的原始英文名称与描述——任何语言下都是 `goal`、`compact`、`permission` 等等。此外，插件设置列表（`pluginInventory/list` 投影）把条目标为「已启用 / 已停用」，却没有办法改变该状态；因此由组合配置停用的部署行（例如 web bundle 的 `hmr` 行，或某个平台专属的 shell 工具）根本无法从浏览器重新启用。

## 决策

**命令菜单本地化展示文案，而原始名称仍作为线上的键。** `InputTriggerCandidate` 新增可选 `label`——菜单用它替代 `name` 展示；模糊匹配与选择分发仍然读取 `name`，所以输入 `/goal` 依旧能匹配并执行，而行内显示 `目标`/`Цель`。文案由 `ui-commands` 统一负责：`command` 命名空间词典为已发布的命令（`goal`、`plan`、`compact`、`feedback`、`export`、`permission`、`model`）增加 `menu.<name>` 与 `menu.<name>.description` 键，并在 `candidates()` 中对 Host 目录行与客户端贡献统一应用。英文词典与 Host 字符串逐字一致，因此英文 golden 永不漂移。未知命令保留原始文案（成员判定依据词典键集，而非回退查找）。`model` 贡献自己的 `command.description` 键被移除：菜单行只有一个事实来源，注册时的原始英文描述仍作为回退。

**插件清单通过新的 Host Remote 切换条目。** `pluginInventory/setEnabled(entryId, enabled)` 解析 Loader 条目，通过 `Entry.update` + `tree.write()` 写入其自身的 `disabled` 选项（立即生效，基于文件的树持久化），并返回最新快照。group 行与引导 `cordis:include` 会被拒绝。插件列表卡片为每一行增加「启用/停用」操作：RPC 进行中显示忙碌，一次切换期间所有开关都被锁定，成功后直接采用返回的快照，失败则以本地化提示行呈现且不回滚列表。

## 备选方案

- **直接翻译候选的 `name`。** 否决：`name` 既是模糊匹配键，也是选择分发键（`pick.candidate.name` 用于解析贡献或目录行），替换它会同时破坏输入 `/goal` 与执行选择。展示用 `label` 把两个关注点分开。
- **让 Host 的命令描述符感知语言。** 否决：命令注册表是模型可见的且不感知语言，所有注册点都要改。展示文案由客户端负责，与 GUI 其余部分一致。
- **保持清单只读，并把配置文件作为唯一修改途径。** 否决：该报告恰恰指出停用行无法操作，而 Loader 已提供设置页需要的 `Entry.update` 接缝。

## 影响

俄语或中文会话会看到完全本地化的命令菜单（名称与描述），而 `/goal` 这类调用仍是英文；插件列表可以启用或停用任何非 group、非 include 条目，变更立即生效，并在可写的配置文件上持久化。只读配置文件仍会应用运行时变更，但下一次启动保留旧值——这是既有 Include 行为，已在包 README 中说明。settings-chrome golden 的每个清单卡片新增一个「停用」按钮；英文命令菜单 golden 逐字节不变。

## 测试

- Host：`PluginInventoryGateway` 单元测试覆盖两个 Remote 方法、一次 setEnabled 往返（停用 + 重新启用并带 fiber 阶段）、以及 group/include 拒绝。
- 客户端：ui-commands 候选测试断言已知命令的本地化名称/描述与未知命令的原始回退；menu-view 规范验证 `label` 替代 `name` 渲染；清单组件规范覆盖切换成功（快照采用）、忙碌锁定与失败提示，browser-plugin 规范覆盖 `setEnabled` Remote 路由。
- 组装件：对 settings-chrome 场景执行 `DSH_SNAPSHOT=refresh` 只重写了 `plugins.expected.md`；命令菜单场景按其已提交 golden 回放通过。
