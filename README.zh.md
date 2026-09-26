# DeepSeek_Kibborg_Harness

[Русский](README.md) | 中文

**DeepSeek_Kibborg_Harness** — 俄语分叉版 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)：基于 [Cordis](https://github.com/cordiverse/cordis) 的「一切皆插件」智能体平台，针对个人 AI 智能体编排深度定制 — 实时编码、授权渗透测试、逆向工程等场景。

平台围绕**编排模式**构建：主脑（规划）模型管理工作流，整个执行生命周期 — 任务、目标、工作流、子代理、外部资源 — 汇总为统一的可观测画面。

---

## 主要特性

### 编排模式「主脑 + 执行者」
- 主脑模型负责规划与委派；**本地执行者**（Kibborg，支持视觉）执行繁重的工具工作并返回简明报告。
- **Head 工具策略，运行时强制**：重型工具（`nmap`、`idat` 等，来自 `headDenyTools` 列表）**从主脑的工具清单中隐藏**（`system-prompt/assemble` 过滤），并在 **`tools/pre-execute`（审批之前）被拒绝** — 执行者（depth ≥ 1）不受限制。
- 浏览器支持：Chrome DevTools Protocol（`127.0.0.1:9222`）作为代理工具（截图、DOM 文本、点击）。

### 统一执行状态机（`ctx.executions`）
- 统一生命周期：`CREATED → QUEUED → RUNNING → WAITING_TOOL / WAITING_SUBAGENT / WAITING_USER → COMPLETED`；终态 `FAILED / CANCELLED / TIMEOUT / ABORTED`；恢复分支 `INTERRUPTED → RECOVERING`。
- **适配器投影**：后台任务（`jobs`）、目标（`goal`）、工作流（`workflow`）与子代理（`subagent`）自动将自身状态投影到统一状态机 — 全部活动一目了然（GUI「执行」页签）。
- 幂等、尽力而为的投影：注册表为唯一事实来源，子系统无需迁移。

### 外部资源租约注册表（`ctx.executions.resources`）
- Chrome CDP / PTY / IDA / workspace / subprocess 的 **lease + heartbeat + TTL** 跟踪。
- Fail-closed 检查：`live / expired / released / orphaned / unknown`；幂等 **孤儿清理** — 过期资源仅标记一次。
- 类型化事件 `executions/resource` — 审计与恢复的基础。

### 持久化执行日志（Flight Recorder 基础）
- Bridge 插件 `execution-persistence` 将执行与资源事件写入 **append-only JSONL 日志**（`$DSH_HOME/executions/events.jsonl`），每次写入均 fsync。
- 「谁做了什么」的历史**在重启后保留**；两个逻辑日志（会话 ↔ 执行）互不混合。

### Engagement / ROE 安全轮廓
- 插件 `engagement-stub`：启用后 — **主机白名单**；`blockedTools` 中的工具与对白名单之外主机的 URL 调用在审批前被**确定性拒绝**，并产生审计事件 `engagement/denied`。
- localhost 始终允许；非 URL 调用不受影响。

### 技能系统
- 技能目录与管理器：CRUD、版本、回滚、回收站、发布；**基准测试与自动改进**（A/B、指标、路由评估）。
- 专业技能：授权渗透（`hakker-kibborg`）、逆向工程与 IDA Pro、Tor/onion 搜索、XDF 调校（TunerPro）等。

### 可靠性与持久性
- 持久会话：JSONL + SQLite（WAL、`synchronous=FULL`）、torn-tail 恢复、单写者序列化 — 经 crash/restart e2e 测试验证。
- 完整 CI 质量流程：strict TypeScript、逐文件 100% 覆盖率、lint、typecheck、GUI 快照测试。

### Web GUI
- React/Vite：聊天、**「执行」**（事件时间线及筛选）、「轨迹」、文件面板、设置（模型、技能、插件）、实时监控。

---

## 从源码运行

### 环境要求

- Node.js `^22.19 || >=24`（推荐 24 LTS）。
- pnpm `>=11` —— 通过随 Node.js 22 与 24 一起提供的 Corepack 启用。
- Git 2.26 或更高版本。
- Linux：编译原生插件需要 `build-essential` 与 `python3`。

先确认已经安装的内容：

```sh
node -v      # need 22.19+ or 24+
pnpm -v      # need 11+
```

### 没有 Node.js 时如何安装

**Windows** —— 最简单的方式是 winget：

```sh
winget install OpenJS.NodeJS.LTS
```

如需同时保留多个版本，请安装 nvm-windows：

```sh
winget install CoreyButler.NVMforWindows
nvm install lts
nvm use lts
```

**Linux** —— 使用 [nvm](https://github.com/nvm-sh/nvm#installing-and-updating)（无需 root，可切换版本）：

```sh
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.5/install.sh | bash
exec "$SHELL" -l
nvm install 24
nvm use 24
```

或使用 [NodeSource](https://github.com/nodesource/distributions) 的系统软件包 —— Debian/Ubuntu：

```sh
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs
```

Fedora/RHEL：第一条命令为 `curl -fsSL https://rpm.nodesource.com/setup_24.x | sudo bash -`，第二条为 `sudo dnf install -y nodejs`。

发行版自带仓库中的 `nodejs` 软件包通常低于所需版本，安装后请核对 `node -v` 的输出。

### 更新 Node.js

用当初安装它的方式完成更新：

```sh
winget upgrade OpenJS.NodeJS.LTS   # Windows
nvm install 24 && nvm use 24       # nvm on Linux or macOS
```

切换 Node 版本后请重新安装依赖：原生插件与具体版本的 ABI 绑定。

```sh
node -v
pnpm install
pnpm run build
```

### pnpm

启用 Corepack 后，pnpm 会按项目的 `packageManager` 取用：

```sh
corepack enable
```

Node.js 25 及更高版本不再附带 Corepack：请单独安装它（`npm install -g corepack`），或直接安装 pnpm（`npm install -g pnpm@11`）。

### 克隆与构建

克隆**本**仓库（非上游）：

```sh
git clone https://github.com/Ydjin1984/DeepSeek_Kibborg_Harness.git
cd DeepSeek_Kibborg_Harness
pnpm install
pnpm run build
pnpm dsh web
```

Web UI 默认运行于 `http://127.0.0.1:3080`。Windows 下可使用 `run.bat`（带进度条的构建与启动菜单）。在 Linux 上，从其他机器访问时可通过端口转发打开：`ssh -N -L 3080:127.0.0.1:3080 user@host`。

---

## 上游项目

DeepSeek_Kibborg_Harness 基于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（MIT 许可）— DeepSeek AI 的开源智能体平台。原始描述、架构文档与指南见[上游仓库](https://github.com/deepseek-ai/deepseek-harness)及本仓库的 [`docs/`](docs/architecture.md)。

## 贡献

参见 [CONTRIBUTING.md](CONTRIBUTING.md) 与 [AGENTS.md](AGENTS.md)（代理与开发流程规则）。

## 许可证

[MIT](LICENSE)
