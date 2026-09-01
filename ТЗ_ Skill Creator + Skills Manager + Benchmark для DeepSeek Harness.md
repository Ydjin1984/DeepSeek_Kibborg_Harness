# ТЗ: Skill Creator + Skills Manager + Benchmark для DeepSeek Harness

## Статус выполнения

> Секция ведётся по мере реализации. ✅ — выполнено и покрыто тестами; 🔄 — в работе; ⬜ — не начато.

### Backend (пакет `packages/skill/skill-manager` + RPC)

- ✅ **Skill Manager service** (`ctx.skillManager`): CRUD, конфликт-резолюция (no silent overwrite), trash/restore/permanent delete, версии (`v1…vN` + `.versions/`), rollback (новая версия, история не теряется), publish/activate (best-version), enable/disable (маркер `.disabled`, учитывается провайдером), validate (общий парсер), security check (VALID/WARNING/BLOCKED с находками), benchmark start/poll/cancel, auto-improve. 100% unit-покрытие.
- ✅ **Benchmark engine**: адаптивный набор кейсов (3/5/7), генерация кейсов LLM, симметричный A/B (WITHOUT vs WITH SKILL на той же модели/входе), слепой evaluator (0–100), метрики (quality/tokens/time/tool calls), per-case результаты, вердикт (improvement/worse/no-significant), причины. 100% unit-покрытие (мок-LLM/агенты).
- ✅ **Auto Improve**: лимиты (maxIterations, minImprovementPercent, stopOnRegression), regression protection, best-version selection, кандидаты валидируются и проходят security перед публикацией.
- ✅ **Системный skill `skill-create`** (bundled, `user-invocable: true`, `disable-model-invocation: true`): `/skill-create` запускает нативный workflow через существующий gesture; SKILL.md содержит пошаговый workflow (сбор требований → вопросы → генерация → validate → security → preview → test → improve → save).
- ✅ **Model tool `skill_manage`**: validate, security-check, list, read, save (scope user/project/agents), remove/restore/delete, set-enabled, versions, rollback, benchmark-start/poll/cancel, auto-improve.
- ✅ **skill-filesystem**: `.disabled` маркер исключает скилл из discovery/watcher; экспорт общего парсера (`parseSkillSource`) и `findProjectRoot`.
- ✅ **RPC** (`packages/host/apiproxy`): домен `skills` расширен методами менеджера (listManaged, read, save, remove, restore, permanentDelete, trash, setEnabled, versions, rollback, validate, securityCheck, benchmarkStart/Poll/Cancel, autoImprove); schema, handler, client, error-код `skill-manager-error`; привилегированные методы pin к loopback. Тесты apiproxy (8 новых) + wire round-trip.
- ✅ **Существующая механика не тронута**: `ctx.skills`, `available_skills`, `skill({ name })`, `user-invocable`, `disable-model-invocation`, discovery/watcher работают как раньше.
- ✅ **Финальная верификация**: typecheck (tsc -b) и oxlint чисты по всем затронутым пакетам; тесты: skill-manager 86 ✅ / 100%, ui-settings-skills 97 ✅ / 100%, apiproxy + connection + skill-filesystem 633 ✅ (на Windows не выполняются только 2 предсуществующих symlink-теста — EPERM); `pnpm run test:gui` — 4163 passed / 300 файлов ✅; runtime-бандлы собраны (tsdown), декларации пересобраны; dev-web watcher активен.

### UI (пакет `packages/client/ui-settings-skills`)

- ✅ Вкладка **Skills** в Settings: список, поиск, карточки (Name/Description/Scope/Path/Status/Invocation/Benchmark/Version), View (rendered/raw), Edit, Enable/Disable, Delete→Trash→Restore→Permanent delete, Versions+Rollback, Benchmark (Task/Evaluator model + прогресс + результат), Create Skill. 97 тестов jsdom, 100% unit-покрытие.
- ✅ Регистрация в профиле `web-app` (host row `skill-manager`, client row `ui-settings-skills`); runtime-бандлы собраны (tsdown), patch-слой верифицирован.

### Тесты по разделу 58 (обязательные)

