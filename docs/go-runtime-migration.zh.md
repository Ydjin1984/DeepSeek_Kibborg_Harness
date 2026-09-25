# Go 运行时迁移计划

[English](go-runtime-migration.md) | 中文

本计划将 Harness 产品运行时和浏览器应用迁移到 Go，并为每个目标操作系统和架构发布一个可执行文件。该程序内嵌浏览器资源，启动选定的应用配置，并提供生成的 HTML 页面和运行时 API。TypeScript 和 Python SDK 继续作为协议客户端，以便现有调用方继续驱动运行时。

## 目标与范围

目标运行时包括应用宿主、HTTP 和 RPC 传输、ACP 与 stdio JSON-RPC 服务器、插件组合、Agent 循环、模型适配器、会话状态与持久化、工具、进程与沙箱适配器，以及 Web 应用。浏览器文档由 Go 模板渲染。交互式浏览器逻辑编译为 Go WebAssembly，并与页面一起嵌入；少量生成的 JavaScript 引导代码可以加载 WebAssembly，但不承载产品逻辑。

迁移将替换 TypeScript 运行时包和 React 浏览器应用。仓库文档、发布自动化以及外部 TypeScript 和 Python 客户端 SDK 无需改写为 Go。开发期间，现有实现会作为行为参照，直到对应的 Go 部分通过兼容性检查。

“一个二进制文件”表示每种受支持的操作系统和架构各有一个可分发程序，并非一个可在所有操作系统上原生运行的程序。静态资源和模板都内嵌其中，安装时不需要写出前端构建目录。

## 当前系统与迁移影响

Harness 由 Cordis 插件组合而成。服务注册、事件、可撤销副作用、配置叠加和 Loader 生命周期都是运行时行为，不只是打包方式。Go 运行时必须先提供等价的组合引擎，明确所有权、顺序和拆卸语义，然后才能安全迁移产品包。

当前 Web 宿主将 `host/webserver`、`host/apiproxy`、`api/gateway`、Typert 和 `client/connection` 分开。`/api` 请求与响应信封、服务器请求、客户端响应、下行事件流和生成的方法编解码器共同构成客户端协议。ACP 和 stdio JSON-RPC 是另外两个独立传输，也是兼容性要求。

Agent 循环从仅追加的会话事件日志中派生模型历史。持久化提供方包括 JSONL 和 SQLite；JSONL 可以提供原样存储的文件文本，而 SQLite 使用打包的物理行，并重建逻辑事件流。会话事件、恢复行为、取消、分叉与恢复、工具、审批、子 Agent、后台任务和投影都会影响模型或用户可见行为。

浏览器应用是由动态客户端模块、UI 插槽、重连状态和实时事件流组成的 React 插件组合。用 Go 模板和 WebAssembly 替换它是一次完整的客户端重写，即使服务器渲染的页面可以嵌入同一个可执行文件。

仓库知识图谱也定位了主要运行时节点：[`api-proxy.ts`](../packages/host/apiproxy/src/api-proxy.ts)、[`typert/protocol`](../packages/typert/protocol/src/index.ts)、[`agent-loop`](../packages/core/agent-loop/src/index.ts)、[`session types`](../packages/core/session/src/types.ts)、[`session persistence`](../packages/session/session-persistence/src/index.ts) 和 [`ACP`](../packages/acp/acp/src/index.ts)。当前提交的图使用旧式节点 ID，因此这些路径会与包参考和[架构地图](architecture.md)交叉核实，不会被当作完整依赖清单。

## 兼容性约定

“逐位一致”必须明确比较哪些字节。迁移对稳定协议样例和持久化记录产物要求字节完全相等；对必然包含生成标识符、时间、调度或操作系统输出的运行结果则要求语义一致。

