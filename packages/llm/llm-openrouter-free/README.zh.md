# @deepseek-ai/dsh-llm-openrouter-free

[English](README.md) | 中文

harness 的 OpenRouter 免费模型池。一个插件实例扫描公开的 OpenRouter 模型目录以找出零价格模型，把存活者发布为一条 `pi-ai` 提供方路由，并按每模型请求与 token 预算把它们租给在池内轮换的调用方。

包根入口导出 Cordis 插件约定（其默认导出是 `ctx.openrouterFree` 服务类）、设置 schema，以及配置界面或消费方所需的纯读取器。模型目录解析、预算账本和持久化格式保留在包内部。

## 为什么是模型池，而不是一条免费路由

免费模型会用尽。OpenRouter 上每个免费模型都有自己的每分钟与每日额度，而持续向已耗尽的模型发问的客户端得到的是 `429`，不是答案。因此模型池为每个模型维护自己的账本——本分钟请求数、今日请求数、今日 token、冷却——并选择仍有预算且使用最少的模型。一次被限流的尝试会让该模型下场，直到其窗口轮换，于是下一个任务无需操作者干预就转向下一个模型。

没有任何模型还有余额时，`acquire()` 立即返回 `undefined`。它从不等待：原本会阻塞在一个无可花费模型上的调用方，会得到一个可以上报的缺失 worker，这正是让一次扇出不会卡在一个空模型后面的原因。

## 配置

由 设置 → 模型 → «OpenRouter Free» 写入 `openrouter-free` settings 分节；同一批键也可以从组合中设置。`apiKeyEnv` 是通过 `ctx.credentials` 解析的凭据*引用*，因此没有机密进入该文件——存于该引用之下的密钥，也正是扫描作为 bearer token 发送的那一个。

```yaml
- id: llm-openrouter-free
  name: '@deepseek-ai/dsh-llm-openrouter-free'
  config:
    enabled: true
    providerRoute: openrouter
    baseURL: https://openrouter.ai/api/v1
    apiKeyEnv: OPENROUTER_API_KEY
    refreshMinutes: 30
    maxModels: 20
    minContextWindow: 32768
    requestsPerMinutePerModel: 20
    requestsPerDayPerModel: 50
    tokensPerDayPerModel: 0
    excludeModels: []
    requireToolSupport: true
```

| 键 | 含义 |
| --- | --- |
| `enabled` | 模型池是否扫描、发布其路由并提供租约。未设置前处于休眠。 |
| `providerRoute` | 发布进 `llm-pi-ai` 提供方字典的路由键。默认值 `openrouter` 是已安装 pi-ai catalog 已为该厂商提供的路由，因此池中的模型出现在用户为 OpenRouter 选择的提供方之下，而不是其旁边。 |
| `baseURL` | OpenRouter API 根；扫描时追加 `/models`。 |
| `apiKeyEnv` | 已发布路由按请求解析的凭据引用。 |
| `refreshMinutes` | 扫描节奏；每次扫描都会用找到的模型重新发布该路由。模型池在运行期间按此间隔重新扫描，因此长会话无需重启就能接收新免费和新变价的模型。 |
| `refreshNonce` | 操作者侧的扫描触发器：该值本身没有含义，改动它就请求一次立即扫描。配置界面的「立即重新扫描」写入的正是它，因此不需要第二个服务动词。 |
| `maxModels` | 入池模型数量上限，在排序之后应用（上下文最大者优先）。 |
| `minContextWindow` | 上下文容量低于该值的模型不入池。 |
| `requestsPerMinutePerModel` | 每个模型每个 UTC 分钟被下场前的请求数。 |
| `requestsPerDayPerModel` | 每个模型每个 UTC 日被下场前的请求数。 |
| `tokensPerDayPerModel` | 每个模型每个 UTC 日的 token 数；`0` 关闭 token 上限。 |
| `excludeModels` | 永不入池的模型 id（精确匹配）。 |
| `requireToolSupport` | 仅把目录条目声明了 `tools` 的模型入池。默认开启：入池模型会带着 harness 的工具集被委派，而不支持工具的模型会用提供方错误回应第一次工具调用。 |

`status` 与 `scannedAt` 这两个键由服务拥有：每次扫描和每次已结算的租约都会用入池模型及各自剩余量重写 `status`，每次成功的扫描都会盖下 `scannedAt`，界面正是以此显示模型池的新鲜度。对已提交分节作出反应的读取方必须比较配置字段（导出的 `settingsOf()` 投影），而不是整个值，否则一次上报的租约看起来就像配置变更——并且绝不能把自己的上报当作重新扫描的理由。

已发布的路由可撤回：禁用模型池会撤销它写入的路由 profile，而找不到任何免费模型的扫描同样会撤回它，因此空模型池绝不会留下一条所有模型都已消失的路由。

## 消费方

编排器的 ROI 模式是第一个消费方：其 `swarm` 工具为每个任务从 `ctx.openrouterFree` 租一个模型，因此 5–20 个 worker 的扇出不花费任何付费 token。消费方通过 `ctx.get('openrouterFree')` 读取该服务；在未组合本包的部署中它不存在——模型池是可选项，而不是任何会委派的东西在加载期的依赖。

该服务还注册面向模型的 `free_models` 工具（在没有工具注册表的部署中不存在）。`status` 报告入池模型、各自今日的剩余量，以及模型池最近一次被扫描的时间，全程不触网；`refresh` 则先重新扫描 catalog。它让规划器在扇出工作之前先检查模型池，并在无需等待 `refreshMinutes` 的情况下刷新它。

## 持久化

账本位于 `$DSH_HOME/storages/openrouter-free/ledger.json`，以原子方式重写。它只保存按模型的计数器——没有提示词、没有输出、没有密钥。缺失或格式错误的文件读作空账本：遗忘的唯一代价是要从一次 `429` 重新学到上限，而对损坏文件的崩溃循环会把模型池一起拖垮。

## 模型体验

### 免费入池路由

#### 模型看到的内容

模型池不添加任何提示词文本，也没有自己的工具。模型看到的就是那条已发布路由：免费模型像任何其他路由一样出现在选择器和 `llm.models` 中，名称取自 OpenRouter 目录，委派给其中之一的任务会带着常规工具集在该模型上运行。模型池预算在模型可见层面唯一的后果是：被委派的任务不运行，而是立即返回「no free model has budget left」。

#### Token 影响

模型池不花费自己的 token：一次扫描就是一次 `GET /models`，不产生模型请求。任务花费的 token 属于运行它的模型；账本记录的是消费方通过其租约结果上报的内容。

#### KV Cache 影响

模型池既不读也不写提供方缓存状态。每个入池模型都作为自己的路由访问，因此轮换到另一个免费模型的任务对该提供方而言是一段全新对话，从空缓存开始。

## 已知限制与暂缓事项

- OpenRouter 不为免费模型发布配额端点，因此账本记录的是模型池对每个模型的*相信*，而不是 OpenRouter 报告的内容。在本 harness 之外被使用的模型会花掉账本看不见的额度；它上面第一次 `429` 会纠正这条记录。
- token 计量取决于消费方上报一次尝试的花费。编排器的 swarm 只上报请求数，因为 subagent seam 不返回用量，因此 `tokensPerDayPerModel` 只对在租约结果中传入 `tokens` 的调用方生效。
- 扫描信任目录中的价格字符串。某个模型在入池路由仍列出它时开始收费，会继续被租出直到下一次扫描；`refreshMinutes` 就是这个界限。
- `excludeModels` 精确匹配 OpenRouter id。前缀或厂商家族级别的排除（整个 `vendor/*`）暂缓，直到有部署需要它。