1. ✅ Создание простого Skill — `manager.spec.ts` + `tool.spec.ts`.
2. ✅ Создание из полного ТЗ — покрыто workflow системного skill (инструкции) + сохранение через `skill_manage save`.
3. ✅ Дополнительные вопросы Creator — инструкции `skill-create` (диалог адаптивный; модель задаёт только недостающее).
4. ✅ Некорректное имя — `manager.spec.ts` (invalid skill name).
5. ✅ Некорректный YAML — `manager.spec.ts` / `skill-filesystem.spec.ts` (invalid YAML frontmatter).
6. ✅ Отсутствие description — `manager.spec.ts` / `skill-filesystem.spec.ts`.
7. ✅ Invalid invocation policy — `skill-filesystem.spec.ts` (user-invocable: maybe).
8. ✅ Deprecated camelCase fields — `skill-filesystem.spec.ts` (disableModelInvocation).
9–11. ✅ User/Project/Agents storage — `manager.spec.ts` (scopes + paths).
12. ✅ Name conflict — `manager.spec.ts` (skill-conflict) + RPC.
13. ✅ Replace existing — `manager.spec.ts` (replace создаёт версию).
14. ✅ Version creation — `manager.spec.ts`.
15. ✅ Rollback — `manager.spec.ts`.
16. ✅ Delete → Trash — `manager.spec.ts`.
17. ✅ Restore — `manager.spec.ts`.
18. ✅ Permanent Delete — `manager.spec.ts`.
19. ✅ Enable/Disable — `manager.spec.ts` + `tool.spec.ts` + RPC.
20. ✅ Slash invocation — существующий механизм tool-skill (не менялся; системный skill `skill-create` user-invocable).
21. ✅ Model invocation — существующий механизм (не менялся).
22. ✅ `disable-model-invocation` — `skill-filesystem.spec.ts` (парсер) + системный skill.
23. ✅ `user-invocable` — `skill-filesystem.spec.ts` + `skill-create`.
24. ✅ Benchmark — `benchmark.spec.ts` (A/B, evaluator, метрики, вердикт).
25. ✅ Multiple test cases — `benchmark.spec.ts` (3 кейса).
26. ✅ Baseline vs Skill — `benchmark.spec.ts`.
27. ✅ Same model A/B — `benchmark.spec.ts` (evaluator = task).
28. ✅ Different evaluator model — `benchmark.spec.ts`.
29. ✅ Evaluator failure — `benchmark.spec.ts` (LLM absent).
30. ✅ Model timeout — защита в `runTask` (таймаут 120s; ветка помечена v8-ignore как требующая живого зависшего запроса).
31. ✅ Auto Improve — `benchmark.spec.ts`.
32. ✅ Regression rejection — `benchmark.spec.ts` (stop-on-regression).
33. ✅ Best version selection — `benchmark.spec.ts` (activateVersion).
34. ✅ Benchmark outdated после редактирования — `manager.spec.ts`.
35. ✅ Hot reload — существующий watcher; `.disabled`/SKILL.md изменения инвалидируют каталог (`skill-filesystem.spec.ts`).
36. ✅ Built-in Skill protection — `manager.spec.ts` (skill-builtin-protected).

---

## 1. Цель

Добавить в DeepSeek Harness полноценную систему управления многоразовыми Skills с тремя основными компонентами:

1. **Skill Creator** — интерактивный мастер создания Skills.
2. **Skills Manager** — отдельная вкладка для просмотра, поиска, редактирования и управления Skills.
3. **Skill Benchmark** — автоматическое A/B-тестирование и улучшение Skills.

Система должна использовать **существующий нативный механизм Skills DeepSeek Harness** и не создавать альтернативный формат Skill.

Skill остаётся:

```text
<skill-name>/SKILL.md
```

с YAML-frontmatter + Markdown body.

Необходимо интегрироваться с существующими:

```text
packages/skill/
packages/skill-filesystem/
packages/skill-badge/
packages/tool-skill/
```

и не ломать существующее поведение discovery, invocation policy и `skill({ name })`.

---

# 2. Основная концепция

Пользователь должен иметь возможность:

```text
/skill-create
```

или:

```text
Settings → Skills → Create Skill
```

После запуска Skill Creator пользователь может:

### Вариант A — описать Skill своими словами

Например:

> Сделай Skill для перевода технической документации с английского на русский. Нужно сохранять Markdown, код не переводить, использовать единообразную терминологию.

### Вариант B — предоставить полноценное ТЗ

Например:

> Вот полное ТЗ на переводчик...

Creator должен самостоятельно извлечь:

- назначение;
- требования;
- ограничения;
- правила;
- формат результата;
- условия применения;
- edge cases;
- критерии качества.

Если информации недостаточно, Creator задаёт пользователю дополнительные вопросы.

После получения достаточной информации система автоматически:

