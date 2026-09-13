# Agent Note: kibborg 终端界面在进程内运行既有 harness

Status: implemented

[English](2026-09-11-kibborg-terminal-surface.md) | 中文

## Problem

`DeepSeek_Kibborg_Harness` 此前在一个核心之上提供两个界面：配置文件启动器 `dsh`（`apps/cli`）及其 `web` 与 `headless` 配置文件，以及由 `packages/bundle/web-app` 组装的 Web GUI。终端只是被声明的意图，而不是一个界面：`apps/cli/src/args.ts` 仅把 `dsh --profile tui` 作为示例记录，`packages/api/remotes/README.md` 指出其 client face「可被 Web 或未来提供同一份不依赖 React 的 `ctx.remote` 约定的 TUI 复用」，而 `packages/bundle/web-app/cordis.patch.yml` 明确把 agent 层的行保留在基础层，是「给 TUI 用的——TUI 是单会话的，并在进程级组装其 agent」。

添加该界面带来一个主要风险：第二套 agent 实现。若终端应用直接访问 `agent`、`agent-loop`、工具实现或会话存储，就会把核心分叉，而这个分叉会在任一侧发生第一次变更时与 Web 界面产生差异。因此本次交付必须用证据而非意图来回答两个问题：终端应用可以触碰哪些层，以及 Web 界面使用的客户端包能否在 Node 进程中运行。

## Decision

终端界面是同一核心之上的第三个配置文件，拥有自己的应用与自己的 bundle，并通过与浏览器相同的 Remote 约定与核心通信——在同一进程内，不使用套接字。

- **自有的配置文件。** `kibborg` 是 `$DSH_HOME/profiles` 下的配置文件，其 `dsh.profile.bundles` 为 `@deepseek-ai/dsh-base` 与 `@kibborg/cli-bundle`。应用在首次使用时创建该配置文件，并根据自身的依赖闭包修复扁平模块回退目录（`$DSH_HOME/profiles/node_modules`）；这正是 `dsh` 已为其配置文件使用的约定。

- **自有的应用与 bundle。** `Kibborg_CLI/apps/cli` 是 `@kibborg/cli`（bin `kibborg`），只负责进程级事务：命令行、配置文件启动、配置导出与诊断。`Kibborg_CLI/packages/cli-bundle` 是一个 patch 层，在 `dsh-base` 之上组装终端所需的行——API proxy、带 JSON 存储三件套的 workspace 注册表、browse 目录选择后端，以及客户端传输。该 bundle 不渲染任何内容，也不挂载 Web bundle。

- **进程内传输。** `Kibborg_CLI/packages/client-node` 构造 `InProcessApiClient(toFetchHandler(ctx.apiProxy))`。整条 wire 路径——rpcId 铸造、信封包装与解包、schema 校验——都在进程内运行，因此不绑定端口、不启动服务器，也不会有后台进程在命令结束后继续存活。该传输正是 API proxy 包已通过 `InProcessApiClient` over `toFetchHandler` 暴露的同构载体点。

- **成文的边界。** CLI 代码可以使用 `@deepseek-ai/dsh-app-boot` 的公开导出、配置文件组合（patch 层与 overlay）、经由进程内或 HTTP 客户端访问的 API proxy、Remote 域，以及在证明 Node 安全之后的、不依赖 React 的客户端对象层。CLI 不得按内部路径导入 `agent`、`agent-loop`、`orchestrator`、工具实现或会话存储，也不得新增第二套工具注册表、会话存储、配置层或 skill 层。`Kibborg_CLI/tests/import-boundary.spec.ts` 是计划中对该白名单的关卡。

- **统一名称。** 命令、配置文件与包作用域都是 `kibborg`；此前的 `kiborg` 写法不再在任何地方使用。

## Alternatives considered

### 在 Node 中导入浏览器客户端 bundle

Web 界面的客户端半边以 `lib/client.js` bundle 形式发布，其开头是 `window.__ModuleLoader__.load({...})`：它们是页面模块加载器的注册项，而不是可导入的 ESM 库。五个包在 Node 中都会因此导入失败。它们的 `tsc` 产物（`lib/types/client/index.js`）是普通 ESM，可在 Node 中干净导入，从而让完整客户端栈在后续阶段仍可达——但这不是客户端包 `exports` 映射所宣传的路径，因此依赖它是一个需要重新审视的决定，而不是今天可以奠基的基础。

### 像 `dsh --profile headless` 那样直接使用核心入口

一次性 headless bundle 通过核心注册表创建 Agent，从不挂载 API proxy。它是通往「打印一个答案」的最短路径，而它恰恰是会与 Web 界面产生差异的形态：approvals、questions、plan review、slash 命令、projections、queue、jobs，以及终端所需的每一项交互约定，都在 proxy 之后，而不在注册表之后。因此终端界面即使在其首个 spike 中也走 proxy 路径。

### 每次调用启动一个 loopback HTTP 服务器

在 loopback 端口上启动 Web host 并让客户端连接，可以原样复用 HTTP 载体。但它也让每次 `kibborg "task"` 调用都要付出服务器、端口与两条流的代价，并会引入关于「哪个进程拥有该会话」的第二个事实来源。进程内载体提供相同的请求路径而不带这些代价，因此 HTTP 被保留给确实需要它的远程客户端所在的服务器模式。

## Out of scope / possible extensions

- 交互式渲染器、会话与历史界面、approvals、questions、plan review、slash 命令以及全屏 TUI 属于 spike 之后的阶段；其设计固定在 `Kibborg_CLI/UI.md`，其中已冻结的 `demo/` golden 固定了视觉约定。
- `ctx.remote` 尚未接通：Remote 命名空间的通用 RPC caller 要么写在 `@kibborg/client-node` 中，要么由客户端 connection 包的一个附加子路径导出提供；该选择在首个 Remote 消费者落地时做出。
- `api-gateway/client` 注入的客户端 `typert` 服务目前由基础层已组装的 host 半边满足；专用的 Node 安全客户端半边不属于本决定。
- 服务器模式、远程 attach 及其认证层属于后续阶段。

## Verification

`Kibborg_CLI/K0.0-REPORT.md` 记录了该 spike 及其测量结果。`kibborg "hello"` 在 stdout 作答并以 0 退出；`kibborg "прочитай README.md и кратко опиши проект"` 在 stderr 显示 `kibborg: tool read` 并依据文件内容作答，这表明该命令抵达的是带工具的既有 agent loop，而不只是一次模型请求。`kibborg doctor` 在仓库之外的目录报告九项检查且无一失败，`kibborg --help`、`kibborg version` 与 `kibborg --dump-config` 无需启动即作答。`Kibborg_CLI/` 之外的仓库仅有两处变更：`pnpm-workspace.yaml`（两个 workspace glob）与 `tsconfig.host.json`（两个项目引用）。

## Consequences

- **终端与浏览器在能力上无法产生差异。** 两者通过同一约定抵达同一核心，因此新的核心能力无需终端侧工作即可同时到达两个界面。
- **终端继承核心的交互约定**，包括区分 harness 与聊天客户端的 approvals、questions 与 plan review；它们随渲染它们的阶段到来，而不是随第二套实现到来。
- **配置文件是组合的接缝。** 终端挂载的是 patch 层，因此收窄或扩展它（更换选择后端、增加一行）是组合变更而非代码变更。
- **有一个边界按设计保持开放**：客户端对象层的 Node 兼容性已在模块层面得到证明，但尚未由挂载的客户端栈实际演练，因此首个客户端侧阶段要么挂载它，要么记录为何不可行。
