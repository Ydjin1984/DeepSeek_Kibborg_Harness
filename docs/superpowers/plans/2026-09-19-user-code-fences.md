# User Code Fences Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Сделать тройные обратные кавычки понятным визуальным способом выделить код в черновике и отправленном пользовательском сообщении, сохранив точный исходный текст для модели.

**Architecture:** Один чистый parser размечает диапазоны fenced code и используется обнаружением input triggers, декорацией textarea и отображением сообщения. Composer сохраняет нативную textarea и свой единственный scrollport; пользовательский пузырь выводит обычный текст через текущие reference chips и code-сегменты через существующий CodeBlock. Изменяются только правила интерпретации UI и trigger policy, не формат session log.

**Tech Stack:** TypeScript, React, CSS modules, существующие `ui-input-trigger` и `ui-primitives/CodeBlock`, Vitest, Testing Library, keyless web snapshots.

**Spec:** [Лента действий и код пользователя](../specs/2026-09-19-conversation-activity-design.md). Соседний независимый план: [Conversation Feed and Bottom Follow](2026-09-19-conversation-feed-and-follow.md).

## Global Constraints

- Текст черновика, отправленное сообщение и input модели побайтно сохраняют введённые символы; rendering не переписывает logged content.
- Parser поддерживает несколько блоков, необязательный язык, незакрытый блок, CRLF и текст вокруг; fence распознаётся только на отдельной строке с 0–3 ведущими пробелами и не менее чем тремя обратными кавычками. Закрывающая строка имеет не меньше кавычек, чем открывающая, и только пробелы после них.
- В composer декорация не меняет font metrics, caret, selection, IME, paste, undo/redo, автоперенос, высоту и wheel chaining.
- Внутри fenced block символы `@` и `/` остаются буквальным кодом: popup, команды, inline reference и chip не возникают. Уже существующая структурная ссылка, обёрнутая fence, переводится в обычный буквальный текст без скрытого reference payload.
- Неизвестный язык и отсутствие языка показывают обычный код без ошибки; пользовательский HTML остаётся текстом.
- Код и документация меняются с парными README, JSDoc, Agent Note и keyless snapshot в том же изменении.
- До правки packages читать [архитектуру](../../architecture.md), [защитные паттерны](../../defensive-patterns.md), [packages instructions](../../../packages/AGENTS.md) и локальный graphify.

---

## Карта файлов и ответственности

| Область | Владелец | Изменения |
|---|---|---|
| Единый parser | Новый `packages/client/ui-input-trigger/src/core/fenced-code.ts`; [trigger detector](../../../packages/client/ui-input-trigger/src/core/detect.ts); [client entry](../../../packages/client/ui-input-trigger/src/client/index.ts) | Диапазоны, активность caret, подавление trigger внутри кода. |
| Черновик | [decorations.ts](../../../packages/client/ui-conversation/src/client/contract/decorations.ts), [InputBar.tsx](../../../packages/client/ui-conversation/src/client/skeleton/InputBar.tsx), `InputBar.module.css`, [input machine](../../../packages/client/ui-conversation/src/client/input/machine.ts) | Оформление fence/code, пересечения с chips, сохранение текста. |
| Отправленный пузырь | [MessageItem.tsx](../../../packages/client/ui-conversation/src/client/chat/MessageItem.tsx), `MessageItem.module.css`, [CodeBlock.tsx](../../../packages/client/ui-primitives/src/markdown/CodeBlock.tsx) | Сегменты обычного текста и code cards, копирование точного содержимого. |
| Проверки | [trigger tests](../../../packages/client/ui-input-trigger/tests/core-detect.client.spec.ts), [input tests](../../../packages/client/ui-conversation/tests/input-bar.client.spec.tsx), [chat tests](../../../packages/client/ui-conversation/tests/chat-view.client.spec.tsx), [markdown tests](../../../packages/client/ui-primitives/tests/markdown.client.spec.tsx), [web snapshots](../../../apps/web/tests/snapshots/) | Parser, редактор, bubble, собранное приложение. |

### Task 1: Однопроходный разбор fenced code

**Files:** Create `packages/client/ui-input-trigger/src/core/fenced-code.ts`; Modify [client entry](../../../packages/client/ui-input-trigger/src/client/index.ts); Test новый `fenced-code.client.spec.ts`.