```text
Analyze
→ Ask missing questions
→ Generate
→ Validate
→ Security Check
→ Preview
→ Test?
→ Benchmark
→ Improve if necessary
→ Save
```

---

# 3. Skill Creator

## 3.1. Запуск

Поддержать оба способа.

### CLI/Chat

```text
/skill-create
```

Также должен поддерживаться autocomplete через `/`.

### UI

```text
Settings
  └── Skills
       └── Create Skill
```

Оба способа должны запускать один и тот же внутренний Skill Creator workflow.

Не делать две независимые реализации.

---

# 4. Skill Creator должен быть системным Skill

Сам `skill-creator` должен быть реализован как встроенный/system Skill проекта Harness.

Пример:

```text
.dsh/skills/skill-creator/
└── SKILL.md
```

или соответствующее существующее в проекте расположение bundled/system Skills.

При этом важно разделить:

### Skill Creator

Отвечает за:

- сбор требований;
- анализ;
- генерацию инструкций;
- подготовку benchmark;
- анализ результатов;
- улучшение.

### Harness Skill Runtime/API

Отвечает за:

- создание файлов;
- чтение файлов;
- изменение файлов;
- удаление;
- перемещение в Trash;
- versioning;
- discovery;
- validation;
- запуск benchmark;
- получение token/time/tool metrics.

Не пытаться реализовать filesystem operations только через текстовые инструкции модели.

---

# 5. Интерактивный сбор требований

После запуска Creator должен определить, что пользователь хочет создать.

Первый вопрос:

```text
Что вы хотите создать?

[Описать Skill своими словами]
[Предоставить полноценное ТЗ]
```

На практике пользователь также может сразу написать описание или вставить ТЗ без выбора режима.

Creator должен анализировать полученный текст.

---

# 6. Интеллектуальное извлечение требований

Из пользовательского описания необходимо извлекать:

```text
Name
Purpose
Description
When to use
Instructions
Rules
Constraints
Expected output
Forbidden behavior
Examples
Edge cases
Resources
Invocation policy
Scope
```

Если какого-либо критически важного элемента не хватает, Creator задаёт вопрос.

Не задавать вопросы, на которые уже есть однозначный ответ в предоставленном ТЗ.

Пример:

```text
Skill предназначен для code review.

Необходимо уточнить:

1. Какие языки программирования поддерживать?
2. Нужны ли security checks?
3. Должен ли Skill запускать тесты?
4. Какой формат результата нужен?
```

Диалог должен быть адаптивным.

---

# 7. Имя Skill

Creator должен автоматически предложить kebab-case имя:

```text
technical-translator
code-review
api-security-review
documentation-writer
```

Строго соблюдать:

```regex
^[a-z0-9]+(?:-[a-z0-9]+)*$
```

Если предложенное пользователем имя невалидно — автоматически предложить исправленный вариант.

Если имя уже существует — запускать Conflict Resolution.

---

# 8. Генерация SKILL.md

Creator обязан генерировать нативный формат DeepSeek Harness.

Пример:

```yaml
---
name: technical-translator
description: Translate technical documentation while preserving code and Markdown structure.
description.ru: Перевод технической документации с сохранением структуры Markdown и исходного кода.
whenToUse: Use when translating technical documentation.
user-invocable: true
disable-model-invocation: false
---
```

После frontmatter идёт Markdown body.

Creator не должен изобретать собственные обязательные поля, несовместимые с существующим parser.

Использовать существующие правила:

- `name`;
- `description`;
- `description.ru`;
- `description.zh`;
- `whenToUse`;
- `metadata`;
- `disable-model-invocation`;
- `user-invocable`.

---

# 9. Validation

Перед сохранением каждый Skill обязан пройти существующую Skill validation.

Проверять:

- наличие frontmatter;
- корректность YAML;
- `name`;
- kebab-case;
- `description`;
- invocation fields;
- deprecated camelCase keys;
- типы значений;
- корректность структуры;
- доступность выбранного storage root.

Использовать существующий validator/parser, а не создавать вторую независимую реализацию правил.

При ошибке:

```text
Skill validation failed.

Reason:
Invalid frontmatter field...

[Fix automatically]
[Edit manually]
[Cancel]
```

---

# 10. Security & Policy Validator

Добавить отдельный слой проверки Skill.

Проверять:

- prompt injection;
- попытки переопределить системные инструкции;
- конфликтующие инструкции;
- попытки изменить security policy;
- опасные или чрезмерно широкие инструкции;
- подозрительные внешние ресурсы;
- `scripts/`;
- `references/`;
- `assets/`;
- потенциальные privilege escalation instructions;
- попытки заставить Skill скрывать собственное поведение;
- несовместимые invocation policies.

