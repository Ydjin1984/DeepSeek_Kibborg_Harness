# Agent Note: 执行列表为 overlay composer 预留高度

Status: implemented

[English](2026-08-30-execution-list-clears-overlay-composer.md) | 中文

## 问题

执行标签页选用 composer-overlay 座位：composer 座位相对滚动主体的底边绝对定位，而执行视图占满整列，因此事件列表的滚动视口延伸到座位之下。座位在视口底部绘制不透明的输入卡片外加 36px 淡出带（Chat 输入遮罩），于是最新的 trace 事件——follow-scroll 固定住的那条尾部——会滚进 composer 之下，整个运行过程无法看到结尾。跳至最新胶囊按滚动视口底部 sticky，而那里正好被座位盖住，因此该胶囊在本标签页不可达。

## 决策

执行列表把 overlay composer 的实时高度预留为底部 padding：列表滚动视口上写 `padding-bottom: calc(var(--dsh-composer-height, 152px) + 16px)`，跳至最新胶囊的 sticky bottom 用同一个变量避开座位。ConversationRoot 已把座位的实时高度以 `--dsh-composer-height` 发布在滚动容器上（seat observer），因此预留会跟随草稿增高；152px 回退值覆盖 observer 触发前的首次绘制。trace 尾部因此恰好停在 composer 座位上方、完全可见，淡出带只覆盖预留出的空白条。该模式镜像 trajectory 视图的底部预留（[trajectory 检查台账](../feature/2026-07-27-trajectory-inspection-ledger.md)）；overlay 座位的横向几何仍归[宽度补偿 note](../bug-fix/2026-08-12-composer-overlay-seat-width-compensation.md) 所有。

## 备选方案

**为 overlay 视图移除输入遮罩淡出。** 只删掉淡出带仍会让最后几行留在不透明输入卡片后面，尾部依然被遮挡。已拒绝。

**在共享 overlay 分支预留**（ConversationRoot 中的 `.scrollBody:has([data-conversation-composer-overlay])` 级联）。共享预留同样会给已自带预留的 trajectory 视图加 padding，把间隙翻倍。视图内预留让每个 overlay 视图的预留跟着需要它的视图走。

## 后果

- 执行标签页在 composer 上方显示完整 trace 尾部；follow-scroll 保持最新事件可见。
- 跳至最新胶囊在执行标签页可达，不再卡在座位后面。
- 预留跟随 `--dsh-composer-height`，因此更高的 composer（草稿增长、dock 卡片）保持同样的 16px 间隙；淡出带不可见，因为没有内容再滚到它下面。
- Chat 的输入遮罩淡出不变：Chat 自己的滚动视口模型按设计让遮罩盖住滚动内容。

## 测试

本次改动只是执行视图中的展示层 CSS；ui-conversation 客户端 bundle 可干净重建，实时 `/plugins/@deepseek-ai/dsh-client-ui-conversation/client.js` 路由已对外提供新的预留样式，刷新页面即可看到。涉及文件的文档门禁通过（翻译配对、Agent Note 格式、md wrap/links）。`pnpm run test:gui` 除一个既有进行中的失败外全部通过——`ui-settings-models/tests/provider-form.client.spec.tsx`（SuperGrok OAuth 卡片），该失败先于本次改动存在、与本改动无关；执行视图相关套件全部绿灯。