**Interfaces:** `FencedSegment = { kind: 'text'; start: number; end: number } | { kind: 'code'; fenceStart: number; contentStart: number; contentEnd: number; fenceEnd: number; lang: string | null; closed: boolean }`; `scanFencedSegments(text: string): readonly FencedSegment[]`; `isFencedCodeOffset(text: string, offset: number): boolean`. Все offset относятся к исходной строке в UTF-16 единицах, как textarea selection и occurrence ranges.

- [ ] Написать красные тесты на обычный текст, один и несколько блоков, `ts` и неизвестный язык, CRLF, ведущие пробелы, незакрытый блок, длинную открывающую строку, тройные кавычки внутри строки кода и Unicode до блока.
- [ ] Запустить `pnpm exec vitest run packages/client/ui-input-trigger/tests/fenced-code.client.spec.ts`; тест падает из-за отсутствия parser.
- [ ] Реализовать линейный разбор строк без HTML/Markdown интерпретации и без копирования содержимого блоков на каждом шаге; вернуть неперекрывающиеся диапазоны, покрывающие исходную строку.
- [ ] Повторить тест и проверить, что на черновике 100 000 символов нет квадратичного прохода; результат benchmark сохранить рядом с fixture.

### Task 2: Отключить trigger и структурные ссылки внутри кода

**Files:** Modify [trigger detector](../../../packages/client/ui-input-trigger/src/core/detect.ts), [decorations.ts](../../../packages/client/ui-conversation/src/client/contract/decorations.ts), [input machine](../../../packages/client/ui-conversation/src/client/input/machine.ts) и при необходимости [controller](../../../packages/client/ui-input-trigger/src/client/controller.ts); Test [trigger tests](../../../packages/client/ui-input-trigger/tests/core-detect.client.spec.ts), [input machine tests](../../../packages/client/ui-conversation/tests/input-machine.client.spec.ts), [reference submit tests](../../../packages/client/ui-conversation/tests/input-reference-submit.client.spec.ts).

**Interfaces:** `detectTrigger(draft, caret, guard)` возвращает null при caret внутри code content; `scanTextRefs` и `deriveDecorations` не создают диапазон, пересекающий code content; occurrence, заключённый пользователем в fence, перестаёт нести structured reference при отправке и оставляет буквальные символы в draft.

- [ ] Добавить красные тесты: набор `@file` и `/goal` внутри fenced block не открывает меню; те же токены снаружи работают; закрытие fence снова включает обычное поведение.
- [ ] Добавить красный тест на уже вставленный file/session chip, который пользователь потом обернул fence: видимый текст остаётся в коде, payload ссылки не отправляется.
- [ ] Подключить единый parser к detector и decoration scan; проверить caret на открывающей/закрывающей строке и рядом с границей блока.
- [ ] Выполнить нормализацию occurrence при изменении draft через существующую reconcile операцию, а не отдельную правку текста на отправке; undo восстанавливает ожидаемое состояние.
- [ ] Запустить узкие тесты trigger, input machine и reference submit, включая IME и paste с несколькими блоками.

### Task 3: Оформление кода в поле ввода без сдвига caret

**Files:** Modify [InputBar.tsx](../../../packages/client/ui-conversation/src/client/skeleton/InputBar.tsx), `InputBar.module.css`, [decorations.ts](../../../packages/client/ui-conversation/src/client/contract/decorations.ts); Test [input bar tests](../../../packages/client/ui-conversation/tests/input-bar.client.spec.tsx), [input scenarios](../../../packages/client/ui-conversation/tests/input-scenarios.client.spec.tsx), [Safari tests](../../../packages/client/ui-conversation/tests/safari.client.spec.ts).

**Interfaces:** существующие `backdrop`, `textarea` и `mirror` продолжают жить в одном scrollport. Декорация использует offset-сегменты parser и выдаёт один text/span на диапазон, без отдельного DOM узла на каждый символ.