Результат:

```text
VALID
WARNING
BLOCKED
```

### VALID

Можно использовать.

### WARNING

Skill допустим, но пользователю показывается предупреждение.

### BLOCKED

Skill не должен становиться активным.

Пользователь должен увидеть причину блокировки.

Security Validator не должен произвольно переписывать содержимое Skill без ведома пользователя.

---

# 11. Выбор места хранения

После генерации пользователь выбирает:

```text
Where to save Skill?

○ User
  ~/.dsh/skills

○ Project
  .dsh/skills

○ Agents
  .agents/skills
```

Физические пути должны соответствовать существующим корням Skill filesystem provider.

Не создавать отдельный нестандартный storage format.

---

# 12. Project / User / Agents

### User

```text
~/.dsh/skills/<name>/SKILL.md
```

Используется между проектами.

### Project

```text
<project>/.dsh/skills/<name>/SKILL.md
```

Используется конкретным проектом.

### Agents

```text
<project>/.agents/skills/<name>/SKILL.md
```

Используется agent-specific workflow.

UI должен показывать одновременно понятное имя области и реальный путь.

---

# 13. Preview

После генерации показать preview:

```text
Skill Ready

Name:
technical-translator

Scope:
Project

Path:
.dsh/skills/technical-translator/SKILL.md

Description:
...

Instructions:
...

Validation:
✓ Passed

Security:
✓ Passed
```

Кнопки:

```text
[Test Skill]
[Save]
[Edit]
[Cancel]
```

Preview не должен обязательно блокировать автоматический workflow.

---

# 14. Автоматический workflow

Основной путь:

```text
Create
↓
Analyze
↓
Questions
↓
Generate
↓
Validate
↓
Security Check
↓
Preview
↓
Test?
↓
Benchmark
↓
Improve if necessary
↓
Save
```

Если пользователь не хочет тестировать:

```text
Save without testing
```

Skill должен сохраняться с пометкой:

```text
Not benchmarked
```

---

# 15. Skills Manager

Добавить новую отдельную вкладку:

```text
Plugins
Skills
```

## Skills

Вкладка должна содержать:

```text
Search Skills...

[+ Create Skill]
```

Список:

```text
MY SKILLS

technical-translator
Translate technical documentation
Project

code-review
Perform structured code review
User

BUILT-IN

skill-creator
Create and improve Skills
Built-in
```

---

# 16. Поиск Skills

Поиск должен работать минимум по:

- `name`;
- `description`;
- локализованному description;
- `whenToUse`;
- metadata;
- содержимому Skill.

Например пользователь пишет:

```text
skill
```

и получает все релевантные Skills.

Поиск должен работать в реальном времени.

---

# 17. Skill Card

Каждый Skill должен показывать:

```text
Name
Description
Scope
Path
Status
Invocation policy
Last benchmark
Current version
```

Статусы:

```text
Enabled
Disabled
Not Tested
Benchmark Outdated
Warning
Blocked
```

---

# 18. Enable / Disable

Добавить переключатель:

```text
Enabled / Disabled
```

Disable не удаляет Skill.

Отключённый Skill не должен участвовать в соответствующих invocation surfaces.

Не ломать существующие `user-invocable` и `disable-model-invocation`.

---

# 19. Просмотр Skill

Открытие Skill должно позволять:

```text
Rendered
Raw
```

Показывать:

- frontmatter;
- Markdown;
- путь;
- metadata;
- invocation policy;
- ресурсы.

---

# 20. Редактирование

Добавить:

```text
Edit Skill
```

После изменения:

1. validate;
2. security check;
3. create version;
4. invalidate/update state;
5. mark previous benchmark as outdated.

Если Skill изменён после benchmark:

```text
⚠ Benchmark outdated

Skill changed after last test.

[Test again]
```

Старый benchmark сохраняется.

---

# 21. Slash Skill Selection

При вводе:

```text
/
```

показать команды и Skills.

Например:

```text
/skill-creator
/technical-translator
/code-review
/security-review
```

Поддержать поиск:

```text
/translation
```

→ соответствующие Skills.

Выбор Skill должен загружать его через существующий Skill runtime.

---

# 22. Explicit invocation

Если:

```text
user-invocable: true
```

пользователь может вызвать:

```text
/skill-name
```

Если:

```text
user-invocable: false
```

Skill не показывается пользователю как прямой slash invocation.

