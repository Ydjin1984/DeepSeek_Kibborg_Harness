# ACTION PLAN — DeepSeek_Kibborg_Harness (спринт Runtime Hardening)

**Статус:** активен · **Старт:** 06.09.2026 · **Основа:** `CONSENSUS_REPORT.md` (консенсус ChatGPT + Grok + голова проекта)
**Советчики (постоянные):** Grok (grok.com) · ChatGPT (chatgpt.com) — доступ через Chrome CDP `127.0.0.1:9222`
**Исполнитель тяжёлой работы:** киборг Kibborg_Flash_v5.7 (executor, локальный, с vision)

---

## 0. Правила работы (операционные)

1. **Порядок изменений:** сначала вносим ВСЕ фичи батча → потом **одна сборка бинарника** (`pnpm run build` + `build:web` при изменении GUI) → **только потом перезапуск сервера** (`run.bat` / прогресс-бар, порт 3080). Никаких перезапусков на каждую правку.
2. Тяжёлые/токенозатратные процессы (исследование кодовой базы, массовые чтения, длинные команды) — киборгу через `executor` одним самодостаточным заданием.
3. Каждый архитектурный вопрос — **обоим советчикам одновременно** (Grok + ChatGPT), ответы сравниваются, применяется вариант с большей поддержкой (при равенстве — тот, что меньше ломает существующее).
4. После каждой фичи — зелёные тесты (`pnpm test` по затронутым пакетам / snapshot), перед коммитом — pre-commit хуки (lefthook).
5. Коммиты атомарные, conventional: `feat|fix|refactor|test|docs|chore`.
6. Статусы тасков обновляются в этом файле (`[ ]` / `[x]`).

---

## 1. Спринт 0–30 дней — Runtime Hardening (фундамент)

> Консенсус: `reliability → execution kernel → observability → context → security → features`.
> Не растить каталог скиллов и не подключать Metasploit/Burp до leases + policy matrix + ROE.

### T1 ✅ WIP → коммиты (выполнено 06.09.2026)
- [x] `feat(client): add ui-settings-claude-code ECC skills settings tab` (21 файл, +1726)
- [x] `chore(run): autostart local Tor with dev server`
- **Чек-лист:** lint staged — 0 warnings/errors · lefthook pre-commit зелёный · `THIRD_PARTY_NOTICES.md` обновлён.
- **Статус:** done (коммиты `1f1d4e6af3`, `496053de86`; ahead 16).

### T2 ⏳ Execution state machine как сервис на существующем шве
**Цель:** единый владелец жизненного цикла для jobs/subagents/goals/workflows/tools без нового пакета-монолита (позиция Grok после рецензии; спецификация — ChatGPT).
- [x] **Решение T2-v1 (ПОЛНЫЙ консенсус ChatGPT+Grok):**
  1. **Новый малый пакет `packages/execution/execution`** (`@deepseek-ai/dsh-execution`), рядом с jobs/, НЕ core, НЕ jobs. Service Definition + in-process store + event log; inject: sessions (для turn_id). Execution НЕ импортирует jobs/goal/workflow/subagent. Зависимости только вниз: `jobs|goal|workflow|subagent|guard → execution`. agent-loop читает ctx.executions.
  2. **v1 = проекция/наблюдение:** register/observe от адаптеров, нормализация статусов в единую SM, `execution_id + parent_execution_id + attempt`, append-only ExecutionEvent, заготовка lease/resource_ref. **БЕЗ** `start/pause/cancel` на ctx.executions (иначе competing control planes с JobRegistry.kill/goal pause/workflow cancel).
  3. **Без миграции контрактов:** JobStatus/GoalPhase/WorkflowStopReason не трогаем; маппинг внутри адаптеров (10-20 строк, живут в существующих пакетах): `jobs.running→RUNNING, killed→ABORTED, TOOL_TIMEOUT→TIMEOUT, blocked→WAITING_USER`; сохранять original status + normalized status (ExecutionStatus=WAITING_USER + reason="goal_paused" + source_status="paused").
  4. Инвариант v1 (Grok): одно OS-действие = один execution_id; дочерний subagent = parent_execution_id; session пишет только turn_id.
