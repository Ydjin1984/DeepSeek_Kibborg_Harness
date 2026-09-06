# ОТЧЁТ О КОНСЕНСУСЕ: DeepSeek_Kibborg_Harness

**Дата:** 06.09.2026
**Участники:** разработчик/голова проекта (deepseek-v4-flash, оркестратор) · ChatGPT · Grok
**Метод:** трёхсторонняя консультация через Chrome CDP (127.0.0.1:9222). Каждому консультанту передан самодостаточный бриф `PROJECT_LLM_BRIEF.md` (полное описание проекта + 5 вопросов ТЗ), получены развёрнутые ответы, затем проведён раунд кросс-рецензий (каждому показаны тезисы другого для согласования/возражений).
**Сырые материалы:** `.artifacts/consensus_chatgpt_raw.txt` (21,8K симв.), `consensus_grok_raw.txt` (11,3K), `consensus_chatgpt_cross.txt` (8,3K), `consensus_grok_cross.txt` (4K), `consensus_notes.md` (конспекты).

---

## 1. Резюме (для тех, кто не будет читать дальше)

Платформа **архитектурно сильная и уже переросла статус «форка Harness»** — оба консультанта независимо назвали её *agent-runtime платформой* / *«операционной системой для агентов»*. Базовая архитектура оценена ChatGPT в **8.5–9/10** (декомпозиция, Cordis + capability seams, durable sessions, система скиллов).

Главная зона риска — **не незакрытые фичи, а незавершённая граница состояния**:

> внешние процессы и ресурсы (Chrome CDP, PTY, IDA, subprocess, sandbox-lease, jobs) живут **вне** инварианта «модель-видимое ⟺ логируемое»; оркестратор держится на правилах в промпте, а не в policy; скиллы мощные, но без обязательных risk/engagement-метаданных; незакоммиченный WIP поверх rc.8.

**Три вещи, которые оба советуют начать делать завтра** (после кросс-рецензии):
1. **Execution Kernel** — единый владелец жизненного цикла (state machine + lease + recovery) — НО как сервис на существующих `jobs`/`session`/`guard`/`workflow`, а не новый пакет-монолит (позиция Grok, принята).
2. **External Resource Registry + reconciliation** — сессия должна знать про chrome.targets/pty.id/ida.db/sandbox.lease и уметь fail-closed восстанавливаться.
3. **Event-sourced execution log + Flight Recorder** — replay любого execution («почему агент сделал X»), а не гадание.

И только потом — расширение: Engagement Mode, Evidence Locker, Capability Broker/Policy, routing-eval скиллов, IDA/Ghidra job API, Model Router. **Не растить каталог скиллов и не подключать Metasploit, пока нет leases + policy matrix + ROE** (прямая цитата Grok, ChatGPT согласен).

---

## 2. Что мы спрашивали (ТЗ)

- **Q1. Стабильность:** где реальные точки отказа архитектуры «всё — плагин» на Cordis + Web GUI + фоновые агенты + Chrome CDP, пока проект в rc + WIP.
- **Q2. Архитектура:** топ-5 улучшений (контекст/память, мультиагент, фоновые задания, песочницы, наблюдаемость).
- **Q3. Скиллы:** как организовать экосистему (метаданные, зависимости, конфликты, шеринг, качество), анти-паттерны.
- **Q4. «Супер-турбо» среда:** что добавить для лайв-кодинга + авторизованного пентеста + реверса (10–15 фич с приоритетами).
- **Q5. Дорожная карта:** 30/60/90 дней при минимальном риске.

---

## 3. Оценка стабильности (вердикты консультантов)

Таблица оценок ChatGPT (0–10):

| Область | Оценка | Комментарий |
|---|---|---|
| Базовая архитектура | 8.5/10 | очень хорошая декомпозиция |
| Расширяемость | 9/10 | Cordis + capability seams уместны |
| Agent runtime | 8/10 | сильный фундамент, но растёт state complexity |
| Durable sessions | 8/10 | правильное направление |
| Skills | 8.5/10 | ближе к платформе, чем к «папке с промптами» |
| Multi-agent | 7.5/10 | нужен scheduler/lease/state machine |
| Sandbox/security | 7/10 | для security-среды надо поднять |
| **Observability** | **6.5/10** | сделать главным приоритетом |
| **Recovery/resume** | **6.5/10** | самая опасная зона |
| GUI | 8/10 | уже серьёзный |

