# Agent Note: WIP 评审修复——文件面板、项目文件安全、技能管理器、编排器

Status: implemented

[English](2026-09-03-wip-review-fixes-file-panel-project-files-skills-orchestrator.md) | 中文

## Problem

WIP 评审（REVIEW-FINDINGS.md）发现工作层只组装了一半：工作区文件面板渲染了绝对 Windows 路径并吞掉列表失败，Chromium 拖放失效，写入可能顺着符号链接逃出项目，客户端可把读上限抬到服务端边界之上；技能管理器把每个既有技能保存都先弹手动冲突步骤，并在版本操作失败时仍显示成功，而扁平 `*.md` 的删除会把整个技能根目录拖进回收站；编排器让被委托的子级继承 head 提示词与 `executor` 工具，同时对外展示从未生效的 head 模型字段。

## Decision

- **工作区文件面板（`ui-files`）** —— 树行对 POSIX 与 Windows 路径都渲染基名（`baseNameOf`）；行携带 VSCode 风格字形（带打开状态的琥珀色文件夹、常见源码/配置文件类型的首字母徽标、其余用中性页面图标），颜色放在 CSS module 中；隐藏条目视觉弱化；`listChildren` 失败以内联行显示并带重试，而非空文件夹；`dragover` 只检查 `dataTransfer.types`（Chromium 在 `drop` 前 `getData` 为空）；drop 时给草稿 `File` 盖上 `COMPOSER_FILE_SOURCE_PATH`，使 `session.prompt` 引用原始项目路径而不是复制到 `.dsh/attachments/` 下（项目外的 `path` 被忽略并按复制物化）；Markdown 对话框在保存于关闭后落定时不能再自行复活。
- **项目文件安全（`apiproxy`）** —— `canonicalProjectPath` 现在对每次操作都 realpath 并对已存在的最终组成部分做包含检查，写操作永远不会顺着符号链接逃出项目；`readProjectTextFile` 在缓冲前用 `stat` 做大小检查；两个文本动词都把调用方提供的 `maxBytes` 钳制到服务端边界，客户端无法抬高上限。
- **技能管理器** —— 编辑器对既有技能首次点击即以 `replace: true` 保存（管理器把先前正文快照为版本）；版本激活/回滚在展示后重新抛出，对话框不再在失败时显示成功；对扁平 `*.md` 技能（其目录即技能根）的 `remove()` 只回收该文件；扁平 markdown 的回收条目使用公开（frontmatter）名且不带 `.md`，`restore()` 以原磁盘名放回文件，使发现层能再次看到；`save`/`publishVersion` 拒绝 frontmatter 名与被管理名不一致的正文（改名 = 删除后重建）；内置 `skill-create` 注册对异步加载落定前发生的 teardown 做了防护；内置卡片不渲染 Enable/Versions/Benchmark 生命周期操作。
- **编排器** —— head 提示词区块对委托代理（`delegationDepthOf > 0`）渲染为空，`executor` 工具拒绝在顶层以下执行，生成的 executor 子级在 provider 可支持时被限定范围：`toolFilter.deny: ['executor']`、`maxDepth: 1` 和紧凑的 worker 人设——递归在所有路径上都有界。对外宣传但实际惰性的 head 路由字段已从 schema、编解码器、UI 与提示词中移除：head 就是会话的实时聊天模型；模块 JSDoc、运行时错误文案和卡片都指向 Settings → Models →「Оркестратор」，executor 调用以 `kind: 'execute'` 呈现，工具是串行的（`isConcurrencySafe: false`），重叠的 executor 运行不会在共享文件上竞争。该模式只会在 provider+model 路由完整时挂载运行——不再保留厂商默认值，UI 表单在没有路由时拒绝启用。全部注册集中在一个带 disposer 的 `ctx.effect`（settings watcher、工具、提示词区块）中，summarizer 的预算拒绝现在总是关闭被遗弃的迭代器，而不是依赖 oxlint 证明为死代码的标志。

## Alternatives considered

- **把 head 路由应用到会话模型。** 不予采纳：composer 选择器拥有实时模型；伪造第二个所有者会与既有选择机制冲突。移除字段让契约诚实。
- **把冲突面板留在 `skill-conflict` catch 后面。** 不予采纳：启用 `replace: true` 后，管理器对就地编辑不再抛出该错误码，面板成为死 UI。
- **按客户端上限读取超大文件。** 不予采纳：25 MiB 边界是准入上限；客户端只能降低它。

## Consequences

文件面板、项目文件动词、技能管理器流程与编排器现在与其 README 和 UI 文案一致；被委托代理不能充当 head，也不能经由 `executor` 递归；扁平 `.md` 技能回收与恢复不会移动同级技能。相关已上线笔记：技能生命周期（[feature/2026-08-31-skill-manager-and-benchmark.md](2026-08-31-skill-manager-and-benchmark.md)）与基准评测任务隔离（[bug-fix/2026-08-31-benchmark-loud-llm-failures.md](../bug-fix/2026-08-31-benchmark-loud-llm-failures.md)）描述了本笔记调整的管理器；编排器与文件面板包在本 WIP 层是新增的，不取代任何现有内容。

## Testing

- `ui-files`：测试包括 Windows/POSIX 基名、图标字形变体、列表失败重试、隐藏行、Chromium 安全 dragover/drop（盖戳项目路径）、关闭后保存。
- `skill-manager` + `ui-settings-skills`：208 个测试，包括扁平 `.md` 回收不移动根、首次保存即替换、激活/回滚失败内联展示；改动文件 lint 干净。
- `orchestrator`：新的组合 spec（8 个测试），覆盖设置项上的挂载/卸载、fiber teardown、按深度抑制 head 区块、按 provider 能力限定子级、仅 head 拒绝、按停止原因的部分输出错误。
- `apiproxy` 项目文件：12 个测试，包括穿越符号链接写入拒绝与上限钳制。
- `compaction-basic` + `ui-skill`：lint 修复后 163 个测试通过；所有受影响包 typecheck 干净。
- Host tsdown：`tsdown.config.ts` 的 workspace exclude 重申 tsdown 默认值并外加 `**/graphify-out/**`，使 `packages/graphify-out/` 下的 `graphify update packages` 缓存不会被当作 workspace 包。
- 客户端 bundle：`ui-files` 在本地盖戳 `COMPOSER_FILE_SOURCE_PATH`（`dshSourcePath`），而不是值导入 `ui-conversation/client`（纯净门禁会拒绝后者）。