| 表面 | 必须保持的行为 | 比较方法 |
|---|---|---|
| JSON-RPC、ACP 和 Web RPC | 方法、字段、判别值、错误码、省略规则、可观察顺序和流式序列相同 | 确定性样例比较编码字节；实时流比较解码消息及顺序 |
| 会话 JSONL | 现有文件可直接读取且不被重写；确定性追加保留规范记录编码和换行字节 | 对样例和追加结果计算 SHA-256 并逐字节比较 |
| 会话事件 | 事件名、载荷值、序号、回放与恢复结果、模型可见投影相同 | 比较规范事件转录和现有快照场景 |
| SQLite | 现有数据库可打开，逻辑行、事件顺序、schema 拒绝行为和事务结果一致 | 比较 SQL 行并运行共享持久化约定套件；不承诺不同 SQLite 构建间的整个文件页字节一致 |
| 模型请求 | 确定性样例中的提供方、端点、请求头、提示词字节、工具 schema、重试/取消决策及请求顺序相同 | 捕获并逐字节比较发出的 HTTP 请求 |
| 工具和操作系统适配器 | 参数、输出、退出状态、取消、超时、清理、访问策略和可见错误相同 | 在每个支持的操作系统运行真实子进程与沙箱样例 |
| 浏览器应用 | 路由、可访问控件、用户流程、重连与错误行为及可见文本相同 | 浏览器回放快照和 DOM/可访问性断言；更换渲染器后 HTML 序列化可能不同 |
| 构建与启动 | 单个可执行文件启动，不依赖 Node.js 或外部前端目录 | 对每个目标从干净目录启动打包产物 |

确定性样例必须固定时钟、生成 ID、模型流、文件系统内容、环境变量和进程输出。没有这些控制时，两个正确实现也可能产生不同字节。整个 SQLite 文件也可能不同，因为页分配、日志和引擎构建属于物理存储细节。如果要求包括数据库镜像和浏览器 HTML 在内的每个运行时字节都完全一致，Go 渲染器和持久化引擎必须显式复现这些编码；在样例证据证明之前，本计划不将其视为可实现要求。

## 目标架构

Go 可执行文件使用具有明确接口的内部包和静态链接的插件目录。应用配置通过纯数据配置选择已注册插件。每个插件负责自己的注册项和清理函数；启动和关闭按依赖顺序执行。旧配置运行时退役前，兼容加载器会将支持的现有 profile 和 patch 文件转换为新配置形式。

```text
Go executable
├── boot and profile composition
├── plugin runtime and capability registry
├── agent, session log, tools, model adapters
├── persistence, filesystem, subprocess, sandbox
├── HTTP / Web RPC / Typert-compatible codecs
├── ACP and stdio JSON-RPC
└── embedded web assets
    ├── Go HTML templates
    └── Go WebAssembly client
```

兼容 SDK 继续使用已发布的 JSON-RPC 协议。迁移期间，Go Web 客户端使用与 TypeScript 客户端相同的领域操作和事件信封。新的插件接口需复现服务可用性、副作用清理、事件分发、waterfall 委托、范围注册和失败行为；它不承诺与 TypeScript Cordis 插件源码兼容。

运行时编写插件是迁移风险之一。当前自修改路径可以检查并挂载运行时插件代码。Go 原生插件不是可移植且可卸载的等价方案。在迁移该功能前，必须选择并验证可移植的模块 ABI，例如由宿主能力接口支持的沙箱化 WebAssembly 模块；或者明确暂缓运行时编写代码，同时保留内置插件组合。悄悄删掉此路径不能算功能兼容。

## 包迁移映射