- [x] **Реализовано (коммит 8a89e561b1):** пакет `packages/execution/execution` — типы (ExecutionStatus/Kind/State/Event/Ref), чистая state machine (state-machine.ts, таблица переходов + ExecutionTransitionError INVALID_TRANSITION, 60 тестов), registry (register/transition/end/get/list/listByKind/on/off, append-only ExecutionEvent log, deep-copy наружу), ExecutionService (ctx.executions, Cordis-событие `execution/event`), invariant-компаньон, README. Адаптер `jobs/src/execution-adapter.ts` (projection: register→start→complete/fail/abort; stopping пропускается до терминала; идемпотентно; optional через ctx.get). Регистрация: tsconfig.base paths, tsconfig.host reference, pnpm-lock. 101 тест execution + jobs зелёные; coverage-гейт 100% per-file; lint clean.
- [ ] Адаптеры goal/workflow/subagent — следующие итерации после стабилизации v1 (проекция их статусов в ту же SM).
- [ ] Риск-осведомлённость SM (RUNNING→WAITING_TOOL при risk=exploit → WAITING_USER) — совместно с T6/T7 (policy/engagement).
- **Статус:** v1 реализован и закоммичен; следующий шаг — T3 (resource registry на базе execution).

### T3 External Resource Registry + leases + orphan reconciler
**Цель:** сессия знает про внешние ресурсы (Chrome CDP, PTY, IDA, sandbox, subprocess-tree) и восстанавливается fail-closed.
- [x] **Q1 решён (консенсус ChatGPT+Grok):** registry — **внутренний модуль execution-сервиса** `ctx.executions.resources` (НЕ отдельный пакет, НЕ session). Session хранит только durable events (`resource.created/lease/released/orphaned/reconciled`); провайдеры chrome/pty/ida остаются своими пакетами; registry — учёт + orphan-sweep.
- [x] **Реализовано (коммит fa30951208):** `src/resources.ts` — ResourceLeaseRegistry: `acquire` (renew при leased), `heartbeat` (продлевает expiresAt), идемпотентный `release`, чистые fail-closed `status()`/`isLive()` (live/expired/released/orphaned/unknown), идемпотентный `sweep(now?)` (leased→orphaned один раз), `get`/`list` (deep copies), typed Cordis-событие `executions/resource`, ResourceError с кодами (RESOURCE_NOT_FOUND/NOT_LEASED/UNKNOWN). Экспонирован как `ctx.executions.resources`. Детерминированные тесты через now-инъекцию.
- [ ] **v2 (durable):** resource-события в session-лог (`resource.created/lease/released/orphaned/reconciled`) + orphan reconciler из SQLite после краша (fail-closed: нет подтверждённого lease → `INTERRUPTED` + вопрос человеку).
- [ ] Провайдеры (chrome/pty/ida) начинают вызывать acquire/heartbeat/release на своих ресурсах.
- **Статус:** v1 реализован и закоммичен; v2-durable — следующий срез (вместе с durable ExecutionEvent).
- **Пример (запись ресурса):**
  ```json
  {
    "resource_id": "chrome_17",
    "type": "chrome",
    "provider": "cdp",
    "endpoint": "127.0.0.1:9222",
    "owner_execution": "exec_7821",
    "lifecycle": "leased",
    "lease": { "ttl_ms": 300000, "heartbeat_at": "..." },
    "state": "unknown",
    "recovery_strategy": "reconnect_or_recreate"
  }
  ```
- **Статус:** pending (проектирование — после T2; Q1 решён, см. журнал).

