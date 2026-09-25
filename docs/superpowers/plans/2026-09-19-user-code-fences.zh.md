# 用户代码围栏实现计划

[English](2026-09-19-user-code-fences.md) | 中文

> **面向 agentic worker：** 必需 sub-skill：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现本计划。步骤使用 checkbox（`- [ ]`）语法跟踪。

**目标：** 让三个反引号成为在草稿与已发送用户消息中突出代码的清晰视觉方式，同时为模型保留精确的原始文本。

**架构：** 一个纯 parser 标记 fenced code 范围，输入 trigger 检测、textarea 装饰与消息渲染共用它。composer 保留原生 textarea 及其唯一的滚动容器；用户气泡通过现有 reference chip 输出普通文本，并通过现有 CodeBlock 输出代码段。只改变 UI 解释规则与 trigger policy，不改变 session log 格式。

**技术栈：** TypeScript、React、CSS modules、现有 `ui-input-trigger` 与 `ui-primitives/CodeBlock`、Vitest、Testing Library、keyless web 快照。

**规格：** [活动流与用户代码](../specs/2026-09-19-conversation-activity-design.md)。相邻的独立计划：[Conversation Feed and Bottom Follow](2026-09-19-conversation-feed-and-follow.md)。

## 全局约束

- 草稿文本、已发送消息与模型输入逐字节保留键入的字符；rendering 不重写 logged content。
- Parser 支持多个块、可选语言、未闭合块、CRLF 以及前后文本；fence 只在独立一行上识别，该行有 0–3 个前导空格且至少三个反引号。闭合行的反引号不少于开启行，其后只有空格。
- 在 composer 中，装饰不改变 font metrics、caret、selection、IME、paste、undo/redo、自动换行、高度与 wheel chaining。
- 在 fenced block 内部，`@` 与 `/` 字符保持字面代码：不出现 popup、命令、inline reference 与 chip。已被 fence 包裹的现有结构化引用会变为普通字面文本，不带隐藏的 reference payload。
- 未知语言与没有语言都显示普通代码且不报错；用户 HTML 保持为文本。
- 代码与文档在同一次变更中随配对 README、JSDoc、Agent Note 与 keyless 快照一起更新。
- 修改 packages 之前，先阅读[架构](../../architecture.md)、[防御性模式](../../defensive-patterns.md)、[packages 说明](../../../packages/AGENTS.md)与本地 graphify。

---

## 文件与职责地图

| 领域 | 负责方 | 变更 |
|---|---|---|
| 统一的 parser | 新增 `packages/client/ui-input-trigger/src/core/fenced-code.ts`；[trigger detector](../../../packages/client/ui-input-trigger/src/core/detect.ts)；[client entry](../../../packages/client/ui-input-trigger/src/client/index.ts) | 范围、caret 活跃位置、在代码内部抑制 trigger。 |
| 草稿 | [decorations.ts](../../../packages/client/ui-conversation/src/client/contract/decorations.ts)、[InputBar.tsx](../../../packages/client/ui-conversation/src/client/skeleton/InputBar.tsx)、`InputBar.module.css`、[input machine](../../../packages/client/ui-conversation/src/client/input/machine.ts) | fence/code 的样式、与 chip 的交叉、文本保留。 |
| 已发送气泡 | [MessageItem.tsx](../../../packages/client/ui-conversation/src/client/chat/MessageItem.tsx)、`MessageItem.module.css`、[CodeBlock.tsx](../../../packages/client/ui-primitives/src/markdown/CodeBlock.tsx) | 普通文本段与 code card、精确内容的复制。 |
| 检查 | [trigger tests](../../../packages/client/ui-input-trigger/tests/core-detect.client.spec.ts)、[input tests](../../../packages/client/ui-conversation/tests/input-bar.client.spec.tsx)、[chat tests](../../../packages/client/ui-conversation/tests/chat-view.client.spec.tsx)、[markdown tests](../../../packages/client/ui-primitives/tests/markdown.client.spec.tsx)、[web snapshots](../../../apps/web/tests/snapshots/) | Parser、编辑器、气泡、组装后的应用。 |

### 任务 1：单趟解析 fenced code

