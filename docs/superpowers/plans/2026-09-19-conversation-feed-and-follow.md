# Conversation Feed and Bottom Follow Implementation Plan

English | [中文](2026-09-19-conversation-feed-and-follow.zh.md)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Создать спокойную, информативную и быструю ленту действий в «Исполнении», навигацию по запросам в «Чате» и «Исполнении», согласовать три вкладки и обеспечить управляемое пользователем живое следование за последним действием.

**Architecture:** «Исполнение» продолжает проецировать существующие Chat node и отдавать подробности текущим Tool renderer; группы опираются на зарегистрированные границы хода и шага. Большие журналы используют окно виртуальных строк с измерением раскрываемых карточек. Один явный автомат режимов следования управляет поведением трёх вкладок, а каждая вкладка сама применяет его к своему scrollport и сохраняет позицию чтения на время переключения вкладок.

**Tech Stack:** React, TypeScript, CSS modules, `@tanstack/react-virtual` (уже используется в Trajectory), Vitest, Testing Library, keyless web snapshots.

**Spec:** [Лента действий и код пользователя](../specs/2026-09-19-conversation-activity-design.md). Независимый план для тройных кавычек: [User Code Fences](2026-09-19-user-code-fences.md).

## Global Constraints

- Чат и Исполнение используют Conversation Runtime; Траектория сохраняет собственную проекцию. Новые session events для чисто визуального изменения не требуются.
- В журнале нет вымышленных этапов, времени, содержимого файлов или результатов; точные данные берутся из сохранённого снимка.
- Файлы и Tool card раскрываются через существующие renderer; Host open-file остаётся отдельным действием.
- Боковые риски представляют только реально загруженные пользовательские запросы; при длинной истории одновременно монтируется ограниченное число кнопок.
- Уход пользователя вверх сразу отключает следование; возвращение вручную к низу или существующая кнопка «К последнему» его включают.
- Во время стриминга нельзя запускать очередь smooth-scroll; ручное управление всегда отменяет программный переход.
- Обязательны клавиатура, screen reader, `prefers-reduced-motion`, локали `en`/`ru`/`zh`, чистый tree disposal.
- Изменение поведения дополняется ключевым web snapshot, парными README, JSDoc и Agent Note по правилам репозитория.
- До реализации прочитать [архитектуру](../../architecture.md), [защитные паттерны](../../defensive-patterns.md) и инструкции [packages](../../../packages/AGENTS.md); перед изменением packages запросить локальный graphify.

---

## Карта файлов и ответственности

