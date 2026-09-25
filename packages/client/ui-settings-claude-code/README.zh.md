# @deepseek-ai/dsh-client-ui-settings-claude-code

[English](README.md) | 中文

Claude Code 技术设置分区：管理由 ECC 衍生的 skill 库（从 [affaan-m/ECC](https://github.com/affaan-m/ECC) 转换而来的 `.dsh/skills` 下 `cc-*` 与 `cc-role-*` skill，即 Everything Claude Code v2.2.1）。

该分区通过 skill-manager RPC 域（`skills.listManaged` / `skills.setEnabled`，每个 skill 一次调用）启用与停用库中的 skill，并说明聊天中的调用方式。启用一个 skill 会移除它的 `.disabled` 标记；随后 skill-filesystem watcher 在下一个轮次把它发布到 agent（智能体）的 skill 目录，模型即可按名称加载它。

## 设置分区

注册到 `settings.section` slot：

| 字段 | 值 |
| --- | --- |
| id | `claude-code` |
| order | 18 |
| locale namespace | `settings.claudeCode` |

控件：

- Recommended set（启用）、Enable all、Disable all——在生成的 `groups.data.ts` 名称列表上批量顺序调用 `setEnabled`；批量开关绝不触碰总括 skill。
- 每个类别一行（TDD & testing、review、security、agentic 等），带一个反映已启用成员数量的三态复选框。

## 生成的数据

`src/client/groups.data.ts`（类别、推荐集合）由 `.planning/phases/claude-code/gen-groups.mjs` 从磁盘上的库生成：要改就改生成器，而不是数据文件。库本身由 `.planning/phases/claude-code/convert-ecc.mjs` 从 ECC 克隆生成。

## 模型体验

无。设置界面只开关库中的 skill；这些 skill 产生的模型可见目录条目由 skill-manager 服务持有。

#### KV Cache 影响

无；该包既不组装也不发送提供方请求。

## 已知限制与暂缓事项

- 类别归属是按 skill 名称做的关键词启发式判断；小众 skill 可能落进「Everything else」。要精确到单个 skill 的开关，请使用 Skills Manager 分区。
- 批量开关对每个 skill 都是一次 `setEnabled` RPC（没有批量 API）；启用全部约 355 个 skill 需要数秒的顺序调用。
- 转换后的 skill 只携带其 `SKILL.md` 正文：正文引用伴随文件（`references/`、`examples/`、`scripts/`）的 ECC skill 会失去这些资源，只能依靠其内联说明工作。
- 发现过程在每个 agent 步骤都会重新解析库中每个 `SKILL.md`：在约 355 个被停用成员的情况下，目录扫描花费数十毫秒；只启用你用到的类别，或从本分区停用整个库。
