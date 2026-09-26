# DeepSeek_Kibborg_Harness

[中文](README.zh.md)

**DeepSeek_Kibborg_Harness** — русскоязычный форк [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness): агентная платформа с архитектурой **«всё — плагин»** на [Cordis](https://github.com/cordiverse/cordis), доработанная под персональный оркестр ИИ-агентов — лайв-кодинг, авторизованный пентест, реверс-инжиниринг и смежные задачи.

Платформа построена вокруг режима **оркестратора**: головная (планирующая) модель управляет работой локальных и внешних ИИ-исполнителей, а весь жизненный цикл исполнения — задачи, цели, потоки работ, субагенты, внешние ресурсы — сводится в единую наблюдаемую картину.

---

## Ключевые возможности («плюшки»)

### Оркестратор «голова + исполнитель»
- Головная модель планирует и делегирует; **локальный исполнитель** (Kibborg, с vision) выполняет тяжёлую инструментальную работу и возвращает сжатые отчёты.
- **Head-tool policy, enforced в рантайме**: тяжёлые инструменты (`nmap`, `idat` и др. из списка `headDenyTools`) **скрыты из схемы инструментов головы** (фильтр на `system-prompt/assemble`) и дополнительно **отклоняются на `tools/pre-execute` до approval** — исполнитель (depth ≥ 1) видит и использует их без ограничений.
- Браузерный контур: Chrome с DevTools Protocol (`127.0.0.1:9222`) как инструмент агента (скриншоты, «живой текст» из DOM, клики).

### Единая машина состояний исполнения (`ctx.executions`)
- Общий жизненный цикл: `CREATED → QUEUED → RUNNING → WAITING_TOOL / WAITING_SUBAGENT / WAITING_USER → COMPLETED`; терминальные `FAILED / CANCELLED / TIMEOUT / ABORTED`; ветка восстановления `INTERRUPTED → RECOVERING`.
- **Адаптеры-проекции**: фоновые задачи (`jobs`), цели (`goal`), потоки работ (`workflow`) и субагенты (`subagent`) автоматически проецируют свои статусы в единую машину — вся активность видна в одном месте (вкладка «Исполнение» в GUI).
- Идемпотентность и best-effort проекция: единый реестр остаётся источником правды, подсистемы не мигрируют.

### Реестр «аренды» внешних ресурсов (`ctx.executions.resources`)
- Учёт Chrome CDP / PTY / IDA / workspace / subprocess с **lease + heartbeat + TTL**.
- Fail-closed проверки: `live / expired / released / orphaned / unknown`; идемпотентный **orphan-sweep** — «протухшие» ресурсы помечаются осиротевшими один раз.
- Типизированные события `executions/resource` — фундамент для аудита и восстановления.

### Durable журнал исполнения (Flight Recorder foundation)
- Bridge-плагин `execution-persistence` пишет **append-only JSONL журнал** (`$DSH_HOME/executions/events.jsonl`) событий исполнения и ресурсов — с fsync на каждую запись.
- История «кто и что делал» **переживает рестарты**; два логических журнала (сессия ↔ исполнение) не смешиваются.

### Контур engagement / ROE (безопасность)
- Плагин `engagement-stub`: при включении — **allowlist хостов**; инструменты из `blockedTools` и URL-вызовы на хосты вне scope получают **детерминированный deny до approval** + audit-событие `engagement/denied`.
- localhost всегда разрешён; не-URL-вызовы не блокируются (fail-open для обычных инструментов).

### Система скиллов
- Каталог и менеджер скиллов: CRUD, версии, rollback, корзина, публикация; **бенчмарки и Auto Improve** (A/B, метрики, routing-eval).
- Профильные скиллы: авторизованный пентест (`hakker-kibborg`), реверс-инжиниринг и управление IDA Pro, Tor/onion-поиск, XDF-тюнинг (TunerPro), дизайн/кодинг-наборы.

### Надёжность и durability
- Durable-сессии: JSONL + SQLite (WAL, `synchronous=FULL`), torn-tail recovery, single-writer сериализация — проверено crash/restart e2e-тестами (kill mid-write и др.).
- Полный CI-контур качества: strict TypeScript, 100% per-file coverage, lint, typecheck, snapshot-тесты GUI.

### Web GUI
- React/Vite: чат, **«Исполнение»** (таймлайн событий с фильтрами), «Траектория», файловые панели, настройки (модели, скиллы, плагины), живой мониторинг.

---

## Запуск из исходников

### Требования

- Node.js `^22.19 || >=24` (рекомендуется 24 LTS).
- pnpm `>=11` — включается через Corepack, который поставляется с Node.js 22 и 24.
- Git 2.26 или новее.
- Linux: `build-essential` и `python3` для сборки нативных аддонов.

Проверьте, что уже установлено:

```sh
node -v      # need 22.19+ or 24+
pnpm -v      # need 11+
```

### Установка Node.js, если её нет

**Windows** — проще всего через winget:

```sh
winget install OpenJS.NodeJS.LTS
```

Если нужно держать несколько версий одновременно, поставьте nvm-windows:

```sh
winget install CoreyButler.NVMforWindows
nvm install lts
nvm use lts
```

**Linux** — через [nvm](https://github.com/nvm-sh/nvm#installing-and-updating) (без root, версии переключаются):

```sh
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.5/install.sh | bash
exec "$SHELL" -l
nvm install 24
nvm use 24
```

Или системным пакетом из [NodeSource](https://github.com/nodesource/distributions) — Debian/Ubuntu:

```sh
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs
```

Для Fedora/RHEL первая команда — `curl -fsSL https://rpm.nodesource.com/setup_24.x | sudo bash -`, вторая — `sudo dnf install -y nodejs`.

Пакет `nodejs` из штатного репозитория дистрибутива обычно отстаёт от требуемой версии, поэтому после установки сверяйте вывод `node -v`.

### Обновление Node.js

Обновите версию тем же способом, каким она поставлена:

```sh
winget upgrade OpenJS.NodeJS.LTS   # Windows
nvm install 24 && nvm use 24       # nvm on Linux or macOS
```

После смены версии Node пересоберите зависимости: нативные аддоны привязаны к ABI конкретной версии.

```sh
node -v
pnpm install
pnpm run build
```

### pnpm

Включите Corepack, и pnpm возьмётся из `packageManager` проекта:

```sh
corepack enable
```

В Node.js 25 и новее Corepack не поставляется: поставьте его отдельно (`npm install -g corepack`) или сам pnpm (`npm install -g pnpm@11`).

### Клонирование и сборка

Клонируйте **этот** репозиторий (не upstream):

```sh
git clone https://github.com/Ydjin1984/DeepSeek_Kibborg_Harness.git
cd DeepSeek_Kibborg_Harness
pnpm install
pnpm run build
pnpm dsh web
```

Web UI запускается на `http://127.0.0.1:3080`. На Windows удобно использовать `run.bat` (меню сборки и запуска с прогресс-баром). На Linux доступ с другой машины открывается пробросом порта: `ssh -N -L 3080:127.0.0.1:3080 user@host`.

---

## Оригинальный проект

DeepSeek_Kibborg_Harness основан на [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`) — открытой агентной платформе DeepSeek AI (лицензия MIT). Оригинальное описание, архитектурная документация и руководства находятся в [репозитории upstream](https://github.com/deepseek-ai/deepseek-harness) и в папке [`docs/`](docs/architecture.md) этого репозитория.

## Вклад в проект

См. [CONTRIBUTING.md](CONTRIBUTING.md) и [AGENTS.md](AGENTS.md) (правила для агентов и процессов разработки).

## Лицензия

[MIT](LICENSE)