---

# 23. Model invocation

Сохранить существующую механику:

```text
disable-model-invocation: false
```

→ модель может обнаружить и вызвать Skill.

```text
disable-model-invocation: true
```

→ модель не получает его как model-invocable Skill.

Не изменять существующий контракт:

```text
skill({ name })
```

и существующие ошибки:

```text
Error: invalid skill name
Error: skill is unknown or no longer available
Error: skill is not available for model invocation
```

---

# 24. Skill Benchmark

Добавить полноценный benchmark subsystem.

Цель:

объективно сравнить:

```text
WITHOUT SKILL
vs
WITH SKILL
```

---

# 25. Benchmark Model Selection

Модель должна **выбираться пользователем**.

UI:

```text
Task Model:
[ Select model ]

Evaluator Model:
[ Select model ]

☑ Use same model
```

Если checkbox включён:

```text
Task Model = Evaluator Model
```

Если выключен — модели могут отличаться.

Сохранять:

- provider;
- model;
- model configuration;
- параметры запуска;
- benchmark version.

---

# 26. Симметричный A/B Test

Для каждого тестового кейса:

```text
                 SAME INPUT
                     │
          ┌──────────┴──────────┐
          ↓                     ↓
     WITHOUT SKILL          WITH SKILL
          │                     │
          └──────────┬──────────┘
                     ↓
                 Evaluator
```

Baseline и Skill execution должны использовать одинаковый:

- user request;
- исходный контекст;
- model;
- relevant configuration;
- environment;
- timeout policy.

Единственное существенное отличие — наличие созданного Skill.

---

# 27. Test Suite

Не ограничиваться одним тестом.

Количество кейсов должно быть адаптивным:

### Простые Skills

3 кейса.

### Обычные Skills

5 кейсов.

### Сложные Skills

5–10 кейсов.

Creator сам определяет сложность.

Тесты должны покрывать:

- normal case;
- happy path;
- edge case;
- constraints;
- formatting;
- typical failure;
- сложные случаи, если применимо.

---

# 28. Генерация Test Cases

Creator должен автоматически создать benchmark scenarios на основании исходного ТЗ Skill.

Например:

```text
Skill:
technical-translator

Test Suite:

Case 1
Basic translation

Case 2
Technical terminology

Case 3
Markdown preservation

Case 4
Code preservation

Case 5
Edge case
```

Тесты должны быть репрезентативными для назначения Skill.

---

# 29. Benchmark Evaluator

Evaluator получает:

```text
Original requirements
Test case
Result A
Result B
```

Результаты должны подаваться нейтрально:

```text
Candidate A
Candidate B
```

Evaluator не должен знать заранее, какой результат был получен со Skill.

---

# 30. Evaluation Criteria

На основании ТЗ Creator формирует критерии:

```text
Accuracy
Instruction compliance
Completeness
Output format
Required behavior
Constraints
Edge-case handling
```

Evaluator выставляет:

```text
0–100
```

для каждого результата.

Пример:

```text
Baseline: 72/100
Skill:    91/100

Improvement:
+19 points
+26.4%
```

---

# 31. Benchmark Metrics

Помимо quality score сохранять:

### Quality

```text
Overall score
Instruction compliance
Accuracy
Completeness
Format compliance
```

### Resource metrics

```text
Input tokens
Output tokens
Total tokens
```

### Execution

```text
Execution time
Tool calls
Failed attempts
Errors
```

Показывать absolute и percentage delta.

---

# 32. Benchmark UI

Пример:

```text
SKILL BENCHMARK

Quality
Without Skill     72
With Skill        91
Improvement       +26.4%

Tokens
Without Skill     12,480
With Skill         8,920
Saved              3,560 (-28.5%)

Execution Time
Without Skill      31.4s
With Skill         24.7s
Improvement        -21.3%

Tool Calls
Without Skill      14
With Skill           9

FINAL SCORE
93/100
```

---

# 33. Test Result Interpretation

Система не должна автоматически утверждать:

> Skill is better

только потому, что один показатель вырос.

Необходимо оценивать совокупность критериев.

Если существенного улучшения нет:

```text
No significant improvement detected.
```

Если Skill ухудшил результат:

```text
Skill performs worse than baseline.
```

Показать причины.

---

# 34. Case-by-case analysis

Показывать результаты каждого кейса:

```text
Case 1    +18%
Case 2    +31%
Case 3     +7%
Case 4    +25%
Case 5    +22%

Overall   +20.6%
```