### T4 Tool-schema snapshot на attempt + freeze plugin graph на turn
**Цель:** убрать гонку «tool ещё в схеме модели, provider уже мёртв» (rc-риск №2).
**Точки внедрения (киборг):** `packages/core/agent-loop/src/agent.ts` — `buildRequest()` стр. 429 (после сборки `header.tools` стр. 484, до `deepFreeze` стр. 508), `step()` стр. 335 (до `llm.stream()` стр. 349). Объём S, риск низкий.
- [x] **Решение T4 (консенсус советников: ChatGPT «(a) + лёгкий (c), не (b)»; Grok «(a) как контракт + узкий pin, не полный freeze»):** вариант (a) — сверка перед dispatch с детерминированным отказом.
- [x] **Проверка кода:** вариант (a) **уже реализован** — `dispatchToolBody` (packages/core/tools/src/index.ts:1546) делает `resolveExecution` → `ToolNotFoundError` (код `UNKNOWN_TOOL`), детерминированный результат через `toolErrorResult`; разрыв prepare→dispatch закрыт. Сценарий «unregistered between binding and dispatch» покрыт тестом `packages/core/tools/tests/code-mode.spec.ts:592`.
- [ ] **T4b (дыра Grok, отложено):** «tool есть в реестре, но это другой provider после HMR (та же key, другой exec)» — dispatch «успешен» с другим поведением. Закрывается каноном turn: schema_epoch + `{name, plugin_id, impl_hash}` в request/header + сверка в dispatch → `TOOL_SCHEMA_STALE`. Требует идентичности плагина у ToolDefinition — M-объём, после фундамента.
- [ ] Наблюдаемость (c-лёгкий): телеметрия отказов `UNKNOWN_TOOL` после снимка схемы (лог/счётчик).
- **Статус:** (a) подтверждён тестами; T4b отложен — см. журнал решений.

### T5 Single-writer / Session Command Queue
**Цель:** устранить гонки записи session (агент A + агент B + compactor + GUI projection + job).
- [x] **Q2 решён (консенсус ChatGPT+Grok):** Session Command Queue **внутри session-пакета** (actor-модуль не нужен). Один writer на session_id: `enqueue command → serial apply → commit JSONL+SQLite → ack`. **Правило: session queue ≠ execution queue** — два журнала, два single-writer, связь `turn_id ↔ execution_id` (Grok).
**Точка внедрения (киборг):** `packages/session/session-persistence/src/coordinator.ts` — `PersistenceCoordinator.append()`; риск средний (write-behind batching). Объём M.
- [x] **Аудит durability (киборг, 06.09):** оценка **8/10**. Уже есть: SQLite `synchronous=FULL` + WAL (schema.ts:178), fsync после каждого JSONL-append + rollback partial (session-persistence-jsonl appendLines:651-679), torn-tail recovery + truncate-to-last-valid-seq + synthetic closers (format.ts:341-378, commitRepair), атомарный materialize (link+syncDir POSIX / write-through Win32), **single-writer уже реализован** — per-id promise chain `PersistenceCoordinator.chains` (coordinator.ts:601, serialize:1010). Crash-тесты уже есть: jsonl.spec (crash recovery, committed never rewritten, failed append truncates), sqlite.spec (corruptTail, WAL), crash-recovery.e2e.ts (checkpoint-policy).
- [ ] **Deferred (зафиксировано, НЕ внедрять сейчас):** syncDir на каждый append (перф-удар на POSIX, Win32 не выигрывает — write-through); WAL checkpoint(TRUNCATE) при close (гигиена, не durability; хрупкий тест sidecar); `autoFlushOnCriticalEvent` (M, средний риск — поведенческое изменение timing). Окно потери write-behind 200ms — осознанный компромисс.
- [ ] Реальный gap (для T8): e2e-уровень kill mid-write на ЖИВОМ процессе (unit-покрытие обрыва есть, процессного — только session-checkpoint-policy crash-recovery e2e).
- **Статус:** single-writer подтверждён существующим кодом; оставшийся gap — процессные kill-тесты (T8).

### T6 Policy-split оркестратора (голова без heavy tools)
**Цель:** запрет голове на nmap/idat/тяжёлые цепочки — в `ctx.tools` policy, а не текстом в промпте.
**Точки внедрения (киборг):** `packages/context/orchestrator/src/index.ts` (tool `executor` стр. 193-247, `delegationDepthOf()` стр. 239); waterfall `tools/pre-execute` (до approval; образец регистрации — guard/timeout-policy `tools/execute`).
- [x] **Решение T6-v1 (консенсус: оба против tools.restrict на scope головы — наследование сожрёт тулы executor):**
  1. **Enforcement** (оба): listener на `tools/pre-execute`: `delegationDepth === 0 && tool ∈ headDenyTools` → `deny` СРАЗУ (до ask/approval/guardReason — approval не должен разрешать запрещённое); детерминированный отказ. depth ≥ 1 (executor) — не трогаем.
  2. **Видимость** (Grok, defense-in-depth к T4): на preStep/schema snapshot для depth 0 heavy-тулы не попадают в схему модели (голова физически не выбирает то, чего нет в снимке); executor (depth 1) — полная схема. НЕ через tools.restrict (наследование), а фильтрацией схемы по роли.
  3. **Конфиг** (оба): deny-list `headDenyTools` в конфиге пресета оркестратора (cordis.yml, профиль/bundle) — рядом с тем, что задаёт голову/исполнителя; session может только сузить (добавить deny), не расширить. Терминология — executionPolicy (ChatGPT); не размазывать по permission-preset sandbox/approval.
  4. **НЕ трогать** ToolDefinition.risk в v1 (класс риска — T7/engagement, Grok).
