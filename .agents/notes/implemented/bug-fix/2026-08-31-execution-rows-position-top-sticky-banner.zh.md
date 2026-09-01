# Agent Note: 执行时间线行用 `top` 定位而非 `transform`，代码块粘性横幅保持在块顶部

Status: implemented

[English](2026-08-31-execution-rows-position-top-sticky-banner.md) | 中文

## 问题

执行时间线的展开内容通过共享的 `CodeBlock` 渲染所有代码面（markdown fence、详情面板的原始参数／输出），其复制横幅为 `position: sticky; top: 0`，以便阅读长 fence 时按钮保持可达。在聊天视图中横幅能正确钉在滚动视口顶部；在执行视图中则不能。虚拟列表用 `transform: translateY(offset)` 定位每一行绝对定位的节点，而在 Chromium 中，带变换的祖先会成为粘性元素的滚动上下文——该上下文并不会滚动。于是横幅被推送到其包含块的底部：复制按钮渲染在代码块底部，且横幅的不透明填充（`--dsw-alias-bg-base`，`z-index: 6`）遮住了块的最后一行（几行），代码的下半部分因此看起来被截断。

## 决策

执行视图改用 `top` 属性而非 `transform: translateY()` 定位每一行：`rowSlot` 保留 `position: absolute; left: 0; right: 0`，用 `style={{ top: layout.offsets[index] ?? 0 }}` 取代变换。行内容到列表滚动视口的路径上不再有变换创建包含块，因此 `CodeBlock` 的粘性横幅会像在聊天视图中一样钉在 `data-testid="execution-list"` 滚动视口上。虚拟窗口、测量、follow-scroll 与跳至最新均不变——它们读取的是 `layout.offsets` 与测量高度，而非定位机制。

## 备选方案

**在执行行内禁用代码横幅的粘性。** 退出粘性横幅可以保留变换带来的合成滚动，但复制按钮会在任何高于滚动视口的 fence 上滚出视野，与用户要求对齐的聊天视图相悖。已否决。

**保留变换并用 CSS 修复粘性。** 在带变换的祖先下，`position: sticky` 在 Chromium 中是损坏的；没有任何作者样式规则能恢复它。已否决。

## 后果

- 执行视图的代码块复制横幅位于块的顶部，并在滚动时钉在列表顶部，与聊天视图一致。
- 横幅不再盖住块的最后几行，代码正文保持完整可读。
- 行定位改为在滚动时触发布局而非仅靠合成器平移；已挂载窗口（可见范围加 overscan）很小，开销可忽略。

## 测试

聚焦套件保持绿色：`execution-view`、`execution-virtual`、`execution-event` 与 `execution-filter`（35 个测试），以及完整 `ui-conversation` 包（33 个文件，497 个测试）。对运行中的 `dsh web` 服务器的实时浏览器探针确认了行为修复：块对齐列表顶部时横幅位于块顶部（`bannerAtTop: true`）；块滚过列表顶部 150px 时横幅钉在列表顶部（`bannerTopVsList: 0`，可见）——修复前横幅钉在块的底部。
