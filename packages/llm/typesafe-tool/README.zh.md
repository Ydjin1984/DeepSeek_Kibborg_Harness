# @deepseek-ai/dsh-typesafe-tool

[English](README.md) | 中文

基于 TypeSafe.ai System One API 的、面向模型的 `typesafe_evaluate` 工具。

TypeSafe.ai 不是 OpenAI 兼容的对话提供方。它提供一个 `POST /v1/systemone` 端点，针对单段状态回答带类型、带概率的问题，不返回自由文本。本包把该端点作为工具暴露给模型，用于分类、路由、情感与评分。

## 配置

| 键 | 默认值 | 含义 |
| --- | --- | --- |
| `apiKey` | — | 字面密钥；优先使用 `apiKeyEnv`，以免机密进入配置文件。 |
| `apiKeyEnv` | `TYPESAFE_API_KEY` | 每次调用解析的凭据引用。 |
| `baseURL` | `https://api.typesafe.ai` | API 基址；追加 `/v1/systemone`。 |
| `defaultModel` | `jev-latest` | 调用省略 `model` 时使用的模型 id。 |
| `timeoutMs` | `60000` | 每次调用的协作式超时预算，单位为毫秒。 |

该密钥每次调用时先从凭据存储解析，其次从启动环境解析，因此通过 Models／凭据界面存入的密钥无需重启即可生效。

## 模型体验

### typesafe_evaluate 工具

#### 模型看到的内容

一个名为 `typesafe_evaluate` 的工具，其描述与输入固定：一个 `state` 字符串，加上 `questions`，每个问题形如 `{ id, type, instructions }`，其中 `type` 取 `noul`（是／否）、`choice`（择一选项，`criteria` 把选项 id 映射到描述）或 `score`（按有序刻度评分，`levels` 列出有序的档位描述）。结果是 System One 的答案主体，以美化 JSON（`model`、`answers`、`usage`）原样返回。

#### Token 影响

描述与输入 schema 在每个构建中都是静态的，因此启用该工具会给每个挂载它的请求增加一个大小有界的块。每次调用把 `state` 参数与返回的 `answers` 计入上下文，因此问题批次应保持在决策所需的最小规模。

#### KV Cache 影响

除那个静态工具块之外无影响：描述与 schema 在轮次之间从不变化，本包也不贡献任何系统提示词行。

## 已知限制与暂缓事项

- 答案主体原样返回；解释由调用方负责。
- 不提供客户端侧投影或专门呈现；调用使用通用卡片。