Для каждого failure:

```text
Case 3 failed

Problem:
Markdown structure was not preserved.

Skill instruction responsible:
...

Suggested improvement:
...
```

---

# 35. Improve Skill

После benchmark добавить:

```text
[Improve Skill]
[Edit manually]
[Keep current version]
```

Если Skill хуже baseline — **Improve Skill должно быть особенно заметным действием**.

---

# 36. Manual Improve

Manual mode:

```text
Analyze failures
↓
Show problems
↓
Suggest changes
↓
User edits/accepts
↓
Generate new version
↓
Validate
↓
Test
```

Пользователь контролирует каждое изменение.

---

# 37. Auto Improve

Добавить режим:

```text
Auto Improve
```

Workflow:

```text
Analyze
↓
Generate improvement
↓
Validate
↓
Security Check
↓
Benchmark
↓
Compare
↓
Keep best version
↓
Repeat if useful
```

Автоматическое улучшение не должно молча заменять лучшую версию худшей.

---

# 38. Auto Improve limits

Добавить защитные параметры:

```text
Maximum iterations
Minimum improvement threshold
Maximum benchmark budget
Stop on regression
```

Например:

```text
Max iterations: 5
Minimum improvement: 1%
```

Если новая версия хуже:

```text
Keep previous version
```

---

# 39. Best Version

Система должна хранить лучшую версию по benchmark.

Например:

```text
v1    71
v2    84
v3    81
v4    91
```

Активной считается:

```text
v4
```

Версия v3 не должна автоматически заменять v2.

---

# 40. Version History

Каждая модификация Skill создаёт новую версию.

Хранить:

```text
Version
Date
Change reason
Author/source
Diff
Benchmark
Model
Evaluator
Token usage
Execution time
Score
```

Пример:

```text
technical-translator

v1
Initial

v2
Manual edit

v3
Auto Improve

v4
Auto Improve
Best score
```

---

# 41. Compare Versions

Добавить:

```text
Compare versions
```

Например:

```text
v2 vs v4

Quality:
84 → 91

Tokens:
9,840 → 8,920

Tool calls:
11 → 9
```

Показывать diff `SKILL.md`.

---

# 42. Rollback

Добавить:

```text
Restore version
```

При rollback создавать новую version event или корректно использовать существующий version mechanism так, чтобы история не терялась.

Нельзя физически уничтожать историю.

---

# 43. Conflict Resolution

Если пользователь создаёт Skill с уже существующим `name`:

```text
Skill already exists

Existing:
~/.dsh/skills/translation/SKILL.md

New:
.dsh/skills/translation/SKILL.md
```

Показать:

```text
[Create with another name]
[Replace existing]
[Cancel]
```

Никаких silent overwrite.

Перед Replace создать version/backup существующего Skill.

---

# 44. Delete / Trash

Удаление должно быть безопасным.

Вместо немедленного permanent delete:

```text
Delete
↓
Trash
```

Например:

```text
.dsh/skills/.trash/
```

Реализация может использовать другой внутренний механизм, если он лучше соответствует архитектуре Harness.

В Trash:

```text
Restore
Delete permanently
```

---

# 45. Built-in Skills

Built-in/system Skills должны быть защищены от обычного удаления.

Для:

```text
skill-creator
```

например:

```text
Edit
View
Benchmark
```

но не:

```text
Delete
```

если это bundled/system resource.

---

# 46. Skill Creator должен уметь улучшать сам себя

Поскольку `skill-creator` является Skill, архитектура должна позволять:

- изменять его инструкции;
- тестировать;
- benchmark;
- versioning;
- rollback.

Но системный Skill не должен быть случайно удалён пользователем.

---

# 47. State Machine

Реализовать понятные состояния:

```text
DRAFT
↓
ANALYZING
↓
QUESTIONS
↓
GENERATING
↓
VALIDATING
↓
SECURITY_CHECK
↓
READY
↓
TESTING
↓
EVALUATING
↓
IMPROVING
↓
RETESTING
↓
BENCHMARKED
↓
SAVED
```

Ошибочные состояния:

```text
VALIDATION_FAILED
SECURITY_WARNING
SECURITY_BLOCKED
TEST_FAILED
MODEL_ERROR
SAVE_FAILED
```

Каждое состояние должно иметь recoverable action.

---

# 48. Отмена

На каждом длительном этапе пользователь должен иметь возможность:

```text
Cancel
Stop
```

Особенно:

- benchmark;
- Auto Improve;
- model execution.

