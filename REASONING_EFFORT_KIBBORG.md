# Уровень размышления для Kibborg (Qwen3.8-27B): разбор и внесённые правки

Документ фиксирует, почему в GUI у модели Kibborg не было выбора уровня рассуждения, как это должно
работать по документации модели и llama.cpp, что именно изменено на стороне харнесса и что (не) требуется
на стороне сервера.

## 1. Что было не так

Маршрут `davinchi` в `~/.dsh/settings.yaml` объявлял модели без поля `reasoningEfforts`. По контракту
`@deepseek-ai/dsh-llm-pi-ai` такая модель материализуется с `reasoning: false`, и
`ctx.llm.resolveModelInfo()` не отдаёт метаданные `reasoning` вообще — не потому что «нет уровней», а потому
что о способностях модели ничего не заявлено. Клиент тогда рисует «У этой модели нет уровней рассуждения»
(`packages/client/ui-model-selection/src/client/ModelSelect.tsx`, локаль `empty.efforts`).

Доказательство «до правки» — ответ живого GUI по RPC:

```
POST http://127.0.0.1:3080/api/llm.models
{"type":"client-request","rpcId":"probe-1","method":"llm.models","payload":{}}

== provider: davinchi | davinchi
    Kibborg_Flash_v5.7 | reasoning: null
    Kibborg_Auto | reasoning: null
    ...
```

Побочно выяснилось: `agent-default-model` в тот момент уже указывал на `davinchi/Kibborg_Flash_v5.7`, то есть
это головная модель текущих сессий (в логах `~/.dsh/sessions` — 518 запросов с `provider: davinchi`).

## 2. Как это должно работать

### Модель (официальная документация)