| Область | Владелец | Планируемые изменения |
|---|---|---|
| Вход событий | [Conversation session](../../../packages/client/runtime/src/client/sessions/session.ts), [assembler](../../../packages/client/runtime/src/client/sessions/conversation-assembler.ts), [Chat snapshot builder](../../../packages/client/ui-conversation/src/client/conversation-nodes/chat-snapshot-builder.ts) | Только чтение и профилирование; не создавать второй журнал событий. |
| Проекция Исполнения | [execution-event.ts](../../../packages/client/ui-conversation/src/client/execution/execution-event.ts), [execution-summary.ts](../../../packages/client/ui-conversation/src/client/execution/execution-summary.ts), новый `execution-groups.ts` | Стабильные строки, реальные группы, инкрементальная обработка видимых изменений. |
| Вид Исполнения | [ExecutionView.tsx](../../../packages/client/ui-conversation/src/client/execution/ExecutionView.tsx), [ExecutionEventRow.tsx](../../../packages/client/ui-conversation/src/client/execution/ExecutionEventRow.tsx), [ExecutionHeader.tsx](../../../packages/client/ui-conversation/src/client/execution/ExecutionHeader.tsx), соседние CSS modules | Компактная иерархия, раскрытие, кнопка «К последнему», окно строк. |
| Tool details | [ToolRow.tsx](../../../packages/client/ui-tool/src/client/tool/components/ToolRow.tsx), [read-row.tsx](../../../packages/client/ui-tool/src/client/tool/toolviews/read-row.tsx), [README](../../../packages/client/ui-tool/README.md) | Сохранить ReadBlock/DiffBlock, разделить inline preview и Host open-file. |
| Чат и вкладки | [ChatView.tsx](../../../packages/client/ui-conversation/src/client/chat/ChatView.tsx), [ConversationSession.tsx](../../../packages/client/ui-conversation/src/client/skeleton/ConversationSession.tsx), [view contracts](../../../packages/client/ui-conversation/src/client/contract/slots.ts) | Следование, bookmark вкладки, визуальное согласование служебных строк. |
| Навигация по запросам | Новые `packages/client/ui-conversation/src/client/contract/prompt-nav.ts` и `packages/client/ui-conversation/src/client/skeleton/PromptRail.tsx` | Ограниченное окно рисок, активный запрос и переход к стабильному Chat node key. |
| Траектория | [TrajectoryView.tsx](../../../packages/client/ui-trajectory/src/client/TrajectoryView.tsx), [TrajectoryTable.tsx](../../../packages/client/ui-trajectory/src/client/TrajectoryTable.tsx), [README](../../../packages/client/ui-trajectory/README.md) | Следование при росте текущей строки с сохранением виртуального окна. |
| Общий автомат | Новый `packages/client/ui-conversation/src/client/contract/bottom-follow.ts`; [публичный client entry](../../../packages/client/ui-conversation/src/client/index.ts) | Чистые переходы режима; DOM остаётся ответственностью вкладки. |
| Проверки | [Execution tests](../../../packages/client/ui-conversation/tests/execution-view.client.spec.tsx), [Chat tests](../../../packages/client/ui-conversation/tests/chat-view.client.spec.tsx), [Trajectory table tests](../../../packages/client/ui-trajectory/tests/table.client.spec.tsx), [web snapshots](../../../apps/web/tests/snapshots/) | Поведение, длинная история, собранное приложение и измерения. |

Порядок: задачи 1–5 формируют и ускоряют ленту; задача 6 добавляет навигацию по запросам; задача 7 фиксирует режим следования и bookmark; задачи 8–9 интегрируют вкладки; задача 10 проверяет всё вместе. Каждая задача заканчивается отдельной проверкой и пригодна для самостоятельного ревью. Если какой-либо этап меняет публичные типы, дополнить owning subsystem page и JSDoc в том же этапе.

### Task 1: Зафиксировать эталон дизайна и базовую производительность

**Files:** тестовые fixtures рядом с [Execution tests](../../../packages/client/ui-conversation/tests/execution-view.client.spec.tsx); измерительный сценарий в `apps/web/tests/`; затронутые CSS читать без правки.

**Interfaces:** вход — реальные Chat node, Tool card и Trajectory records; выход — воспроизводимый сценарий на 50 различных действий и длинный сценарий на 1 000/5 000 записей с описанными исходными числами.

- [ ] Собрать fixture из существующих типов: пользовательский запрос, reasoning, read, edit/diff, shell success/error, поиск, subagent, approval, plan/todo, assistant answer; не присваивать данным несуществующие поля.
- [ ] Снять текущий вид трёх вкладок при короткой и длинной истории, включая раскрытую карточку чтения, ошибку и тёмную/светлую тему; зафиксировать желаемую визуальную иерархию из спецификации до CSS изменений.
- [ ] Измерить в браузере количество смонтированных строк, время первого монтирования, профиль одного потокового обновления, прокрутки и ввода при 1 000/5 000 записях; записать машину, браузер и результаты рядом со сценарием.
- [ ] Согласовать макет в контрольной точке: первая строка действия читается без деталей; ошибка/ожидание/текущая работа видны сразу; путь и результат сканируются без избыточных badges.
- [ ] Проверить fixture узким тестом и сохранить результат как baseline; не заявлять выигрыш до повторного замера.

### Task 2: Группы только по реальным границам и стабильный event index

**Files:** Create `packages/client/ui-conversation/src/client/execution/execution-groups.ts`; Modify [execution-event.ts](../../../packages/client/ui-conversation/src/client/execution/execution-event.ts), [ExecutionView.tsx](../../../packages/client/ui-conversation/src/client/execution/ExecutionView.tsx); Test [execution-event tests](../../../packages/client/ui-conversation/tests/execution-event.client.spec.ts), новый `execution-groups.client.spec.ts`.