| 当前分组 | Go 目标 | 兼容性重点 |
|---|---|---|
| `core`、`llm`、`compaction`、`context`、`goal`、`schedule`、`todo`、`plan`、`workflow`、`guard`、`subagent` | `internal/agent`、`internal/session`、`internal/model`、`internal/capability/*` | 轮次生命周期、提示词组装、工具流程、取消、持久化的模型可见状态 |
| `session`、`session-query`、`storage`、`attachment`、`spill`、`feedback`、`identity`、`workspace`、`settings`、`credentials` | `internal/store/*`、`internal/config/*` | 读取现有数据、精确 JSONL 文件、schema/版本拒绝、原子写入和密钥处理 |
| `api`、`typert`、`host`、`client/connection` | `internal/protocol/*`、`internal/http/*` | 方法编解码器、验证、错误、RPC 关联、流和认证策略 |
| `sdk`、`acp`、`examples` | Go 运行时入口，以及保持不变的 TS/Python 客户端 | stdio 分帧、进程生命周期、退出码和协议转录 |
| `shell`、`subprocess`、`terminal`、`fs`、`lsp`、`sandbox`、`execution`、`e2b` | `internal/platform/*`、`internal/capability/*` | 进程树、PTY、信号/取消行为、文件系统策略和操作系统隔离 |
| `web`、`client`、`bundle/web-app`、`boot` | `internal/web/*`、内嵌模板和 Go WebAssembly 客户端 | 路由、UI 流程、静态资源、启动标志和 CSP/来源行为 |
| `hooks`、`mcp`、`skill`、`extensions`、`telegram`、`experimental` | 独立 Go 能力包；逐项审查 experimental 范围 | 线格式、权限、插件生命周期和 opt-in 边界 |
| `test-support`、构建生成器、TypeScript/Python SDK | 兼容性样例和 Go 服务器程序外部保留的客户端工具 | 现有调用方和可复现的多语言测试向量 |

## 迁移阶段

1. **冻结可观察行为。** 盘点已发布 profile、包贡献项、公开 RPC schema、事件名、配置字段、支持平台、会话样例和浏览器流程。捕获确定性模型请求、事件日志、协议转录、JSONL 文件、错误情形和 CLI 输出。记录非确定行为，并为每个样例规定比较方式。

2. **定义协议真源。** 将所有线信封和方法提取到与语言无关的 schema。根据该 schema 生成 Go 编解码器和验证逻辑，并保留面向 TypeScript 与 Python 客户端的类型或生成客户端。在迁移业务逻辑之前，证明旧服务器和 Go 服务器都能接受并发出相同的确定性样例字节。

3. **构建 Go 插件运行时。** 实现插件标识、配置解码、依赖解析、激活顺序、服务查找、副作用、事件监听、waterfall `next` 行为、范围所有权、卸载和回滚。将 base/headless/web 组合转换为由纯数据 profile 配置选择的静态 Go 构造器。在迁移消费者前添加生命周期和无效组合样例。

4. **迁移会话与持久化基础。** 实现 JSON 值类型、事件验证、连续序号规则、会话准备、回放、分叉/恢复、中断轮次修复、JSONL 读取/追加、SQLite 逻辑存储、检查点和投影协调。先让 Go 实现以只读方式打开现有 JSONL 和 SQLite 数据，再对两个运行时运行共享一致性样例。保留现有头信息、JSONL 字节、数据库 schema/版本拒绝和错误分类。

5. **迁移 Agent 循环与模型适配器。** 匹配提示词章节顺序、工具 schema 编码、模型请求序列化、响应流、工具调用 ID、重试、取消、用量统计、继续执行、上下文压缩和错误恢复。使用捕获的提供方流量及无密钥转录样例。确定性样例通过后，再加入真实提供方对比。

6. **迁移能力提供方和操作系统集成。** 将文件系统、shell、subprocess、PTY、LSP、sandbox、attachment、skill、MCP、jobs 和 subagent 提供方移至 Go 接口实现。保留各平台的进程树终止、权限判断、环境变量清理、路径策略和 teardown。将现有沙箱与原生安全测试作为验收要求，并为每个平台加入 Go 样例。

7. **迁移宿主传输和兼容入口。** 实现 Web HTTP 载体、RPC 分发、事件流、Typert 兼容描述符、ACP 和 stdio JSON-RPC。保留请求验证、状态映射、WebSocket/SSE 行为、中止传播和 SDK 启动语义。不修改 TypeScript 和 Python SDK 的公开 API，直接让它们对 Go 可执行文件运行验收套件。

8. **替换浏览器渲染器。** 将 React 屏幕和插件插槽改写为 Go HTML 模板和 Go WebAssembly 客户端。通过 `go:embed` 嵌入生成资源；路由和 RPC 行为保持不变。分批迁移每个浏览器回放流程，并比较可见状态、可访问名称、键盘行为、事件重连、文件上传、终端输出、审批流程和错误消息。在全部流程通过前，保留旧浏览器构建作为对照。

