# Agent Note: 执行视图的 follow-scroll 在高度增长时仍钉在底部

Status: implemented

[English](2026-08-30-execution-follow-scroll-pins-to-floor.md) | 中文

## 问题

执行视图的 follow-scroll 只在可见行数变化（`visibleKeys.length`）时才重新滚动。新行先以 36px 估算值挂载，follow 落到那个底部；随后该行的实测高度落地（或在原地增长），把底部再往下推，却没有再次 follow——因此钉在底部的读者会在下一次事件到来前丢失 trace 尾部。钉住/解除的归属（向上滚动即解除，滚到底部即重新钉住）原本就已存在且正确。

## 决策

follow 效果现在依赖整个流的高度与滚动视口高度——`[visibleKeys.length, layout.total, viewport]`——因此只要读者处于钉住状态，流一旦增长就会重新滚到底部：无论是新行、实测高度落地、行内原地增长，还是滚动视口尺寸变化。`layout.total` 与 `viewport` 都是已在跟踪的状态（实测高度与滚动视口的 ResizeObserver），因此没有新增机制。钉住/解除的归属不变：离开底部超过 24px 阈值即解除，滚回底部即重新钉住。follow 重滚到与[composer 预留修复](../bug-fix/2026-08-30-execution-list-clears-overlay-composer.md)相同的预留底部，尾部停在 composer 正上方。

## 备选方案

**像 ChatView 那样用 ResizeObserver 观察滚动视口。** ChatView 通过 observer 在列尺寸变化时重新 follow；执行视图已把同样的事实作为 state 跟踪（由实测高度得出的 `layout.total`、`viewport`），再引入 observer 只是重复机制。已拒绝。

**只在新行到来时 follow（原行为）。** 效果安静，但留下本次改动要解决的漂移。已拒绝。

## 后果

- 钉在底部的读者始终看得到 trace 尾部；follow-scroll 能扛住较高的实测行与事件间隙中的原地增长。
- 向上滚动仍解除钉住，滚回底部仍重新钉住；跳至最新胶囊仍是显式的重新钉住入口。
- 效果触发更频繁（钉住期间每次流尺寸或视口变化），但每次只是一次廉价的 `scrollTop` 写入，值不变时 React 会跳过。

## 测试

`execution-view.client.spec.tsx` 新增的 jsdom 组件测试用模拟的滚动视口驱动：钉住 + 新事件 → 滚到底部；向上滚动 + 新事件 → 保持不动；滚回底部 + 新事件 → 再次滚动；钉住时行内实测增长 → 重新滚到底部。该文件可独立通过（`pnpm vitest run packages/client/ui-conversation/tests/execution-view.client.spec.tsx`，11 个测试）。组装后的 GUI 通过 `/plugins/<id>/client.js` 路由对外提供重建的 bundle；完整 `test:gui` 套件的状态由 [composer 预留 note](../bug-fix/2026-08-30-execution-list-clears-overlay-composer.md) 中记录的进行中重构决定。