**文件：** 新增 `packages/client/ui-input-trigger/src/core/fenced-code.ts`；修改[client entry](../../../packages/client/ui-input-trigger/src/client/index.ts)；测试新增的 `fenced-code.client.spec.ts`。

**接口：** `FencedSegment = { kind: 'text'; start: number; end: number } | { kind: 'code'; fenceStart: number; contentStart: number; contentEnd: number; fenceEnd: number; lang: string | null; closed: boolean }`；`scanFencedSegments(text: string): readonly FencedSegment[]`；`isFencedCodeOffset(text: string, offset: number): boolean`。所有 offset 都以 UTF-16 单位引用源字符串，与 textarea selection 和 occurrence range 一致。

- [ ] 为普通文本、单个与多个块、`ts` 与未知语言、CRLF、前导空格、未闭合块、过长的开启行、代码行内部的三个反引号，以及块之前的 Unicode 编写红灯测试（实现前必然失败的测试）。
- [ ] 运行 `pnpm exec vitest run packages/client/ui-input-trigger/tests/fenced-code.client.spec.ts`；测试因缺少 parser 而失败。
- [ ] 实现线性逐行解析，不做 HTML/Markdown 解释，也不在每一步复制块内容；返回覆盖源字符串且互不重叠的范围。
- [ ] 重跑测试并确认 100,000 字符的草稿上没有平方级遍历；把 benchmark 结果保存在 fixture 旁边。

### 任务 2：在代码内部关闭 trigger 与结构化引用

**文件：** 修改[trigger detector](../../../packages/client/ui-input-trigger/src/core/detect.ts)、[decorations.ts](../../../packages/client/ui-conversation/src/client/contract/decorations.ts)、[input machine](../../../packages/client/ui-conversation/src/client/input/machine.ts)，并在需要时修改[controller](../../../packages/client/ui-input-trigger/src/client/controller.ts)；测试[trigger tests](../../../packages/client/ui-input-trigger/tests/core-detect.client.spec.ts)、[input machine tests](../../../packages/client/ui-conversation/tests/input-machine.client.spec.ts)、[reference submit tests](../../../packages/client/ui-conversation/tests/input-reference-submit.client.spec.ts)。

**接口：** 当 caret 位于 code content 内部时，`detectTrigger(draft, caret, guard)` 返回 null；`scanTextRefs` 与 `deriveDecorations` 不产生与 code content 相交的范围；被用户用 fence 包裹的 occurrence 在发送时不再携带 structured reference，并在 draft 中留下字面字符。

- [ ] 增加红灯测试：在 fenced block 内部键入 `@file` 与 `/goal` 不打开菜单；同样的 token 在外面正常工作；闭合 fence 后重新启用普通行为。
- [ ] 为已插入、随后被用户用 fence 包裹的 file/session chip 增加红灯测试：可见文本留在代码中，引用的 payload 不被发送。
- [ ] 把统一 parser 接入 detector 与 decoration scan；检查 caret 位于开启行／闭合行以及块边界附近的情形。
- [ ] 通过现有的 reconcile 操作在 draft 变化时归一化 occurrence，而不是在发送时单独改写文本；undo 恢复预期状态。
- [ ] 运行 trigger、input machine 与 reference submit 的窄范围测试，包括 IME 与含多个块的 paste。

### 任务 3：在不移动 caret 的前提下装饰输入框中的代码

**文件：** 修改[InputBar.tsx](../../../packages/client/ui-conversation/src/client/skeleton/InputBar.tsx)、`InputBar.module.css`、[decorations.ts](../../../packages/client/ui-conversation/src/client/contract/decorations.ts)；测试[input bar tests](../../../packages/client/ui-conversation/tests/input-bar.client.spec.tsx)、[input scenarios](../../../packages/client/ui-conversation/tests/input-scenarios.client.spec.tsx)、[Safari tests](../../../packages/client/ui-conversation/tests/safari.client.spec.ts)。

**接口：** 现有的 `backdrop`、`textarea` 与 `mirror` 继续共处同一个滚动容器。装饰使用 parser 的 offset 段，每个范围产出一个 text/span，不为每个字符单独建 DOM 节点。