**Interfaces:** `ExecutionGroup = { key: string; title: string; eventKeys: readonly string[] }`; `groupExecutionEvents(events: readonly ExecutionEvent[], timeline: ChatSnapshot['timeline']): readonly ExecutionGroup[]`. Граница берётся из существующего Chat timeline/turn metadata; не выводить turn по времени или тексту. Строки событий сохраняют `ExecutionEvent.key`.

- [ ] Добавить красные тесты: два user turn, несколько step, partial tool и prepend старой истории дают правильные группы, порядок и стабильные ключи; неизвестная граница не создаёт фиктивную группу.
- [ ] Запустить `pnpm exec vitest run packages/client/ui-conversation/tests/execution-event.client.spec.ts packages/client/ui-conversation/tests/execution-groups.client.spec.ts`; новый тест должен падать по отсутствующему grouper.
- [ ] Вынести чистую группировку; заголовок группы получает текст только из зарегистрированного user/turn/plan факта, иначе нейтральный номер хода.
- [ ] Кэшировать производную строку по идентичности Chat node и не пересоздавать неизменённые события при обновлении стримингового хвоста; фильтр и summary должны реагировать на изменение нужной строки.
- [ ] Повторить узкие тесты и проверить, что inspect, фильтры и поиск используют те же ключи после prepend. Отдельно просмотреть разницу времени построения индекса на fixture из задачи 1.

### Task 3: Спокойный журнал и доступное раскрытие

**Files:** Modify [ExecutionView.tsx](../../../packages/client/ui-conversation/src/client/execution/ExecutionView.tsx), [ExecutionEventRow.tsx](../../../packages/client/ui-conversation/src/client/execution/ExecutionEventRow.tsx), [ExecutionHeader.tsx](../../../packages/client/ui-conversation/src/client/execution/ExecutionHeader.tsx), `ExecutionView.module.css`, `ExecutionEventRow.module.css`, `ExecutionHeader.module.css`, [локали](../../../packages/client/ui-conversation/src/client/locales.ts); Test [Execution tests](../../../packages/client/ui-conversation/tests/execution-view.client.spec.tsx).

**Interfaces:** сохраняются `nodeKey`, `renderChatNode`, `owner`, `aria-expanded`, search/filter/expand-all и существующий `jumpLatest`; group header не подменяет event row.

- [ ] Добавить тесты на последовательность group header → rows, на статус running/error/approval в свернутом виде, клавиатурное раскрытие и поиск через группы.
- [ ] Переработать header и toolbar: одна ясная сводка вместо повторов; компактная строка действия с главным глаголом, вторичной целью, статусом и временем; расширенная карточка остаётся в естественном потоке.
- [ ] Сохранить специализированный вызов `renderChatNode` в раскрытом теле, включая Subagent strip, Terminal/Read/Diff и fallback.
- [ ] Убрать конкурирующие бордеры, дублирующиеся подписи и визуальный шум CSS; задать токены плотности, hover/focus, светлую/тёмную тему и reduced motion через существующую дизайн систему.
- [ ] Запустить узкий тест и браузерный осмотр 50-действий fixture; зафиксировать замечания до виртуализации.

### Task 4: Inline preview файла и отдельное открытие в системе

**Files:** Modify [ExecutionEventRow.tsx](../../../packages/client/ui-conversation/src/client/execution/ExecutionEventRow.tsx), [ExecutionView.tsx](../../../packages/client/ui-conversation/src/client/execution/ExecutionView.tsx), при необходимости [ToolRow.tsx](../../../packages/client/ui-tool/src/client/tool/components/ToolRow.tsx); Test [Execution tests](../../../packages/client/ui-conversation/tests/execution-view.client.spec.tsx), [Tool row tests](../../../packages/client/ui-tool/tests/tool-row.client.spec.tsx), [Read card tests](../../../packages/client/ui-tool/tests/read-card.client.spec.tsx).

**Interfaces:** основной click по filename → раскрытие соответствующего logged Tool card в журнале; вторичное «Открыть файл» → существующий `openFile(path)`. Для summary файла используется существующий `firstKey` из `executionTraceSummary`.

