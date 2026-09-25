# @deepseek-ai/dsh-client-ui-settings-telegram

English | [中文](README.zh.md)

Telegram settings section (`settings.section` entry `telegram`): edits the `telegram` settings namespace (`botToken`, `chatId`) and drives the bridge connectivity test through the wire `telegram` API (`api.telegram.test`).

## Settings section

| field | value |
| --- | --- |
| id | `telegram` |
| locale namespace | `settings.telegram` |

## Model Experience

None, as the section only writes host settings; the telegram bridge owns every model-visible effect of a mirrored session.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- The section is write-only about the token by design: `botToken` is a `role('secret')` settings field, so the mirror never returns it to the browser. The token field starts blank and reports only whether one is configured (badge from `api.telegram.status({})`); a blank token field leaves the stored token untouched, and «Clear token» removes it.
- The configured badge comes from the live bridge (`status`), so it reads `not configured` until the bridge has actually loaded the settings.
- Copy is provided in en/ru/zh; the section itself does not auto-detect a language.