- [ ] 为开启行／闭合行的高亮、code content 背景、未闭合块与两对 fence 增加测试；确认 `textarea.value`、selectionStart/End 与已发送的 draft 保持原样。
- [ ] 按源 offset 把 fence/code 范围与现有 claim/chip/text-ref range 合并；代码内部的范围总是优先于装饰性引用。
- [ ] 把 CSS 限制为颜色、背景与 outline/box-shadow，不改变 padding、border、font 或 line-height，使 backdrop 与 textarea 保持相同的 glyph metrics。
- [ ] 用浏览器检查长行换行、14 行上限、在 composer 上方滚动滚轮、IME、paste、undo/redo、disabled state 与窄屏。
- [ ] 运行上述测试；出现 glyph／caret 偏差时不要为两个滚动容器添加 JS 同步——修正图层度量。

### 任务 4：已发送用户消息中的 code card

**文件：** 修改[MessageItem.tsx](../../../packages/client/ui-conversation/src/client/chat/MessageItem.tsx)、`MessageItem.module.css`、[CodeBlock.tsx](../../../packages/client/ui-primitives/src/markdown/CodeBlock.tsx)；测试新增的 `user-fences.client.spec.tsx`、[CodeBlock/markdown tests](../../../packages/client/ui-primitives/tests/markdown.client.spec.tsx)、[chat tests](../../../packages/client/ui-conversation/tests/chat-view.client.spec.tsx)。

**接口：** `projectUserText` 接受 parser 的段；text 段走现有的引用装饰，code 段走 `CodeBlock`。需要时新增默认 false 的 `CodeBlock.preserveTrailingNewline?: boolean`；为 true 时复制取精确的 `code`，而不是被裁剪的 DOM text。

- [ ] 增加红灯测试：代码前后的文本、多张 code card、语言、未知语言、代码内部的 backtick 与 HTML、代码内部的 `@` 不产生 ref chip、被保留的结尾换行、正确的复制结果。
- [ ] 在 `projectUserText` 处理之前切分 text/code；只用 text 段、按源 offset 与真实 reference label 构建引用 chip。
- [ ] 复用现有的 `CodeBlock` 处理语言、高亮与 copy；仅通过显式 prop 改变其 trailing-newline policy，使其他消费方保持原有行为。
- [ ] 确认普通 user message、待处理的 steering 气泡与 reload 之后的消息具有相同装饰；任何用户 HTML 都不会作为标记进入 DOM。
- [ ] 运行上述测试并在浏览器中查看 50 行的示例。

### 任务 5：组装后的快照、文档与最终检查

**文件：** 在[web snapshots](../../../apps/web/tests/snapshots/) 下新增或更新可运行用例；修改[ui-conversation README](../../../packages/client/ui-conversation/README.md) 及其 `README.zh.md`/`README.i18n.yaml` 配对、[ui-input-trigger README](../../../packages/client/ui-input-trigger/README.md) 及其配对，并在 API 变化时修改[ui-primitives README](../../../packages/client/ui-primitives/README.md) 及其配对；在 `.agents/notes/implemented/feature/` 中创建 Agent Note。

**接口：** 面向模型的原始用户文本与键入的文本一致，包括 fence 与空格；UI 快照展示组装后的应用中普通文本与 code card 的差异。

- [ ] 创建可运行用例 `apps/web/tests/user-code-fences.snapshot.ts`，其中测试 `user fenced code`：请求包含普通文本、fenced code 与代码内部的 `@`；在不用 mock-only fixture 的前提下检查 log／model input 与项目 DOM。
- [ ] 检查无障碍：language label、复制按钮、键盘焦点、浅色／深色主题、reduced motion 与移动端宽度。
- [ ] 更新公开 JSDoc、README 配对与 Agent Note；执行本地 graphify update packages。
- [ ] 运行受影响的 Vitest 测试、`pnpm run test:snapshot -t "user fenced code"`、`pnpm run typecheck`、`pnpm run doc-sync`、`git diff --check`；只列出实际执行过的检查。
- [ ] 将规格的验收标准与测试和快照对照，并把 browser／caret 检查的结果写入最终报告。

## 对齐确认

- [ ] composer 与已发送消息中的 fenced code 风格已对齐。
- [ ] 代码内部引用与命令的字面行为已对齐。
- [ ] 实现从本计划对齐之后开始；当前文档描述的是后续任务。