Вердикт Grok: «Платформа архитектурно правильная… Слабое место — не „мало плагинов“, а **незавершённая граница**: внешние процессы (Chrome, IDA, PTY, jobs) живут рядом с инвариантом лога, оркестратор держится на правилах в промпте, скиллы мощные без mandatory risk/engagement metadata».

---

## 4. КОНСЕНСУС ПО СТАБИЛЬНОСТИ (Q1) — объединённый список рисков

Оба консультанта после кросс-рецензии сошлись по сути (ChatGPT: «согласен с Grok на 85–90%»). Риски в порядке приоритета:

### R1. Сессия не знает о внешних ресурсах (главный риск rc) — оба, P0
- Голова+исполнитель пишут два потока событий в одну сессию; subagent fork наследует контекст; jobs/Ralph/goal-rounds работают фоном; **Chrome CDP, PTY, IDA, sandbox, subprocess живут ВНЕ JSONL**.
- Типичный отказ: replay сессии не восстанавливает CDP-вкладку/PTY/IDA → модель думает, что инструмент «уже открыт». **«R1-тупик сессий» из HANDOFF — ровно этот класс.**
- **Решение (консенсус после рецензии):** не складывать runtime-состояние в session header (станет свалкой), а завести **External Resource Registry**: `resource {id, type, provider, lifecycle, owner_execution, lease, recovery_strategy}` + Artifact Store. Recovery **fail-closed**: нет подтверждения lease → статус `INTERRUPTED` + вопрос человеку, никогда «продолжить вслепую».

### R2. Гонка схемы инструментов при динамических плагинах (Grok; ChatGPT поднял до P0)
- extensions/self-modification, HMR, cordis.patch.yml, незакоммиченный `ui-settings-claude-code`: tool ещё в схеме модели, provider уже мёртв → timeout → compaction портит контекст.
- **Решение:** freeze plugin graph на время agent-turn; **tool-schema snapshot на старте каждого attempt** (не live registry); HMR/self-mod применяется только со следующего execution boundary. Идеально — execution snapshot: `{plugin graph version, tool schema hash, skill versions, model/provider version, policy version}`.

### R3. Оркестратор держится на промпт-правилах (оба)
- Голова тянет сырые tool-results в свой контекст; исполнитель возвращает «сжатый отчёт» без evidence-hash; два агента пишут workspace без lease; голова начинает «доделывать» за исполнителя → дорогой цикл и расхождение логов.
- **Решение:** контракт **Typed Task/Report** (`{task: owner, budget, workspace_lease, allowed_skills[]} → {status, evidence[], mutations[]}`) и **запрет голове на heavy tools в `ctx.tools` policy, а не текстом в промпте** (policy-split голова/исполнитель/субагент).

### R4. Compaction без pinning evidence (оба)
- RE/pentest-сессии генерируют огромные артефакты (IDA listings, nmap, HAR); compaction без pin-list → модель теряет IOC/offset/VA и **галлюцинирует адреса**.
- **Решение:** три слоя контекста (см. A1) + compaction трогает только chat-историю, **никогда pins** (scope, ROE, findings, текущий VA, пути артефактов).

### R5. Один глобальный Chrome CDP на весь оркестр (Grok)
- Чужие вкладки субагентов, eval в чужом origin, screenshot race, процесс не убивается после close сессии. Для pentest — **scope leak**.
- **Решение (оба, P0):** CDP isolator per engagement — отдельный profile-dir + отдельный порт, kill-on-session-end; внешние LLM-консультанты — только read-only (см. F7).

### R6. WIP поверх rc.8 (оба)
- Незакоммиченные cordis.patch.yml / lockfile / run.bat / tsconfig / новый UI-пакет: тесты «лгут», слой изоляции на Windows не единый (Landlock-native + E2B POC рядом).
- **Решение:** закоммитить или вынести в profile overlay (bundle) в ближайшие дни.