- [ ] Добавить тесты на подсветку открывающей/закрывающей строки, фон code content, незакрытый блок и две пары fence; проверить, что `textarea.value`, selectionStart/End и отправленный draft остаются исходными.
- [ ] Слить диапазоны fence/code с текущими claim/chip/text-ref ranges по исходным offset; range внутри кода всегда выигрывает у декоративной ссылки.
- [ ] Ограничить CSS цветом, фоном и outline/box-shadow без padding, border, font или line-height изменений, чтобы backdrop и textarea сохраняли идентичные glyph metrics.
- [ ] Проверить браузером перенос длинной строки, 14-строчный cap, прокрутку колесом над composer, IME, paste, undo/redo, disabled state и узкий экран.
- [ ] Запустить указанные тесты; при расхождении glyph/caret не добавлять JS синхронизацию двух scrollport — исправить метрики слоя.

### Task 4: Code card в отправленном пользовательском сообщении

**Files:** Modify [MessageItem.tsx](../../../packages/client/ui-conversation/src/client/chat/MessageItem.tsx), `MessageItem.module.css`, [CodeBlock.tsx](../../../packages/client/ui-primitives/src/markdown/CodeBlock.tsx); Test новый `user-fences.client.spec.tsx`, [CodeBlock/markdown tests](../../../packages/client/ui-primitives/tests/markdown.client.spec.tsx), [chat tests](../../../packages/client/ui-conversation/tests/chat-view.client.spec.tsx).

**Interfaces:** `projectUserText` принимает сегменты parser; text-сегменты проходят существующее оформление ссылок, code-сегменты — `CodeBlock`. При необходимости добавить `CodeBlock.preserveTrailingNewline?: boolean` с default false; при true копирование берёт точный `code`, не обрезанный DOM text.

- [ ] Добавить красные тесты: текст до/после, несколько code cards, язык, неизвестный язык, backticks и HTML внутри кода, `@` внутри кода без ref chip, сохранённый завершающий перенос, корректная копия.
- [ ] Разделить text/code до прохода `projectUserText`; ссылочные chip строить только по text-сегментам, используя исходные offset и реальные reference labels.
- [ ] Использовать существующий `CodeBlock` для языка, подсветки и copy; изменить его trailing-newline policy только по явному prop, чтобы другие потребители сохранили прежнее поведение.
- [ ] Проверить одинаковое оформление обычного user message, pending steering bubble и сообщения после reload; никакой пользовательский HTML не попадёт в DOM как разметка.
- [ ] Запустить указанные тесты и просмотреть 50-строчный пример в браузере.

### Task 5: Собранный снимок, документы и финальная проверка

**Files:** Add or update runnable case under [web snapshots](../../../apps/web/tests/snapshots/); Modify [ui-conversation README](../../../packages/client/ui-conversation/README.md) с парой `README.zh.md`/`README.i18n.yaml`, [ui-input-trigger README](../../../packages/client/ui-input-trigger/README.md) с парой и при изменении API [ui-primitives README](../../../packages/client/ui-primitives/README.md) с парой; Create Agent Note in `.agents/notes/implemented/feature/`.

**Interfaces:** исходный model-visible user text равен введённому тексту, включая fence и пробелы; UI snapshot показывает разницу между обычным текстом и code card в собранном приложении.

- [ ] Создать runnable case `apps/web/tests/user-code-fences.snapshot.ts` с тестом `user fenced code`: запрос с обычным текстом, fenced code и `@` внутри кода; проверить log/model input и DOM проекта без mock-only fixture.
- [ ] Проверить accessibility: language label, кнопка копирования, клавиатурный фокус, светлая/тёмная тема, reduced motion и мобильная ширина.
- [ ] Обновить публичные JSDoc, README пары и Agent Note; выполнить локальный graphify update packages.
- [ ] Запустить затронутые Vitest тесты, `pnpm run test:snapshot -t "user fenced code"`, `pnpm run typecheck`, `pnpm run doc-sync`, `git diff --check`; перечислить только фактически выполненные проверки.
- [ ] Сверить критерии спецификации с тестами и снимком, а результаты browser/caret проверки записать в итоговом отчёте.

## Контроль согласования

- [ ] Согласован стиль fenced code в composer и отправленном сообщении.
- [ ] Согласовано буквальное поведение ссылок и команд внутри кода.
- [ ] Реализация начинается после согласования этого плана; текущий документ описывает будущие задачи.