- [ ] Добавить тест: click по `execution-view.client.spec.tsx` в read event показывает ровно сохранённый ReadBlock с диапазоном, количеством строк, языком и копированием, без Host open.
- [ ] Добавить тест: file summary переводит к реальному event даже когда строка вне viewport; edit path раскрывает DiffBlock; отсутствие read/diff data показывает доступное действие Host open без вымышленного содержимого.
- [ ] Сделать имя файла самостоятельным keyboard button/link без вложенного `button` в `button`; клик по остальной строке продолжает раскрывать карточку.
- [ ] Сохранить существующую обработку ошибки Host open в UI и проверить оба пути в узких тестах.

### Task 5: Виртуальное окно Исполнения с изменяемой высотой

**Files:** Modify [ExecutionView.tsx](../../../packages/client/ui-conversation/src/client/execution/ExecutionView.tsx), [execution-virtual.ts](../../../packages/client/ui-conversation/src/client/execution/execution-virtual.ts), `ExecutionView.module.css`; Test [execution-virtual tests](../../../packages/client/ui-conversation/tests/execution-virtual.client.spec.ts), [Execution tests](../../../packages/client/ui-conversation/tests/execution-view.client.spec.tsx).

**Interfaces:** `@tanstack/react-virtual` использует `visibleKeys`/группы как стабильные `getItemKey`; DOM строка сохраняет `data-execution-row-key`. Адресное раскрытие использует `virtualizer.scrollToIndex` по map ключ → индекс, затем фокусировку после монтирования.

- [ ] Написать падающие тесты: при 5 000 элементах DOM содержит только окно и overscan, раскрытая карточка изменяет высоту без наложения, фильтр и prepend сохраняют опорную строку, inspect/reveal находят строку вне DOM.
- [ ] Добавить виртуальную модель из event/group rows с измерением фактической высоты и стабильным индексом. Не виртуализировать вложенные ReadBlock и TerminalBlock отдельно от их родительской строки.
- [ ] Стабилизировать callbacks и подписки: замена stream content в одной строке не вызывает обновления всех `ExecutionEventRow`; не создавать новую `onToggle` функцию на каждую строку при каждом parent render.
- [ ] Реализовать переход к невидимой строке через index и повторное выравнивание после измерения; search/filter, expand/collapse all и keyboard focus должны работать через смену окна.
- [ ] Запустить тесты и повторить замеры 1 000/5 000 событий; целевой предел смонтированных строк при типичном viewport — 120.

### Task 6: Вертикальные риски для перехода между запросами

**Files:** Create `packages/client/ui-conversation/src/client/contract/prompt-nav.ts`, `packages/client/ui-conversation/src/client/skeleton/PromptRail.tsx`, `packages/client/ui-conversation/src/client/skeleton/PromptRail.module.css`; Modify [ChatView.tsx](../../../packages/client/ui-conversation/src/client/chat/ChatView.tsx), [ExecutionView.tsx](../../../packages/client/ui-conversation/src/client/execution/ExecutionView.tsx), [локали](../../../packages/client/ui-conversation/src/client/locales.ts); Test новый `prompt-nav.client.spec.ts`, `prompt-rail.client.spec.tsx`, [Chat tests](../../../packages/client/ui-conversation/tests/chat-view.client.spec.tsx), [Execution tests](../../../packages/client/ui-conversation/tests/execution-view.client.spec.tsx).

**Interfaces:** `PromptEntry = { key: string; seq: number; preview: string }`; `promptEntries(chat: ChatSnapshot): readonly PromptEntry[]` берёт только user/steering node; `visiblePromptWindow(entries, activeKey, maxVisible = 9)` возвращает не более 9 рисок и границы пропущенных диапазонов. `PromptRail` получает entries, activeKey, onSelect(key) и подписи; обе вкладки используют тот же компонент.