### R7. Гонки записи состояния (ChatGPT; Grok согласен «в 30 дней»)
- Agent A пишет session / Agent B пишет session / compactor читает / GUI читает projection / job меняет todo → subtle races.
- **Решение:** single-writer / Session Command Queue (actor на сессию) перед SQLite как источником сериализации.

---

## 5. КОНСЕНСУС ПО АРХИТЕКТУРЕ (Q2) — целевая модель

### A1. Контекст = слои, а не один prompt (оба, после рецензии — единая модель)
1. **Session log** — append-only журнал разговора (что ушло в LLM), как сейчас;
2. **Working memory / pins** — закреплённые факты: scope, ROE, открытые порты, путь IDA DB, текущий VA функции, активные гипотезы, план (ChatGPT добавил 4-й слой — task state);
3. **Artifact store** — файлы/скриншоты/дампы по **content hash**, в модель уходит только манифест;
4. Context Compiler собирает слои `SYSTEM + PROJECT + ENGAGEMENT + TASK + MEMORY + FILES + EVENTS + TOOL RESULTS` с **бюджетом per layer + per model window** (не магическая константа 118K — возражение Grok принято: у flash и локального исполнителя окна разные; ENGAGEMENT/TASK не выкидываются никогда).

### A2. Execution Kernel — единый владелец жизненного цикла (ChatGPT) — с поправкой Grok (принята)
- **Что:** единая state machine для jobs/subagents/workflows/goals/tools/browser/IDA/sandbox: `CREATED→QUEUED→RUNNING→WAITING_TOOL/SUBAGENT/USER→COMPLETED`; терминальные `FAILED/CANCELLED/TIMEOUT/ABORTED`; recovery `RUNNING→INTERRUPTED→RECOVERING→RUNNING`. Никаких разрозненных `isRunning/isDone/hasError`.
- **Как (важно):** **НЕ новый пакет-монолит `packages/runtime` с нуля** (Grok: «не плодить второй оркестратор, Cordis уже владеет fiber/lifecycle, есть jobs/workflow/goal/guard/session»). Реализовать как **сервис на существующем шве `ctx.executions`**, поверх jobs+session+guard, с идемпотентностью `execution_id + operation_id + attempt + parent_execution_id`.
- **Lease внешних ресурсов — в ту же state machine** (дополнение Grok, принято): `chrome_lease / pty_lease / ida_lease / workspace_lease`. Kernel, не владеющий OS-хвостами, бесполезен.
- **Risk-aware SM** (дополнение Grok): переход `RUNNING→WAITING_TOOL` с `risk=exploit` всегда идёт через `WAITING_USER`. Иначе «Metasploit сам себя аппрувит».
- **Windows-специфика** (дополнение Grok): Job Object + дерево PID + обязательный `taskkill /T` на ABORTED.

### A3. Два лога + связка (Grok уточнил ChatGPT; принято)
- **SessionEvent log** — что видела модель (уже есть как JSONL);
- **ExecutionEvent log** — что сделала машина: `{seq, ts, execution, type: "tool.completed", tool, input_hash, output_ref, duration_ms}`;
- Связка `turn_id ↔ execution_id`. **Replay execution #123** — «золотая функция» для отладки. Durable execution ≠ вместо durable session, а **вместе** (иначе replay кода без replay того, что видела модель, даёт «другого агента»).

### A4. Capability Broker / Policy (оба, для security-среды обязательно)
`LLM → Capability Broker → Policy → Tool` — а не `LLM → shell`. Операции получают permission: `shell.exec / network.connect / browser.navigate / filesystem.write / process.spawn`. Policy enforcement — НЕ внутри skill (skill = подсказка, policy = enforcement).

### A5. Scheduler с приоритетами и лимитами (ChatGPT; Grok: «после зелёного recovery»)
Объединить subagent/workflow/jobs/goals/Ralph под одним планировщиком: приоритеты `P0 interactive … P4 maintenance`; лимиты: concurrent agents, CPU, RAM, subprocesses, browser sessions, network ops. Иначе 10 субагентов + IDA + Chrome + Burp + компилятор = «Windows furnace».

