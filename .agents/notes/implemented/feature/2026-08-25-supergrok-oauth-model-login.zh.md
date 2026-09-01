# Agent Note: SuperGrok OAuth 模型登录

Status: implemented

[English](2026-08-25-supergrok-oauth-model-login.md) | 中文

## Problem

xAI 的 catalog 路由已经能选，但 Models 页只能存按量计费的 API 密钥。已经付 SuperGrok 或 X Premium 的用户无法用那份额度当会话模型。读取 Grok CLI 的 `~/.grok/auth.json` 会与另一个产品共享 refresh token，并在刷新时把它踢下线。把 `grok agent stdio` 当会话 agent 则会用 Grok Build 自己的工具替换 Harness 工具。

## Decision

会话仍走 Harness agent loop 和 Harness 工具。xAI 只提供模型。pi-ai catalog 中带 OAuth 方法的路由（xAI：Sign in with SuperGrok or X Premium）在 Models 卡片上提供设备码登录。由 Host 访问 `auth.x.ai`；浏览器显示用户码并打开验证 URL。令牌以 JSON 存在凭据缝的 `<ROUTE>_OAUTH`（xai 为 `XAI_OAUTH`），按请求刷新。登录从不读写 `~/.grok/auth.json`。

已命名的 `apiKeyEnv` 仍然优先。没有密钥引用的 profile 先尝试已存 OAuth access token，再回退到 pi-ai 环境发现。登录成功会写入空的 `providers.<route>` profile 以便注册路由。退出登录清除 OAuth 凭据，保留该行。

`openai-codex` 仍不进入休眠目录：它只有 OAuth，且本适配器仍没有 Codex token 刷新。

## Alternatives considered

**复用 Grok CLI 的 `~/.grok/auth.json`。** 拒绝，因为刷新会轮换 token，并把 CLI 签退。

**把 `grok agent stdio` 当 ACP 会话 agent。** 此次拒绝，因为可见编辑器必须保留 Harness 工具（读写/bash 卡片、沙箱、权限）。ACP 会跑 Grok Build 的工具集。

**浏览器直接打设备码。** 拒绝，因为 `auth.x.ai` 不对 Web 源开放 CORS；必须由 Host 跑该流程。

## Consequences

设置 → 模型 → 添加提供方 → xai → Sign in with SuperGrok or X Premium 即可使用 catalog 模型（已安装 pi-ai catalog 中的 `grok-4.5`、`grok-4.3`、`grok-build-0.1`）。用量计入 SuperGrok / X Premium 额度。已安装 catalog 尚未列出 `grok-4.6`；要加它仍需 `models` 列表和路由级 `api`，因为 xAI catalog 是混合协议。

## Testing

`packages/llm/llm-pi-ai/tests/oauth.spec.ts` 覆盖编解码、设备码 start/wait/cancel、刷新合并与退出。`packages/llm/llm/tests/topology.spec.ts` 覆盖 OAuth 登录注册表。线路方法是 `llm.oauthLoginStart|Wait|Cancel` 与 `llm.oauthLogout`，与 `credentials.*` 一样仅 loopback。