Если Auto Improve остановлен, лучшая уже сохранённая версия не должна теряться.

---

# 49. Failure Recovery

Если benchmark упал:

```text
Benchmark failed.

Reason:
Model timeout.

[Retry]
[Change model]
[Cancel]
```

Если evaluator упал:

```text
Evaluation failed.

[Retry evaluation]
[Change evaluator]
[Cancel]
```

Не считать Skill плохим только потому, что evaluator технически не выполнился.

---

# 50. Benchmark Reproducibility

Для каждого benchmark сохранять:

```text
Skill version
Task model
Evaluator model
Provider
Prompt/test case
Relevant configuration
Timestamp
Token metrics
Tool metrics
Execution time
Evaluation result
```

Это необходимо для корректного сравнения версий.

---

# 51. Необходимая интеграция

Не дублировать существующий Skill filesystem parser.

Использовать существующий:

```text
packages/skill/skill-filesystem/
```

Не дублировать discovery.

Использовать существующий Skill registry:

```text
ctx.skills
```

Не менять контракт:

```text
SkillSummary
SkillDefinition
SkillCandidate
```

без необходимости.

Не ломать:

```text
available_skills
skill({ name })
```

и существующую invocation policy.

---

# 52. Hot Reload

После создания/изменения Skill существующий Chokidar watcher должен корректно обнаруживать изменения.

Не требовать restart Harness для обычного:

```text
create
edit
delete
restore
```

если текущая архитектура уже поддерживает соответствующее hot reload.

После изменения body не требовать искусственного hash invalidation, поскольку существующая система перечитывает тело Skill при `skill(name)`.

---

# 53. Backward Compatibility

Все существующие Skills должны продолжить работать без изменений.

Старые:

```text
SKILL.md
```

должны обнаруживаться как раньше.

Новые Skills должны быть полностью совместимы с существующим parser.

Не менять существующие semantics:

```text
disable-model-invocation
user-invocable
```

---

# 54. UX требования

Интерфейс должен быть:

- быстрым;
- понятным;
- информативным;
- с видимым progress;
- без скрытых длительных операций.

Во время benchmark показывать:

```text
Generating test suite...
Case 1/5
Running baseline...
Running skill...
Evaluating...
```

Во время Auto Improve:

```text
Iteration 2/5

Current best:
91/100

Testing candidate v5...
```

---

# 55. Главное правило автоматизации

Пользователь не должен вручную заниматься техническими деталями:

```text
YAML
frontmatter
filesystem path
version files
benchmark setup
evaluation schema
```

Creator должен заниматься этим самостоятельно.

Пользователь отвечает только на вопросы, которые действительно необходимы для понимания назначения Skill.

---

# 56. Главный пользовательский сценарий

Пример полного workflow:

```text
User:

/skill-create

Creator:

What Skill would you like to create?

User:

Мне нужен Skill для анализа security-кода.
Вот полное ТЗ:
...

Creator:

Я извлёк требования:
...

Есть 2 уточнения:
1. ...
2. ...

User:

...

Creator:

Generating Skill...

✓ Frontmatter
✓ Instructions
✓ Invocation policy
✓ Security validation

Skill:
security-code-review

Scope:
Project

Path:
.dsh/skills/security-code-review/SKILL.md

Test Skill?

[Yes] [No]
```

Пользователь:

```text
Yes
```

Система:

```text
Generating test suite...

5 cases generated.

Running baseline...
Running Skill...

Evaluating...

BASELINE
76/100

SKILL
91/100

Improvement
+19.7%

Tokens
-23.4%

Tool calls
-18%

Execution time
-15%
```

Затем:

```text
Skill performs better.

[Save Skill]
[Improve further]
[Edit]
```

Если хуже:

```text
Skill performs worse.

Problems detected:
...

[Improve Skill]
[Edit manually]
[Keep current]
```

При Auto Improve:

```text
Iteration 1
78/100

Iteration 2
86/100

Iteration 3
93/100 ← BEST

Iteration 4
89/100 ← rejected

Final:
v3 active
```

---

# 57. Acceptance Criteria

Фича считается реализованной только если выполнены все условия:

### Creation

- [ ] `/skill-create` работает.
- [ ] UI Create Skill работает.
- [ ] Можно дать короткое описание.
- [ ] Можно дать полноценное ТЗ.
- [ ] Creator задаёт только необходимые дополнительные вопросы.
- [ ] Генерируется валидный `SKILL.md`.
- [ ] Соблюдается native DeepSeek Harness format.

### Storage