[Qwen3.8-27B Practical Guide: Control Reasoning Depth](https://www.alibabacloud.com/blog/603509):

- модель мыслит по умолчанию;
- `reasoning_effort`: **xhigh (по умолчанию), medium, low**;
- `chat_template_kwargs`: `enable_thinking` (включено по умолчанию), `preserve_thinking` (включено по
  умолчанию);
- контекст 262 144 нативно, до 1M через YaRN — совпадает с `n_ctx` вашего сервера.

### Ваш сервер (llama.cpp)

`GET /mcp/kiborg/props` (model_path `Ternary-Bonsai-2-27B-Abliterated-PQ2_0.gguf`, build `b10685`,
`owned_by: llamacpp`, `total_slots: 1`) отдаёт:

```json
"chat_template_caps": {
  "supports_tools": true, "supports_parallel_tool_calls": true,
  "supports_preserve_reasoning": true, "supports_reasoning_effort": true, ...
}
```

Сам шаблон (`props.chat_template`, сохранён в `/tmp/kiborg-chat-template.jinja`):

```jinja
{%- if enable_thinking is undefined or enable_thinking is true %}
    {%- set resolved_reasoning_effort = reasoning_effort|default('xhigh') %}
    {%- if resolved_reasoning_effort not in ('xhigh', 'medium', 'low') %}
        {{- raise_exception('Unexpected reasoning effort ... Supported types are xhigh (default), medium, and low.') }}
...
{%- if enable_thinking is defined and enable_thinking is false %}
    {{- '<think>\n\n</think>\n\n' }}
{%- else %}
    {{- '<think>\n' }}
```

Отсюда три практических следствия:

1. «Выключить размышление» — это `enable_thinking: false` (шаблон закрывает пустой `<think></think>`).
2. Допустимы только три значения усилия: `xhigh`, `medium`, `low`; любое другое, дошедшее до шаблона, —
   `raise_exception`. На живом сервере неподдерживаемые значения просто отбрасываются: `high`, `minimal`,
   `ultra` дали на проводе ровно режим по умолчанию (`prompt_tokens: 701`).
3. `reasoning_effort` и `chat_template_kwargs` llama.cpp прокидывает в шаблон (проверено ниже).

Полезный фон по llama.cpp: [PR #20479](https://github.com/ggml-org/llama.cpp/pull/20479) (support
`reasoning_effort` из OAI/OpenRouter/Claude) и [PR #27221](https://github.com/ggml-org/llama.cpp/pull/27221)
(`reasoning_effort: none` → `enable_thinking: false`; в PR приведён пример конфигурации pi для
`qwen3.8-27b` с `thinkingLevelMap: {off: "none", max: "xhigh"}`).

## 3. Что внесено в харнесс

Харнесс уже умеет всё нужное (фича «per-model reasoning declarations», пакет `llm-pi-ai`), поэтому правка —
чистая конфигурация: **`~/.dsh/settings.yaml`** (резервная копия —
`~/.dsh/settings.yaml.bak-20260926-232822`). Код репозитория не менялся.

Изменения:

1. Маршрут `davinchi` остался за головной моделью (её id в существующих сессиях не меняется) и получил
   объявление уровней и проводной диалект шаблона:

```yaml
    davinchi:
      apiKeyEnv: DAVINCHI_API_KEY
      api: openai-completions
      baseURL: https://davinchi-crypto.com/mcp/kiborg/v1
      displayName: Kibborg (Qwen3.8-27B)
      reasoning: max                      # уровень для запроса, не назвавшего свой
      compat:
        thinkingFormat: chat-template     # ход мыслей идёт через chat_template_kwargs
        chatTemplateKwargs:
          enable_thinking:
            $var: thinking.enabled        # уровень выбран -> true, Off -> false
          reasoning_effort:
            $var: thinking.effort         # имя уровня -> то, что понимает шаблон
          preserve_thinking: true
        supportsDeveloperRole: false      # системный промпт уходит ролью system, не developer
        supportsStore: false              # не отправляем поле store, которого сервер не знает
      models:
        - id: Kibborg_Flash_v5.7
          name: Kibborg_Flash_v5.7
          contextWindow: 262144
          maxTokens: 262144
          reasoningEfforts:
            "off":                        # кнопка «выключить» -> enable_thinking: false
            low: low
            medium: medium
            max: xhigh                    # «Max» в GUI = xhigh модели
```

2. Роутеры без размышления (`Kibborg_Auto`, `Kibborg_Worker_*`) переехали на отдельный маршрут
   `davinchi-workers` с тем же адресом и ключом. Причина содержательная: `reasoning` — умолчание **маршрута**,
   и оно обязано поддерживаться каждой моделью на нём; поставив `reasoning: max` рядом с моделями без
   размышления, мы получили бы `UNSUPPORTED_REASONING_EFFORT` на каждый запрос к воркерам
   (ровно этот случай описан в `.agents/notes/implemented/feature/2026-08-08-pi-ai-per-model-reasoning-declarations.md`).
   Воркеры в сессиях не использовались, так что перенос provider id ничего не ломает.

Проверки на живом сервере подтвердили, что воркеры действительно не мыслят (даже в режиме по умолчанию
`reasoning_content` не приходит), поэтому уровень им и не предлагается.

## 4. Что реально уходит по проводу

Прогон настоящего адаптера (`PiAiAdapter.stream`) с этим же профилем против локального мока, который печатал
тело запроса:

| Уровень в GUI | `chat_template_kwargs` |
|---|---|
| (ничего не выбрано → умолчание маршрута) | `{"enable_thinking":true,"reasoning_effort":"xhigh","preserve_thinking":true}` |
| Off | `{"enable_thinking":false,"preserve_thinking":true}` |
| Low | `{"enable_thinking":true,"reasoning_effort":"low","preserve_thinking":true}` |
| Medium | `{"enable_thinking":true,"reasoning_effort":"medium","preserve_thinking":true}` |
| Max | `{"enable_thinking":true,"reasoning_effort":"xhigh","preserve_thinking":true}` |

Там же подтвердилось: роль системного промпта — `system` (не `developer`), выход ограничивается полем
`max_completion_tokens` (сервер его читает, см. ниже), `store` не отправляется.

## 5. Проверки на живом шлюзе

1. Каталог GUI после правки (тот же RPC, без перезапуска сервера — сработал вотчер настроек):

```
== provider: davinchi | Kibborg (Qwen3.8-27B)
    Kibborg_Flash_v5.7 | reasoning: {"efforts":[{"id":"off","name":"Off"},{"id":"low","name":"Low"},
                                       {"id":"medium","name":"Medium"},{"id":"max","name":"Max"}],
                                       "defaultEffort":"max"}
== provider: davinchi-workers | Kibborg workers
    Kibborg_Auto | reasoning: null
```

2. Прямые запросы к шлюзу (`POST /mcp/kiborg/v1/chat/completions`, max_tokens 16–24):

| Что отправлено | Ответ |
|---|---|
| ничего | `reasoning_content: "We need to respond to user..."`, `content: ""` |
| `chat_template_kwargs: {enable_thinking: false}` | `content: "ok"`, `reasoning_content: null`, `finish: stop` |
| `chat_template_kwargs: {enable_thinking: true, reasoning_effort: "low"}` | размышление есть, инструкция low (689 токенов промпта) |
| `chat_template_kwargs: {..., reasoning_effort: "medium"}` | размышление есть, без инструкции (659) |
| `chat_template_kwargs: {..., reasoning_effort: "high"/"minimal"/"ultra"}` | значение отброшено, режим по умолчанию (701) |
| `reasoning_effort: "none"` (верхнего уровня или в kwargs) | `content: "ok"`, размышления нет (661) |
| `max_completion_tokens: 5` | `finish: length`, `completion_tokens: 5` — поле читается |

3. Сквозной прогон через адаптер харнесса по реальному шлюзу (`Kibborg_Flash_v5.7`, «Reply with the single
   word: ok», `maxTokens: 64`):

```
effort=off        reasoningChars=   0  text="ok"
effort=low        reasoningChars= 208  text="ok"
effort=max        reasoningChars= 171  text="ok"
effort=(умолчание) reasoningChars= 270  text="ok"
```

То есть Off действительно выключает размышление, три уровня действительно меняют глубину, а запрос без
уровня (так выглядят уже существующие сессии) продолжает мыслить — как и до правки.

## 6. Сторона сервера

**Обязательных правок на сервере не требуется**: llama.cpp `b10685` уже принимает и `chat_template_kwargs`,
и `reasoning_effort`, отдаёт `reasoning_content` в стриме и читает `max_completion_tokens`. Харнесс теперь
говорит с моделью ровно на её языке.

Что стоит знать/проверять на стороне сервера:

1. **Не пробрасывайте в шаблон значения вне набора `xhigh|medium|low`** — шаблон бросает
   `raise_exception('Unexpected reasoning effort ...')`. Если в логах llama.cpp появится эта строка, значит
   какой-то клиент отправил `high`/`max`/`minimal` напрямую. Сам llama.cpp такие значения пока отбрасывает
   молча (режим по умолчанию), но это поведение зависит от сборки.
2. **Ваш конфиг не опирается на маппинг `reasoning_effort: none` → `enable_thinking: false`** (который живёт
   в ещё не влитых PR llama.cpp #20479/#27221). Выключение идёт через `enable_thinking: false` — это
   документированная переменная шаблона Qwen, поэтому обновление llama.cpp не сломает кнопку Off.
3. **`preserve_thinking`** отправляется явно (`true`, совпадает с умолчанием модели) — историческое
   размышление сохраняется в многоходовых диалогах.
4. **Роль системного промпта теперь `system`** (было `developer` при автоопределении pi-ai, потому что
   модель стала reasoning). Оба варианта сервер принимал, но `system` — штатный путь шаблона.
5. **Один слот** (`total_slots: 1`): запросы сериализуются. В замерах «off» иногда отвечал дольше «max»
   именно из-за очереди, а не из-за режима.
6. Если когда-нибудь захочется поддержать в GUI метку «High» отдельно от «Max» — это одна строка в
   `settings.yaml`, сервер менять не нужно (см. ниже).

## 7. Как менять и как откатить

- **Добавить/переименовать уровни** — правка `reasoningEfforts` в `~/.dsh/settings.yaml`. Например, чтобы
  работал и `high` (на случай, если какая-то поверхность харнесса пришлёт его напрямую):
  `high: xhigh`. Значение слева — ключ уровня, справа — то, что понимает шаблон (`xhigh|medium|low`).
- **Изменить поведение «ничего не выбрано»** — строка `reasoning: max` у маршрута (`off`, `low`, `medium`,
  `max`; без неё запрос без уровня уйдёт с `enable_thinking: false`, то есть с выключенным размышлением).
- **Вернуть воркеров на маршрут `davinchi`** можно только убрав `reasoning: max` у маршрута — иначе их
  запросы начнут падать с `UNSUPPORTED_REASONING_EFFORT`.
- **Полный откат** — вернуть файл из `~/.dsh/settings.yaml.bak-20260926-232822`.
- Перезапуск GUI не нужен: секция `llm-pi-ai` перечитывается на каждую операцию, каталог моделей
  перезапрашивается при каждом открытии выбора модели. Достаточно обновить страницу и раскрыть выбор
  модели: у Kibborg появятся Off / Low / Medium / Max, по умолчанию выбран Max.

## 8. Артефакты проверок

- `~/.dsh/settings.yaml` — рабочая конфигурация (изменена), `~/.dsh/settings.yaml.bak-20260926-232822` — до правки.
- `/tmp/kiborg-reasoning-probe/probe-reasoning.mts` — прогон профиля против мока с печатью тела запроса.
- `/tmp/kiborg-reasoning-probe/probe-live.mts` — сквозной прогон по реальному шлюзу (Off/Low/Max/умолчание).
- `/tmp/kiborg-props.json`, `/tmp/kiborg-chat-template.jinja` — `/props` шлюза и его шаблон чата.
- `/tmp/davinchi-profile.json` — профиль маршрута, выгруженный из `settings.yaml` для проб.
- `/tmp/gui-models.json` — ответ RPC `llm.models` работающего GUI после правки.

Оба `probe-*.mts` из репозитория удалены; дерево `git status` содержит только ранее существовавшие правки
(`packages/skill/skill-manager/*`, неотслеживаемые `launcher.sh`, `run.sh`).