- [x] Исследовать API регистрации waterfall-listener `tools/pre-execute` (образец: guard/timeout-policy `tools/execute`; тип PreToolDecision).
- [x] **Реализовано (коммит d612296395):** `src/policy.ts` — чистая `headToolDeny(agent, toolName, denySet)` (depth 0 + в списке → model-facing reason; depth ≥ 1 и не-агенты не ограничиваются). `src/index.ts`: поле настроек `headDenyTools: string[]` (schema + base, default []); live listener на `tools/pre-execute` монтируется при enabled + непустой список, снимается при выключении/teardown; deny ДО approval. Тесты: policy.spec (unit) + composition.spec (waterfall: depth 0 → deny, depth 1 → allow, повторный sync не дублирует, teardown снимает). 23 теста, coverage 100%, lint clean, полный typecheck/build зелёные, сервер перезапущен.
- [ ] **Отложено (видимость схемы, Grok-слой 2):** heavy-тулы не попадают в схему depth-0 на preStep (defense-in-depth к T4). Требует фильтрации tool-provider по роли агента — после стабилизации enforcement.
- **Статус:** enforcement реализован и закоммичен; видимость схемы — отложенный пункт.

### T7 Engagement stub
**Цель:** scope-файл + deny сети вне allowlist (минимальный ROE, до полного Engagement Mode).
- [x] **Реализовано (коммит 123ff0c26d):** новый пакет `packages/guard/engagement-stub` (`@deepseek-ai/dsh-engagement-stub`). Плагин с Config `{enabled (default false), allowedHosts[], blockedTools[] (default nmap/metasploit/msfconsole/nc/netcat)}`. При enabled: listener на `tools/pre-execute` (до approval) → чистая `engagementDecision`: blockedTools всегда deny; URL-подобные аргументы (url/endpoint/host/target/uri/domain/link/input) хост-извлекаются (protocol/port/path/userinfo стрипятся, IPv6 brackets), localhost/127.0.0.1/::1 всегда allow, иначе точное совпадение с allowlist; без URL — fail-open. Deny → audit-событие `engagement/denied` + logger.warn. 53 теста, coverage 100%, lint clean; полный build и рестарт сервера.
- [ ] **Дальше (к 61-90-дневному Engagement Mode):** scope-файл (CIDR/порты/тайм-окна/rate limits) вместо плоского списка хостов; интеграция с T6-политикой оркестратора; UI-статус контура.
- **Статус:** stub реализован; полный Engagement Mode — спринт 61-90.

### T8 Crash/restart тесты
- [x] **Q3 решён (при 1:1 выбрана позиция Grok — фундаментальнее):** порядок — (1) **kill mid-write session** (сначала укрепить запись: fsync + атомарный rotate + «хвост битый = truncate до последнего валидного seq» — иначе порванный JSONL/SQLite не даст стартовать recovery), (2) kill mid-tool (lease + fail-closed: tool не COMPLETED → execution INTERRUPTED → повтор идемпотентен), (3) kill mid-subagent (граф parent/child). От ChatGPT принята методология: **crash injection по durable boundaries** (`BEFORE_START / AFTER_START / AFTER_SIDE_EFFECT / BEFORE_COMMIT / AFTER_COMMIT`), не произвольный process.kill.
- [x] **Реализовано:** `kill-mid-write.e2e.ts` + `fixtures/mid-write-child.ts` (коммит 425162bbff): режимы `queued` (события в write-behind очереди при kill — теряются by design, лог остаётся loadable+appendable) и `flushed` (checkpoint-policy события выживают, interrupted turn закрывается синтетическим turn/end). skipIf(win32) как crash-recovery; исполняется на POSIX CI. Vitest: компиляция чистая.
- [ ] Дальше (по мере готовности T2/T3): C2 kill mid-tool → execution INTERRUPTED + идемпотентный retry; C8 kill mid-subagent (parent/child граф).
- **Статус:** первый сценарий (kill mid-write session) реализован и закоммичен.

