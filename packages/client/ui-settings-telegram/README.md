# @deepseek-ai/dsh-client-ui-settings-telegram

Telegram settings section (`settings.section` entry `telegram`): edits the
`telegram` settings namespace (`botToken`, `chatId`) and drives the bridge
connectivity test through the wire `telegram` API (`api.telegram.test`).

## Model experience

The section is write-only about the token by design: `botToken` is a
`role('secret')` settings field, so the mirror never returns it to the browser.
The token field starts blank and reports only whether one is configured (badge
from `api.telegram.status({})`); a blank token field leaves the stored token
untouched, and «Clear token» removes it. The chat id is a plain editable value.
«Test connection» asks the bridge to send one message through the configured
bot/chat binding and reports the outcome.

## Known Limitations and Deferred Work

- The configured badge comes from the live bridge (`status`), so it reads
  `not configured` until the bridge has actually loaded the settings.
- Copy is provided in en/ru/zh; the section itself does not auto-detect a
  language.
