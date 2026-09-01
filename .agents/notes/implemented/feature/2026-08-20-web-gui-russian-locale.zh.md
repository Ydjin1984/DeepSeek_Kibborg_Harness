# Agent Note: Web GUI Russian locale

Status: implemented

[English](2026-08-20-web-gui-russian-locale.md) | 中文

## Problem

浏览器客户端只提供 `zh` 和 `en`。想使用俄文界面的用户在语言选择器中没有对应项；`ru-*` 浏览器会落到英文，因为俄语不是已交付的 locale。产品文案已经按命名空间放在词典里；新增一种语言是第三份词典加上一个 `LocaleId`，而不是另一套 i18n 栈。

## Decision

`ru` 是与 `zh`、`en` 并列的已交付 `LocaleId`。Language 行以 `Русский` 列出它。浏览器检测按 `ru` 主子标签匹配（`ru-RU` → `ru`）。该 locale 的 `<html lang>` 为 `ru`。Host settings schema 接受 `preference: ru`。类型化 `register(ns, dicts)` 要求为每一种已交付 locale 提供词典，词典对称性门禁比较 `zh`／`en`／`ru` 的 key 集合，因此缺失的俄文字符串不能以裸 key 的形式交付。

回退仍是英文：浏览器未点名任何已交付语言时仍打开 `en`；当前 locale 缺 key 时仍读取 `en` 词典。贡献者文档保持英／中配对；这次改动是产品 GUI locale，不是文档配对约定。

每个客户端词典所有者注册 `{ zh, en, ru }`（`permission.access` 与浏览目录选择器使用三参数形式）。Welcome notice 文案有 `ru` 成员，由 models 设置词典消费。

## Alternatives considered

- **只在设置外壳提供俄语** — Language 行会切换 `<html lang>`，其余 GUI 仍是英文或中文；选择器与界面不一致。
- **把俄语当作文档配对语言** — 贡献者 Markdown 配对是带 sidecar 与 merge driver 的英／中双语约定；把第三种文档语言并入该门禁，与让 GUI 切换语言不是同一件事。

## Consequences

存储的 `locale.preference: ru` 与 `zh`、`en` 一样持久化在 `$DSH_HOME/settings.yaml`。再增加第四种 GUI 语言重复这一模式：扩展 `LOCALE_IDS`、补词典、并让对称性门禁的已交付 locale 列表同步。注册时捕获的文案（只注册一次的命令描述）在重新注册前仍不跟随实时切换。不依赖 Cordis 的原语（SearchBlock、ReadBlock、DiffBlock、WebBlock、TerminalBlock）通过 `labels` 接收文案；会话工具行把当前 locale 传入这些 props，因此切换语言会到达这些卡片。

## Testing

`scripts/locale-dictionary-parity.spec.ts` 要求 `zh`／`en`／`ru` 的 key 完全一致。`packages/client/locale` 规格覆盖选择器成员、`ru-RU` 检测、Host schema 接受，以及 `<html lang>="ru"`。`apps/web/tests/settings-chrome.e2e.ts` 用 `ru-RU` 浏览器打开俄文设置对话框，并钉住 `dialog-ru.expected.md`。