### A6. Observability first-class (оба, сошлись после рецензии)
- correlation-id сквозь всё: `session_id → turn_id → task_id → tool_call_id → pid/cdp_target`;
- **Flight Recorder** = timeline из ExecutionEvent, в узле — превью Session-сообщения модели (один мир, не два);
- Метрики, без которых rc слепой: tool timeout rate, compaction drop %, orphan jobs, CDP target leak, schema-mismatch после unload плагина;
- GUI «живой мониторинг» читает тот же event stream, что и guard.

### A7. Изоляция = профиль engagement (Grok; ChatGPT согласен)
Три профиля: **coding** (workspace+git+LSP), **lab-pentest** (отдельный netns/allowlist CIDR/запрет prod-адаптеров), **reverse** (read-only сэмплы + IDA/Ghidra headless, без исходящего). Landlock/Seatbelt/bwrap/E2B — **providers одного seam**, выбираются профилем. Цепочка: Profile → Policy → Capability → Sandbox.

---

## 6. КОНСЕНСУС ПО СКИЛЛАМ (Q3)

Позиция обоих: **менеджер скиллов уже сильнее, чем у Claude Code/Codex** (CRUD, версии, A/B, auto-improve — правильное направление, совпадает с трендом OpenAI: versioned artifacts, immutable versions). Ломается не CRUD — **routing и trust**.

### S1. Метаданные (минимум в каталоге, тело — по требованию)
`id, version (semver), triggers[] (конкретные фразы), anti_triggers[], capabilities[] (tools/binaries: idat, nmap, burp), requires.skills[], conflicts[], risk_class (read|mutate|network|exploit), engagement_bound (нужен ли активный ROE), eval_harness, token_budget_hint`.
- В системный промпт — только `id` + 1–2 строки trigger. Тело SKILL.md грузится **после выбора** (progressive disclosure L0–L4: имя → сводка → нужные инструкции → референсы → полное знание).

### S2. Зависимости и конфликты
- Зависимости — **граф (DAG)**, не список: активация `ida-professional` тянет `reverse-engineering` core, не наоборот; циклы = ошибка publish.
- Конфликты — resolver'ом, не «последний победил»: specificity score + risk_class + user pin. Два red-team скилла сразу = запрет без явного режима.
- **Для hakker-kibborg / ida-professional / tor-web-search / tunerpro-xdf — risk_class + engagement_bound обязательны**, иначе каталог станет «exploit-kit с удобным UI» (Grok).

### S3. Качество: метрики и гейты
- ChatGPT предлагал SkillScore из 8 метрик; **Grok срезал: сначала 3** (принято): `routing-hit`, `contract-pass`, `evidence-complete`. Остальное (latency, token, human-override, regression, user-pin) — на 60–90 день. Иначе auto-improve «оптимизирует дашборд».
- **Routing eval обязателен** (набор размеченных запросов «какой скилл сработает»; размер — per skill, не фиксированные 75: кому-то 40, кому-то 200 кейсов) + **regression corpus**. A/B-улучшения текста без routing-eval не ловят wrong-skill.
- **Contract-тесты**: скилл обещает `idat -A` → в CI поднимается stub и проверяется вызов.
- Auto-improve: candidate **не публикуется**, пока routing + contract зелёные (freeze eval).

### S4. Шеринг и trust
- Скилл = **подписанный bundle** (hash + manifest + scripts); установка только из allowlist/git pin; в перспективе внутренний marketplace с SBOM скриптов и подписью ключа. (Публичные реестры уже ловили malware в skills.)

### S5. Анти-паттерны (объединённый список обеих платформ)
| Анти-паттерн | Почему убивает |
|---|---|
| Описание-каша («анализ, безопасность, код») | routing competition |
| SKILL.md = простыня промпта без скриптов | модель импровизирует процедуру |
| Always-on пачка из 50 скиллов | утопление контекста, «модель потупела» |
| Скрытые зависимости (IDA/Tor/API key) | падает в runtime, агент не понимает ошибку |
| Auto-improve без freeze eval | скилл «умнеет» и ломает триггеры |
| Skill = права уровня system prompt | prompt-injection через установленный скилл |
| Узкий one-off скилл на редкий кейс | шум в каталоге |
| «Агент сам решит и закоммитит» | Loki-mode, мутации вне ROE |
| Instruction soup (система + 5×5000 токенов скиллов + AGENTS.md + PROJECT.md) | конфликт инструкций, преждевременная остановка |