- [ ] Написать красные тесты: 5 запросов дают 5 кнопок; 200 запросов монтируют не более 9 рисок плюс два управления соседними диапазонами; порядок после prepend и отсутствие контекстных/system узлов не меняют соответствие ключей.
- [ ] Построить записи по стабильным Chat node key; вычислять активный запрос по видимой области не чаще одного раза за animation frame и не обходить все 5 000 строк на каждом scroll event. Для виртуального Исполнения использовать видимый virtual index, для Чата — доступные DOM anchor и кэш геометрии.
- [ ] Разместить rail у правого края scrollport примерно по центру его видимой высоты, не поверх текста, scrollbar, кнопки «К последнему» или composer; на узком экране сохранить доступ к запросам через компактный режим.
- [ ] Клик/Enter/Space переводит к соответствующему сообщению; вне виртуального окна использовать index-based scroll. Обработчик каждой вкладки явно выключает её текущий локальный follow при переходе к старому запросу; переход к последнему запросу не включает его до достижения низа. Задача 7 заменит локальные флаги общим автоматом. Подпись озвучивает номер в загруженной истории и начало текста, активная риска имеет `aria-current`.
- [ ] Запустить новые и затронутые тесты, затем проверить в браузере 5, 50 и 200 запросов и случай с частично загруженной историей.

### Task 7: Общий режим следования и bookmark вкладок

**Files:** Create `packages/client/ui-conversation/src/client/contract/bottom-follow.ts`; Modify [client entry](../../../packages/client/ui-conversation/src/client/index.ts), [view contracts](../../../packages/client/ui-conversation/src/client/contract/slots.ts), [ConversationSession.tsx](../../../packages/client/ui-conversation/src/client/skeleton/ConversationSession.tsx); Test новый `bottom-follow.client.spec.ts`, [skeleton tests](../../../packages/client/ui-conversation/tests/skeleton.client.spec.tsx).

**Interfaces:** `FollowMode = 'following' | 'reading' | 'jumping'`; `FollowAction = 'reader-left' | 'reader-at-floor' | 'jump' | 'jump-complete' | 'jump-interrupted'`; `nextFollowMode(mode, action): FollowMode`. В owner `conversation.view` добавить чтение/запись bookmark для пары session/view: `{ mode, anchorKey, anchorOffset, scrollTop }`; хранение в живой Session shell, сброс при смене sessionId.

- [ ] Тестами определить все переходы: старт following; жест вверх → reading; программный scroll/resize не вызывает переход; ручной низ → following; jump → jumping → following; вмешательство во время jump → reading.
- [ ] Реализовать чистый reducer без доступа к DOM, времени или глобальному singleton; экспортировать его для Trajectory через публичный client entry.
- [ ] Добавить общий owner API bookmark без записи пиксельной позиции в долговременный session log; при смене вкладки сохранять якорь и offset, при возвращении восстанавливать без ложного включения following.
- [ ] Проверить смену sessionId, размонтирование, отсутствие накопленных observers/listeners и восстановление каждой вкладки.

### Task 8: Живое следование в Чате и Исполнении

**Files:** Modify [ChatView.tsx](../../../packages/client/ui-conversation/src/client/chat/ChatView.tsx), [ExecutionView.tsx](../../../packages/client/ui-conversation/src/client/execution/ExecutionView.tsx), соответствующие CSS modules; Test [Chat tests](../../../packages/client/ui-conversation/tests/chat-view.client.spec.tsx), [Execution tests](../../../packages/client/ui-conversation/tests/execution-view.client.spec.tsx).

**Interfaces:** режим из задачи 7; текущая кнопка `.jumpLatest` с `aria-label="К последнему"` остаётся точкой входа; программный scroll не посылает `reader-at-floor`.

- [ ] Добавить тесты отдельно для каждой вкладки: первая посадка внизу; поток новой строки; рост последней строки без нового key; intentional wheel/touch/key вверх на 1–5 px; новые события в reading не двигают viewport; ручной низ включает follow.
- [ ] Добавить тест кнопки: плавный переход к концу, follow после достижения низа, прерывание колесом/касанием/клавишей; при reduced motion переход мгновенный. Подменять `scrollTo` и rAF в тесте, а не ждать реальную анимацию.
- [ ] Разделить происхождение scroll: gesture listeners меняют режим, а обновление данных и ResizeObserver только планируют один rAF write при following. В streaming следовать по актуальной геометрии, без повторных `behavior: 'smooth'`.
- [ ] В reading сохранять видимый anchor при prepend/раскрытии выше, фильтре и изменении высоты composer; не принудительно спускать Чат при простом переключении вкладки.
- [ ] Проверить wheel chaining над composer, текущий inspect scroll и видимость кнопки при уходе от низа.