9. **运行差分和故障测试。** 对每个确定性样例，将相同输入送入 TypeScript 和 Go 运行时，并比较协议字节、模型请求、规范会话事件、持久化产物、退出码和最终状态。注入进程崩溃、截断记录、慢速消费者、客户端断连、提供方错误、重复注册及活跃工作期间的关闭。在所有支持平台重复运行依赖操作系统的场景。

10. **打包并切换默认实现。** 为每种操作系统/架构构建一个签名可执行文件，内嵌 Web 资源、profile 模板和所需迁移工具。验证在没有 Node.js、pnpm 和前端源码树的环境中启动。加入诊断模式，报告构建版本、profile、存储格式和启用能力。只有 Go 运行时通过兼容矩阵后才能切换默认实现；当现有格式保持不变时，保留一个有文档说明的回滚版本。

## 发布门槛

只有以下条件全部满足，Go 运行时才可替换当前服务器：

- 所有受支持 profile 都能以相同的用户可见设置完成组合，并提供预期能力。
- 现有会话 JSONL 文件和 SQLite 数据库无需重写即可打开；回放、恢复、分叉、恢复、导出和查询结果符合样例。
- 确定性的 Web RPC、ACP、stdio JSON-RPC 和 SDK 对话符合编码后的兼容样例。
- 确定性提供方请求符合捕获字节，流式与取消行为符合当前快照。
- 生成页面和 WebAssembly 客户端通过所有浏览器场景，包括重连和错误流程。
- 安全、子进程、文件系统、沙箱、终端、关闭和资源清理检查在所有支持的操作系统通过。
- 打包程序在干净目录运行，不需要 Node.js、pnpm 或松散的前端文件。
- 速度结论来自同一硬件上可重复的前后基准，覆盖启动、空闲内存、请求吞吐、流延迟、持久化吞吐和进程密集型负载。

## 风险和待决事项

- **字节级一致性：** API 样例和确定性 JSONL 写入可以逐字节相等。实时并发流、生成时间戳/ID、SQLite 文件镜像以及 React 到模板的 HTML 不能预设为逐字节相等。开始实现前应确认比较矩阵。
- **动态插件执行：** 运行时编写的 TypeScript 插件没有直接可移植的 Go 等价实现。选择 WebAssembly 宿主 ABI，或接受单独界定的产品变更；省略此功能时不得宣称完全兼容。
- **浏览器重写：** Go 模板与 WebAssembly 将替换 React 组合、动态客户端模块和 UI 插槽。UI 兼容需要独立验收清单，并可能主导工期。
- **Cordis 配置执行：** 当前 profile 可能在插件配置中使用 JavaScript 表达式。应将可执行配置替换为经过验证的数据和显式 Go 构造器注册表；提供转换器，并对不支持的表达式快速报错。
- **SQLite 物理输出：** 保留数据库逻辑内容的同时，文件字节仍可能不同。只有在迁移主动固定同一 SQLite 引擎且证明页级输出确定时，才保留文件镜像字节要求。
- **安全实现：** Linux Landlock、macOS Seatbelt、Windows 进程控制和原生目录选择器都需要平台代码，也可能需要有限的原生绑定。Go 重写必须保留策略结果，不能只满足跨平台编译。
- **速度与可靠性：** Go 可能减少启动开销和部署依赖，但吞吐量与可靠性取决于负载、算法、驱动和运行行为。改进应作为测量后的发布门槛，而非先验假设。
- **迁移周期：** 产品包和 UI 全部迁移前，两套运行时会带来维护成本。按垂直切片迁移，每片要求兼容性证据，并避免长期维护共享业务逻辑分支。

## 建议顺序

先定义协议 schema 和确定性兼容性测试框架，再实现插件运行时以及会话/持久化核心。随后迁移 Agent 循环和能力包，再迁移传输与 SDK 验收。RPC 和事件约定稳定后再启动 Web 渲染器，这样各屏幕可基于固定的 Go API 逐步迁移。动态插件应等宿主 ABI 通过一个小型端到端模块验证后再处理。最终切换是打包里程碑，而不是兼容性工作的起点。