### S6. Субагенты: delegation cost model (ChatGPT)
Не спавнить субагента ради grep (предупреждение Anthropic). Перед spawn решать: сложность / параллелизм / изоляция контекста / spawn-latency.

---

## 7. КОНСЕНСУС «СУПЕР-ТУРБО СРЕДА» (Q4) — объединённый бэклог фич

Легенда приоритетов: **P0** = без этого среда опасна или нестабильна; **P1** = множитель эффективности; **P2** = мощно, но после фундамента. (Источник: C = ChatGPT, G = Grok.)

| # | Фича | Приоритет | Источник |
|---|---|---|---|
| 1 | **Engagement Mode** — runtime-профиль: scope/ROE (CIDR, домены, бинарники, запрет exfil, rate limits, credentials, time window); любой network/exploit tool вне scope = hard deny + audit event | P0 | C+G |
| 2 | **External Resource Registry + fail-closed recovery** (CDP/PTY/IDA/leases) | P0 | C+G (после рецензии) |
| 3 | **Execution state machine + idempotency** (execution_id/operation_id/attempt/parent) | P0 | C+G |
| 4 | **Capability firewall / policy matrix** голова vs исполнитель vs субагент — в policy, не в промпте | P0 | C+G |
| 5 | **Evidence Locker** — каждый finding = claim + hash + screenshot/pcap/listing + tool + command + ts + confidence + reproduction; отчёт без evidence не принимается | P0 | C+G |
| 6 | **Chrome isolator per engagement** — отдельный profile-dir/порт, kill-on-session-end | P0 | G (C согласен) |
| 7 | **Event log + Flight Recorder** — timeline model/tool/state с превью; кнопка «почему агент сделал X» | P0 | C+G |
| 8 | **Execution Timeline в GUI** — события с раскрытием (не чат-простыня) | P0/P1 | C |
| 9 | **Context Compiler с pins** (compaction не трогает pins) | P0 (30–60 день) | C+G |
| 10 | **Live coding loop** — LSP diagnostics + test runner + git worktree на задачу; дифф до apply | P1 | G |
| 11 | **IDA/Ghidra job API** — очередь analyze/decompile(ea)/xrefs/rename/comment/patch/export, структурированный JSON, артефакт в locker (не «агент тыкает GUI») | P1 | C+G |
| 12 | **Universal Artifact Graph** — sample.exe → sha256/PE/imports/strings/IDA db/скрины/findings/отчёт; finding → offset/функция/evidence | P1 | C |
| 13 | **Binary knowledge graph** — binary→functions→blocks→calls→strings→imports→xrefs→structures; запрос «find authentication flow» → subgraph (не 500KB дизассемблера) | P1/P2 | C |
| 14 | **Attack-path board в GUI** — граф хост→сервис→finding, клик открывает evidence | P1 | G |
| 15 | **Approval gates по risk_class** — mutate/exploit всегда human-in-the-loop с диффом команды | P1 | G |
| 16 | **Burp/ZAP adapter как provider seam** — scope из engagement, traffic → evidence | P1 | G |
| 17 | **Replayable lab** — snapshot VM/контейнера + скрипт воспроизведения шага | P1 | G |
| 18 | **Tool result compression** — raw / structured / LLM-summary / artifact-ref (280KB stdout → 3.2KB summary) | P1 | C |
| 19 | **Parallel tool execution** (strings/imports/sections/hashes/entropy одновременно) | P1 | C |
| 20 | **Model Router + Model Council** — задача→маршрут (cheap/reasoning/vision/coding/RE/verification); совет моделей с verdict/confidence/counterarguments (не весь контекст каждому) | P1/P2 | C |
| 21 | **Checkpoint/Undo** — «Restore execution», снапшот до патча/записи | P1/P2 | C |
| 22 | **Consultant bus** — внешние LLM (ChatGPT/Grok/…) как read-only советники: redacted brief + конкретный вопрос → recommendation/confidence/risks; без shell/fs/network (в будущем — capability-token: только read_artifact/query_binary_graph) | P1 | G (C: «согласен, но не навсегда») |
| 23 | **Metasploit/sliver — только в lab-netns**, RPC обёрнут, payload path в quarantine | P2 | G |
| 24 | **Parallel recon pipeline** — enum→validate→exploit-plan фазами, общая board с lock | P2 | G |
| 25 | **Time-travel session** — слайдер по JSONL + восстановление pins | P2 | G |
| 26 | **Signed skill bundle + внутренний marketplace** (SBOM, подпись) | P2 | G |

