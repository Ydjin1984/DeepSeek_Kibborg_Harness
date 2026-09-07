# @deepseek-ai/dsh-execution-persistence

[English](README.md) | 中文

为 `execution/event` 和 `executions/resource` 载荷提供只追加的 JSONL 日志。`dsh-execution` 服务仍是进程内投影；本插件是组合侧的监听器，把这些 Cordis 事件持久记录下来供审计。

## 插件（命名空间：`execution-persistence`）

函数插件（`name` / `inject` / `apply` / `Config`）。不注入任何服务。发行配置从 `dsh-base` 在 `dsh-execution` 之后挂载：

```yaml
- id: execution-persistence
  name: '@deepseek-ai/dsh-execution-persistence'
```

### 配置

| 字段 | 默认值 | 含义 |
|---|---|---|
| `enabled` | `true` | 为 `false` 时插件不注册监听器。 |
| `root` | `$DSH_HOME/executions` | 存放 `events.jsonl` 的目录。相对路径相对进程 cwd 解析。省略或空白的 `root` 使用 `dshHomePath('executions')`（`$DSH_HOME`，否则 `~/.dsh`）。 |

### 日志文件

路径：`<root>/events.jsonl`。

每行一个 JSON 对象：

```json
{"kind":"execution","ts":1710000000000,"event":{}}
{"kind":"resource","ts":1710000000001,"event":{}}
```

`kind` 对 `execution/event` 为 `"execution"`，对 `executions/resource` 为 `"resource"`。`event` 是内部的 `payload.event`（`ExecutionEvent` 或 `ResourceEvent`）。`ts` 是本插件把该行入队时的纪元毫秒。插件以追加方式打开文件、写入该行、调用 `handle.sync()`、再关闭；重叠的 emit 共用一条每插件 promise 链，避免行交错。写入失败用 `ctx.logger.warn` 记录，不拒绝发射方。插件卸载会等待进行中的写入，然后忽略后续事件。

## Model Experience

### Host-side execution journal

#### What the model sees

本插件不注册提示词段落、工具 schema 或模型可见消息。它把宿主侧 `execution/event` 和 `executions/resource` 载荷追加到 JSONL 文件，该文件从不进入模型请求。

#### Token effect

零。日志记录不增加、替换或截断任何模型请求中的 token。

#### KV Cache effect

与模型请求无关。写入日志不改变请求 token，也不使 KV 缓存条目失效。

## Known Limitations and Deferred Work

- **只追加的审计日志** — 文件是已发出事件的历史；本包不从中重建 `ctx.executions` 或资源租约。
- **无撕裂尾恢复** — 写到一半崩溃可能留下截断的最后一条记录；读取方必须跳过不完整的末行。修复与回放属于后续切片。
- **进程内写入器** — 一个插件实例串行化自己的写入；多个进程追加同一文件时没有协调。
