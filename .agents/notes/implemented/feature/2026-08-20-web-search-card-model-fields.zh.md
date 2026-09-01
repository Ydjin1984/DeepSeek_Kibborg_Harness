# Agent Note: Web-search card model fields

Status: implemented

[English](2026-08-20-web-search-card-model-fields.md) | 中文

## 问题

`web-search-deepseek` 已经把 `model`、`maxTokens` 和 `apiVersion` 存在自己的 settings 段里，并在每一次辅助 Messages 请求上发送它们。Plugins 的搜索卡片却只编辑密钥、端点和单次请求搜索预算。因此，自定义 Anthropic 兼容网关——也就是 Models 页标为「自定义」的那种手写路由——除非用户去改 `settings.yaml`，否则搜索仍会打到 `deepseek-v4-flash`。

## 决策

搜索卡片把 `model`、`maxTokens` 和 `apiVersion` 与 `baseURL`、`maxUses` 一起暂存。它们就是提供方已经按次投影的同一组 schema 键；卡片不新增配置字段。空草稿会清除用户层，让下一次搜索重新继承组装默认值（`deepseek-v4-flash`、`4096`、`2023-06-01`）。正整数上界仍归 Host 的分节校验器；卡片只判断数字草稿是不是数字。

Models 页的自定义提供方编辑器仍然是 LLM 路由目录。搜索在一次 Messages 调用上只点名一个模型，不会列出或拉取该目录。

## 备选方案

**让搜索复用对话模型的路由。** 否决，因为搜索是一次带原生 `web_search` 服务器工具的独立 Anthropic Messages 调用。OpenAI 兼容的自定义路由答不了这次调用；把两者绑在一起会让切换对话模型在这张卡片上看不见的情况下改变搜索。

**把自定义提供方的模型目录拉到搜索卡片上。** 否决，因为搜索请求点名的是一个模型 id，不是一份目录。从插件卡片去询问 `llm-pi-ai` 会把 Host 已经分开的两个命名空间耦在一起。

**只把这些字段留在 `settings.yaml`。** 否决，因为已经在 Models 卡片上填过这些字段的自定义网关，仍然无法在不另做一次隐藏编辑的情况下让搜索指向对应模型。

## 影响

把搜索指到自定义 Anthropic 兼容端点的用户，可以在同一张 Plugins 卡片上设置该网关的模型 id、输出 token 上限和 Anthropic API 版本，以及密钥与端点。对话模型选择器不变。空白字段仍然表示「使用提供方默认值」，而不是「发送空模型名」。

## 测试

`packages/client/ui-settings-plugins` 把这三个字段与原有的端点和预算一起暂存并保存。`packages/web/web-search-deepseek` 把已存储的 `model`、`maxTokens` 和 `apiVersion` 投影到下一次搜索的请求体和 `anthropic-version` 标头，无需重新注册提供方。