**UI-механики (Grok):** split «чат | terminal | evidence | attack-path»; индикатор lease/CDP/IDA; кнопка **Abort all children**; режим «голова только планирует».
**Автоматизации (Grok):** pre-engagement checklist (scope signed); post-engagement wipe CDP+tmp; nightly routing-eval по скиллам.

---

## 8. Разногласия и их разрешение (важно для истории)

| Тема | ChatGPT | Grok | Решение консенсуса |
|---|---|---|---|
| Execution Kernel | новый `packages/runtime`/`packages/execution` | «не плодить второй оркестратор»; реализовать как сервис `ctx.executions` поверх jobs+session+guard | **Принята позиция Grok**: сервис на существующем шве; спецификация ядра — по ChatGPT |
| Durable execution vs session | «важнее durable session» | «почти, но не вместо»: нужны оба лога + связка turn_id↔execution_id | **Оба лога** (SessionEvent + ExecutionEvent) |
| Session header snapshot | согласен, но: registry+artifact store, а не свалка в header | header содержит identity+recovery metadata | **External Resource Registry** как отдельная сущность |
| SkillScore 8 метрик | сразу | сначала 3 (routing-hit, contract-pass, evidence-complete) | **Сначала 3**, остальное на 60–90 |
| Routing eval 75+ кейсов | не фиксировать число | (поддерживает идею) | **Per-skill размер** набора + regression corpus |
| Context budget 118K | пример-константа | бюджет per layer + per model window | **Per layer + per model window**, ENGAGEMENT/TASK не выкидываются |
| Model Router в 30 дней | часть roadmap | сначала жёсткий policy-split, роутер — после typed Task/Report | **После зелёного recovery** и контракта |
| Consultant bus read-only | да, но не фундаментально — capability-token в будущем | read-only обязательно | **v1: read-only**; v2: capability-based (только read_artifact и т.п.) |
| Durable execution «после kill» | да | да (R1-тупик) | Общий P0 |

---

## 9. ДОРОЖНАЯ КАРТА 0–30 / 31–60 / 61–90 (объединённый план)

### Дни 0–30 — стабильность, минимальный риск (фундамент)
1. Закоммитить WIP или вынести cordis.patch.yml / ui-settings-claude-code в profile overlay (bundle).
2. **Execution state machine** как сервис `ctx.executions` поверх jobs/session/guard: статусы, `INTERRUPTED→RECOVERING`, идемпотентность, parent/child, timeouts, retry.
3. **External Resource Registry + orphan reconciler**: jobs/PTY/Chrome/subprocess-tree получают lease + owner + heartbeat; reconcile из SQLite после краша.
4. Freeze plugin graph на время turn + **tool-schema snapshot на attempt**.
5. **Single-writer / Session Command Queue**.
6. **Tool-split оркестратора в policy** (голова не вызывает nmap/idat напрямую).
7. **Engagement stub**: scope-файл + deny network вне allowlist.
8. Тесты: crash-restart mid-job, replay сессии, unload плагина mid-turn.
9. Auto-improve скиллов в проде **не трогать**.

