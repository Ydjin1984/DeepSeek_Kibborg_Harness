# Agent Note: 持久 ExecutionEvent 日志是组合侧的 JSONL 监听器

Status: implemented

[English](2026-09-07-execution-event-durable-jsonl-journal.md) | 中文

## 问题

`ctx.executions` 和资源租约登记处把状态放在内存里。它们的 `execution/event` 与 `executions/resource` Cordis 事件在进程重启后消失，因此没有宿主侧的机器真相执行历史审计轨迹。Session 事件仍是模型可见日志；把执行机器真相混进 `SessionEventMap` 会把两种不同的重建任务绑在一起，并强迫每个 session 读取器理解 job/goal/workflow/subagent 租约。

## 决定

`@deepseek-ai/dsh-execution-persistence` 是 `packages/execution/execution-persistence` 中的函数插件。它监听 `execution/event` 和 `executions/resource`，并把每个事件追加成 `<root>/events.jsonl` 中的一行 JSON。`dsh-execution` 包不引入 persistence。发行配置从 `dsh-base` 挂载该插件（`id: execution-persistence`），`enabled` 默认为 true。

每行是 `{"kind":"execution"|"resource","ts":<epoch-ms>,"event":<payload.event>}`。写入器以追加方式打开文件、写入、`fsync`、再关闭；重叠的 emit 共用一条每插件 promise 链。写入错误进入 `ctx.logger.warn`，不拒绝发射方。卸载会等待进行中的写入，然后丢弃后续事件。

`root` 是 Config 字段。省略或空白时目录为 `dshHomePath('executions')`（`$DSH_HOME/executions`，否则 `~/.dsh/executions`）。测试传入显式临时 `root`。

本切片不从文件重建内存中的执行或租约状态。Jobs、goals、workflows 和 subagents 在重启后仍把活状态投影进 `ctx.executions`。

## 备选方案

- **在 session SQLite 数据库中新建 `execution_events` 表** — 本切片否决。已发行的 `dsh-base` 配置把 session 存成 JSONL（`session-persistence-jsonl`，路径 `$DSH_HOME/sessions`），并挂载 `session-query-sqlite`，`path: ':memory:'` 且 `openAt: never`。`ctx.sessionPersistence` 不暴露原始 `DatabaseSync`，桥接插件无法在不新增 session-persistence API、不升 schema 的情况下共用该库。独立 JSONL 文件沿用现有的追加+fsync 模式，且无需 SQLite 即可测到 100%。
- **把执行记录追加进 session 日志** — 否决：SessionEvent 是模型可见真相；ExecutionEvent 是机器真相。共用一份日志会让每个 session 读取器处理执行内部细节，并对不得进入模型的事件违反「模型可见 ⟺ 已记录」。
- **把持久化放进 `dsh-execution`** — 否决：该包是内存状态机。持久化是组合侧监听器，这样服务仍可替换，且不承担文件系统策略。

## 后果

包含 `dsh-base` 的配置会在这些 Cordis 事件触发时写入 `$DSH_HOME/executions/events.jsonl`。磁盘占用随执行流量增长；本切片没有轮转。崩溃可能留下截断的末行；读取方必须跳过不完整的尾部。从日志重建 `ctx.executions`、撕裂尾修复、以及多进程写入属于后续工作。
