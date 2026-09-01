# DeepSeek Harness

[English](README.md) | [中文](README.zh.md) | **Русский**

DeepSeek Harness (`dsh`) — это фреймворк с открытым исходным кодом для создания агентов, разработанный [DeepSeek AI](https://deepseek.com).

Он использует архитектуру, в которой **всё является плагином**, и работает на базе [Cordis](https://github.com/cordiverse/cordis) — дизайн которой описан в работе [_Парадигма программирования для пространственно-временной композируемости_](https://github.com/cordiverse/paper).

## Предварительный выпуск для разработчиков

DeepSeek Harness в настоящее время находится в стадии _предварительного выпуска для разработчиков_ и быстро развивается. **Ожидайте изменения, несовместимые с предыдущими версиями.**

## Запуск

### Запуск через `npm`

Установите `Node.js`, затем выполните:

```sh
npx @deepseek-ai/dsh web
```

Команда запускает веб-интерфейс по умолчанию по адресу `http://127.0.0.1:3080` и открывает его в браузере по умолчанию при локальном запуске. При запуске через SSH выводится только URL хоста, поскольку SSH-клиент или редактор управляют локально перенаправленным адресом. Параметр `--no-open` запускает сервер без открытия браузера. См. [Руководство по веб-интерфейсу](docs/user/guide/index.md).

### Запуск из исходного кода

Для запуска из репозитория:

```sh
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
pnpm install
pnpm run build
pnpm dsh web
```

`pnpm run build` подготавливает артефакты репозитория. `pnpm dsh web` использует эти артефакты без повторной сборки.

## Сообщество и поддержка

- Не стесняйтеся отправлять отзывы и отчёты об ошибках через [GitHub Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions).
- Добавьте тему [`dsh-plugin`](https://github.com/topics/dsh-plugin) к репозиторию вашего плагина для лучшей обнаруживаемости.
- Присоединяйтесь к [Discord-сообществу DeepSeek Harness](https://discord.gg/Ycq5dCaS4).

## Вклад в проект

См. [CONTRIBUTING.md](CONTRIBUTING.md).

## Разработка

Начните с [руководства по разработке](docs/development.md) и [документации по архитектуре](docs/architecture.md).

Для агентов следуйте [AGENTS.md](AGENTS.md).

## Лицензия

[MIT](LICENSE)

Зависимости третьих сторон и их лицензии указаны в [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