### Дни 31–60 — оркестр и скиллы как продукт
1. **Typed Task/Report контракт** голова↔исполнитель (owner/budget/lease → status/evidence[]/mutations[]).
2. **Event log + Flight Recorder** (ExecutionEvent, replay #123); GUI «живой мониторинг» читает тот же поток.
3. **Context Compiler**: Session log + pins + artifact manifest + task state; compaction с pin-list; бюджеты per layer.
4. **Routing eval + contract tests** для 5 боевых скиллов (hakker-kibborg, ida-professional, reverse-engineering, tor-web-search, tunerpro-xdf-engineer).
5. Progressive disclosure каталога скиллов (id+trigger в каталоге).
6. **Evidence Locker + correlation-id** в GUI.
7. **CDP per-engagement** (isolator).
8. SkillScore v1: 3 метрики; auto-improve гейт (routing+contract).

### Дни 61–90 — «турбо без самоубийства»
1. **Attack-path board** + **approval gates по risk_class**.
2. **IDA/Ghidra job API** вместо GUI-кликов (структурированные результаты).
3. **Lab profile**: netns / E2B как нормальный provider (не POC рядом); sandbox-seam по профилям.
4. **Engagement Mode** полный: Capability Broker → Policy → Tool, audit, rate limits.
5. **Consultant bus** для внешних LLM (read-only, redacted brief).
6. **Time-travel по логу**; восстановление pins.
7. Внутренний **signed skill bundle**.
8. Model Router (после typed Task/Report).

### Критерии успеха через 90 дней (Grok, приняты обоими)
- сессия переживает рестарт хоста и продолжает работу;
- голова **не может** вызвать nmap/idat напрямую (policy);
- скилл не публикуется без routing-eval;
- pentest-тулы молчат без активного ROE/engagement.

---

## 10. ЧТО НЕ ДЕЛАТЬ (оба консультанта единодушны)

- ❌ ещё 20 типов субагентов; ❌ ещё 50 скиллов «вширь»; ❌ сложная memory database / RAG ради RAG;
- ❌ гигантская система самоулучшения; ❌ новый UI ради UI; ❌ ещё один workflow DSL; ❌ бесконечное расширение tool catalog;
- ❌ подключать Metasploit/Burp-боевые интеграции и открывать marketplace **до** leases + policy matrix + ROE;
- ❌ полагаться на промпт-запреты вместо policy;
- ❌ auto-improve скиллов на проде без freeze eval.

Правильная последовательность (ChatGPT): `reliability → execution kernel → observability → context → security → features`. Сейчас «more features → complexity↑ → reliability↓».

---

## 11. Синтез головы проекта (моя позиция как третьего участника)

1. **Проект здоров**: два независимых эксперта подтвердили архитектурную правильность (Cordis + seams + durable session + skill-платформа). Оценки 6.5–9/10 — это «сильная база, незакрытые границы», а не «переделывать».
2. **Ближайший спринт — runtime hardening**, а не фичи: state machine на существующем шве, resource leases + fail-closed replay, tool-schema snapshot, single-writer, WIP-коммит. Это ровно закрывает «R1-тупик сессий» из HANDOFF.
3. **Оркестратор голова/исполнитель переводим с промпт-правил на policy-контракт** (typed Task/Report + запрет heavy tools голове) — это уберёт класс деградаций «голова доделывает за исполнителя».
4. **Скиллы**: не расширяем каталог, а добавляем обязательные risk_class/engagement_bound/routing-гейт 5 боевым скиллам; progressive disclosure в каталоге.
5. **Пентест/RE-контур** (hakker-kibborg, IDA, tor) получает Engagement Mode + Evidence Locker как обязательную обвязку до любых новых боевых интеграций.
6. **Consultant bus** — уже сейчас опробован вживую этой сессией (ChatGPT+Grok через CDP) и подтвердил ценность; оформить как read-only сервис с redacted brief.
7. Внедрение по roadmap §9; первый отчёт-контроль — через 30 дней по критериям: crash-restart тест зелёный, replay сессии с внешними ресурсами работает fail-closed, WIP закоммичен.

---

## 12. Артефакты сессии

- `PROJECT_LLM_BRIEF.md` — бриф проекта (корень), передан консультантам.
- `.artifacts/consensus_chatgpt_raw.txt` — полный ответ ChatGPT на ТЗ.
- `.artifacts/consensus_grok_raw.txt` — полный ответ Grok на ТЗ.
- `.artifacts/consensus_chatgpt_cross.txt` — кросс-рецензия ChatGPT на тезисы Grok.
- `.artifacts/consensus_grok_cross.txt` — кросс-рецензия Grok на тезисы ChatGPT.
- `.artifacts/consensus_notes.md` — конспекты всех ответов.
- `graphify-out/` — обновлённый граф проекта (43 534 узла, 82 125 рёбер, 06.09.2026).