---

## 2. Спринт 31–60 дней (после зелёного фундамента)

- Typed Task/Report контракт голова↔исполнитель: `{owner, budget, workspace_lease, allowed_skills[]} → {status, evidence[], mutations[]}`.
- Event log + Flight Recorder (ExecutionEvent: `{seq, ts, execution, type, tool, input_hash, output_ref, duration_ms}`; связка `turn_id↔execution_id`; replay #123).
- Context Compiler: Session log + pins + artifact manifest + task state; compaction не трогает pins; бюджеты per layer.
- Routing eval + contract-тесты для 5 боевых скиллов (hakker-kibborg, ida-professional, reverse-engineering, tor-web-search, tunerpro-xdf-engineer); SkillScore v1 (3 метрики: routing-hit, contract-pass, evidence-complete).
- Progressive disclosure каталога скиллов; Evidence Locker + correlation-id в GUI; CDP per-engagement (isolator).

## 3. Спринт 61–90 дней («турбо без самоубийства»)

- Attack-path board + approval gates по risk_class; IDA/Ghidra job API; Lab profile (netns/E2B как provider).
- Engagement Mode полный (Capability Broker → Policy → Tool, audit, rate limits); Consultant bus (read-only, redacted brief).
- Time-travel по логу; signed skill bundle; Model Router (после typed Task/Report).

---

## 4. Процедура вопросов советчикам

1. Вопрос формулируется одинаково для Grok и ChatGPT (компактно, с контекстом).
2. Ответы сохраняются в `.artifacts/consult_*.txt`.
3. Сравнение: таблица «тезис → Grok → ChatGPT → решение»; при расхождении выбирается вариант с большей поддержкой/меньшим риском; решение фиксируется в этом файле и в `.artifacts/consensus_notes.md`.
4. Критичные решения дополнительно проверяются на кодовой базе киборгом.

## 5. Чек-лист сборки и запуска (правило «фичи → бинарник → рестарт»)

```powershell
# 1) Все фичи батча внесены и покрыты тестами
pnpm test                 # unit по затронутым пакетам (или pnpm run test:coverage для гейта)
pnpm run typecheck        # tsc -b
# 2) Сборка
pnpm run build            # tsc lib + tsdown bundle
pnpm run build:web        # Vite frontend (если менялся client/)
# 3) Только теперь перезапуск сервера (порт 3080)
#    run.bat  или  pnpm run dev:web   (управление: progress.ps1)
```

---

## 6. Журнал решений

| Дата | Вопрос | Решение |
|---|---|---|
| 06.09.2026 | WIP-состояние | Закоммичено атомарно (T1) |
| 06.09.2026 | Q1: размещение Resource Registry | **Консенсус:** внутренний модуль execution-сервиса `ctx.executions.resources`; session — только durable events; шов `acquire/heartbeat/release/reconcile/get` |
| 06.09.2026 | Q2: single-writer | **Консенсус:** Session Command Queue в session-пакете (`coordinator.ts`); actor не нужен; session queue ≠ execution queue |
| 06.09.2026 | Q3: первый crash-тест | **Grok (при 1:1, фундаментальнее):** mid-write session → mid-tool → mid-subagent; + crash injection по durable boundaries (ChatGPT); чек-лист C1–C10 |
| 06.09.2026 | Точки внедрения T2/T4/T5/T6 | Исследование киборгом: agent.ts buildRequest/step (T4), coordinator.ts append (T5), user-approval request() + orchestrator executor (T6), шаблон ApprovalService (T2) |
| 06.09.2026 | T4: вариант реализации | **Консенсус (a)**: сверка перед dispatch, детерминированный отказ; полный freeze (b) отклонён обоими. Проверка кода: (a) уже реализован (dispatchToolBody:1546 + тест code-mode.spec.ts:592). T4b (provider-swap после HMR → TOOL_SCHEMA_STALE) отложен до фундамента |
| 06.09.2026 | T5-фундамент: durability записи | **Аудит: 8/10, single-writer и crash-recovery уже реализованы.** Deferred: syncDir per append, WAL checkpoint при close, autoFlush. Gap: процессные kill-тесты (T8) |
| 06.09.2026 | T8: kill mid-write тест | **Реализован** kill-mid-write.e2e.ts (queued+flushed), коммит 425162bbff; skipIf(win32), исполняется на CI |
| 06.09.2026 | T2: размещение/объём ctx.executions | **ПОЛНЫЙ консенсус**: новый тонкий пакет packages/execution/execution; v1 = проекция (registry+status+event log), без управления; адаптеры в существующих пакетах без миграции контрактов |
| 06.09.2026 | T2-v1 реализован | Коммит 8a89e561b1: пакет execution (SM+registry+service+invariant), адаптер jobs; 101+ тест, coverage 100%, lint clean |
| 06.09.2026 | T3-v1 реализован | Коммит fa30951208: ResourceLeaseRegistry (acquire/heartbeat/release/sweep/status/isLive), ctx.executions.resources; 137 тестов, coverage 100%; durable v2 — следующий срез |
| 06.09.2026 | Сборка + рестарт сервера | Полный build зелёный (после TS-фиксов тестов, коммит 2d8a1684e1); сервер на 3080 перезапущен супервизором, HTTP 200 |
| 06.09.2026 | T6: механизм policy-split | **Консенсус**: НЕ tools.restrict (наследование); enforcement на tools/pre-execute до approval (depth 0 × headDenyTools → deny) + видимость-фильтр схемы для depth 0; deny-list в конфиге пресета оркестратора |
| 06.09.2026 | T6 реализован | Коммит d612296395: policy.ts + headDenyTools listener (enforcement до approval); видимость схемы — deferred; build+рестарт сервера зелёные |
| 06.09.2026 | T7 реализован | Коммит 123ff0c26d: пакет engagement-stub (blockedTools + allowlist-хостов, deny до approval, audit engagement/denied); 53 теста, coverage 100%; полный Engagement Mode — 61-90 дни |
| 06.09.2026 | Интеграция в base bundle | Коммит 4e46160d5c: execution + engagement-stub в base patch; jobs-адаптер активирован в LocalJobRegistry (ленивый ctx.get в колбэке — mount order) |
| 06.09.2026 | **Boot-fix (урок!)** | Коммит 30f5bdb69b, фикс Grok: Service-класс в прод-дереве НЕ должен `inject: ['invariants']` (диагностика — только companion ./invariant; в проде нет invariants-сервиса → pending → boot abort на :3080). Тесты «прятали» это, монтируя InvariantRegistry. Плюс: **манифест бандла (base/package.json) обязан содержать все пакеты из его cordis.patch.yml** (patch без manifest-записи ломает профиль). Добавлен регресс-тест «activates without the invariants service». Agent Note: `2026-09-07-execution-plugin-must-not-inject-invariants` (c1d55dff90) |
| 07.09.2026 | Адаптеры → execution SM | **Все 4 готовы**: jobs (активация 4e46160d5c, тесты 58f48babd0), goal (23529f2c8e), workflow (765cf3fea4), subagent (6ed4c3e042). Единый пульт видит задачи, цели, потоки и субагентов. Coverage 100% на адаптерах; сборки зелёные; сервер перезапущен; GUI-проверка без регрессий |

## 7. Уроки (инварианты, выявленные на практике)

1. **Прод-сервис ≠ диагностика:** Service-класс, монтируемый в шиппинг-композицию (base/web-app), может inject только реальные прод-сервисы. `invariants`-регистр существует лишь для companion `./invariant`; inject его в продукт = `pending (waiting for service)` → abort boot. В unit-тестах НЕ маскировать отсутствующие прод-сервисы ручным монтажом — тестировать активацию без них.
2. **Манифест бандла:** каждый плагин в `cordis.patch.yml` бандла должен быть в `dependencies` его `package.json` (frozen-lockfile CI и composition падают иначе).
3. **Ленивое разрешение optional-сервисов:** адаптер, зависящий от optional-сервиса, резолвит `ctx.get(name)` в момент использования (на каждый коммит/событие), а не при регистрации — порядок монтирования плагинов topology-driven и недетерминирован.