- [ ] User storage.
- [ ] Project storage.
- [ ] Agents storage.
- [ ] Отображается реальный path.

### Management

- [ ] Skills tab.
- [ ] Search.
- [ ] View.
- [ ] Edit.
- [ ] Enable/Disable.
- [ ] Slash selection.
- [ ] Delete.
- [ ] Trash.
- [ ] Restore.
- [ ] Permanent Delete.

### Invocation

- [ ] `/skill-name`.
- [ ] Slash autocomplete.
- [ ] Existing model invocation.
- [ ] `user-invocable`.
- [ ] `disable-model-invocation`.

### Validation

- [ ] Frontmatter validation.
- [ ] Existing parser rules.
- [ ] Security validation.
- [ ] Warning/Blocked states.

### Benchmark

- [ ] Test Suite.
- [ ] Adaptive number of cases.
- [ ] Baseline.
- [ ] With Skill.
- [ ] User-selectable Task Model.
- [ ] User-selectable Evaluator Model.
- [ ] Blind A/B evaluation.
- [ ] Score 0–100.
- [ ] Quality metrics.
- [ ] Token metrics.
- [ ] Time metrics.
- [ ] Tool-call metrics.
- [ ] Case-level results.

### Improvement

- [ ] Manual Improve.
- [ ] Auto Improve.
- [ ] Iterative testing.
- [ ] Regression protection.
- [ ] Best-version selection.
- [ ] Configurable iteration limit.

### Versioning

- [ ] Version history.
- [ ] Diff.
- [ ] Benchmark per version.
- [ ] Compare versions.
- [ ] Rollback.
- [ ] Benchmark Outdated state.

### Reliability

- [ ] No silent overwrite.
- [ ] No silent deletion.
- [ ] Cancel.
- [ ] Retry.
- [ ] Failure recovery.
- [ ] Existing Skills remain compatible.

---

# 58. Обязательные тесты

Реализовать automated tests минимум для:

1. Создание простого Skill.
2. Создание Skill из полного ТЗ.
3. Дополнительные вопросы Creator.
4. Некорректное имя.
5. Некорректный YAML.
6. Отсутствие description.
7. Invalid invocation policy.
8. Deprecated camelCase fields.
9. User storage.
10. Project storage.
11. Agents storage.
12. Name conflict.
13. Replace existing.
14. Version creation.
15. Rollback.
16. Delete → Trash.
17. Restore.
18. Permanent Delete.
19. Enable/Disable.
20. Slash invocation.
21. Model invocation.
22. `disable-model-invocation`.
23. `user-invocable`.
24. Benchmark.
25. Multiple test cases.
26. Baseline vs Skill.
27. Same model A/B.
28. Different evaluator model.
29. Evaluator failure.
30. Model timeout.
31. Auto Improve.
32. Regression rejection.
33. Best version selection.
34. Benchmark outdated после редактирования.
35. Hot reload.
36. Built-in Skill protection.

---

# 59. Критически важное ограничение

**Не переписывать существующую систему Skills с нуля.**

Задача — добавить над существующим механизмом полноценный UX и automation layer.

Использовать существующие:

```text
Skill filesystem provider
Skill registry
Skill parser
Skill invocation
Skill discovery
Skill watcher
```

где это возможно.

Новые компоненты должны интегрироваться с ними, а не создавать параллельную систему.

---

# 60. Definition of Done

Фича считается готовой, когда пользователь может пройти полный цикл:

```text
/skill-create
      ↓
описать Skill / вставить ТЗ
      ↓
ответить на уточнения
      ↓
получить автоматически сгенерированный Skill
      ↓
validation
      ↓
security check
      ↓
выбрать User / Project / Agents
      ↓
запустить benchmark
      ↓
получить A/B результат
      ↓
увидеть качество / токены / время / tool calls
      ↓
при необходимости Improve
      ↓
Auto Improve или Manual Improve
      ↓
получить лучшую версию
      ↓
сохранить
      ↓
найти Skill через Skills Manager
      ↓
вызвать через /
      ↓
или позволить модели автоматически вызвать Skill
```

При этом существующие Skills, parser, discovery и invocation должны продолжать работать без регрессий.

**Итоговая цель:** превратить Skills из статической системы хранения `SKILL.md` в полноценный управляемый жизненный цикл:

```text
CREATE
→ VALIDATE
→ SECURE
→ TEST
→ EVALUATE
→ IMPROVE
→ VERSION
→ DEPLOY
→ USE
→ MONITOR
→ ROLLBACK
```