### Task 9: Живое следование в виртуальной Траектории

**Files:** Modify [TrajectoryView.tsx](../../../packages/client/ui-trajectory/src/client/TrajectoryView.tsx), [TrajectoryTable.tsx](../../../packages/client/ui-trajectory/src/client/TrajectoryTable.tsx), `TrajectoryTable.module.css`; Test [Trajectory table tests](../../../packages/client/ui-trajectory/tests/table.client.spec.tsx), [view tests](../../../packages/client/ui-trajectory/tests/views.client.spec.tsx).

**Interfaces:** общий `FollowMode` и bookmark; позиционирование следует через существующий virtualizer, не через полный DOM scan. Сценарий `streamingCells` из текущего теста меняется: в following рост последней строки удерживает низ, в reading повторного tail-scroll нет.

- [ ] Записать красные тесты на оба режима при content-only streaming и на загрузку старой страницы во время reading; сохранить стабильные semantic row key и ARIA индексы.
- [ ] Перенести текущий `followsTableTail` к общему автомату; вызвать один scroll-to-end после обновлённого измерения последнего virtual item, если пользователь following. Не прокручивать на каждый content chunk без изменения геометрии.
- [ ] Сохранить координату виртуальной опорной строки при prepend и переключении вкладки; клик по существующему переходу к хвосту включает following, ручной уход вверх его прерывает.
- [ ] Запустить узкие тесты и проверить таблицу и таймлайн при 500+ записях в браузере.

### Task 10: Интеграция, доступность, снимок приложения и документы

**Files:** Modify [Conversation README](../../../packages/client/ui-conversation/README.md), парный `README.zh.md` и `README.i18n.yaml`; [Trajectory README](../../../packages/client/ui-trajectory/README.md) с парой; при изменении Tool UI — [Tool README](../../../packages/client/ui-tool/README.md) с парой; Create Agent Note в `.agents/notes/implemented/feature/`; Add or update keyless snapshot under [web snapshot suite](../../../apps/web/tests/).

**Interfaces:** конечное состояние всех задач 1–9. Для собранного web snapshot использовать реальный runnable example/replay, а не mock-only UI fixture.

- [ ] Создать runnable case `apps/web/tests/conversation-feed.snapshot.ts` с тестом `conversation feed and follow`: пользовательский ход, read/edit/ошибка, раскрытие, навигация по запросам и состояние выполнения в реально собранном приложении.
- [ ] Пройти чек-лист спецификации на Chrome/Edge и доступном Firefox/Safari: мышь, touch, клавиатура, screen reader labels, narrow width, светлая/тёмная тема, reduced motion, длинный путь и длинный код в Tool card.
- [ ] Проверить rail по центру ленты: активная риска меняется при чтении, прыжок открывает нужный запрос после prepend, видимые риски ограничены и не закрывают кнопку «К последнему».
- [ ] Повторить профилирование задачи 1; записать baseline и результат на одной машине, DOM count, p95 кадров, самый длинный кадр, причину любого превышения 50 мс и исправление.
- [ ] Обновить JSDoc, README пары, Agent Note и граф: `D:\Deepseec_DaVinchi\.venv-graphify\Scripts\graphify.exe update packages`.
- [ ] Запустить затронутые Vitest файлы, `pnpm run test:snapshot -t "conversation feed and follow"`, `pnpm run typecheck`, `pnpm run doc-sync`, `git diff --check`; сообщить только фактически выполненные команды и результаты.
- [ ] Сверить каждый пункт спецификации с тестом, браузерным наблюдением или профилем; изменения кода считать готовыми лишь после этой проверки.

## Контроль согласования

- [ ] Согласован визуальный эталон 50 действий и плотность строк.
- [ ] Согласовано положение и поведение рисок навигации по запросам.
- [ ] Согласован порядок задач и сохранение поведения во всех трёх вкладках.
- [ ] После согласования начать реализацию с задачи 1; до этого файл является планом, не отчётом о сделанных изменениях.
