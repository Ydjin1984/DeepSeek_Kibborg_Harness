# @deepseek-ai/dsh-telegram-bridge

Telegram mirror bridge for the web GUI (`dsh web`). While a session mirror is
attached, the bridge mirrors the session's live event stream into a configured
Telegram chat through Bot API long polling, relays the user's messages and
answers back into the session, and answers `ctx.userQuestions` from the chat
(option buttons or free text).

## Model experience

- Session events are mirrored as chat messages: user lines get a `👤` prefix,
  assistant text streams into one editable message (debounced edits, chunked at
  the Telegram 4096-char cap), and tool calls render as compact action lines
  (`🛠 <command>` style, presenter titles when available) that gain a
  `— ✅` / `— ❌` suffix once the tool settles.
- `ask_user_question` batches arrive as chat questions with inline buttons for
  single-select options and numbered-text instructions for multi-select;
  free-form questions accept a plain text answer. Only one question is asked at
  a time so every answer is unambiguous.
- While a mirror is attached, any chat message the user sends (outside an
  active question) is delivered to the session as an ordinary user message and
  wakes the agent — the same path the browser uses.
- Settings live in the `telegram` settings namespace (`botToken` is a
  `role('secret')` field; `apiBaseUrl` is a test/proxy seam). Polling restarts
  whenever settings change.

## Architecture

- `TelegramBridgeService` (default export, a cordis `Service`) is the host
  face consumed by the api gateway (`ctx.get('telegramBridge')`, structurally
  typed there): `status`, `attach`, `detach`, `test`.
- `BotClient` is a thin fetch wrapper over the Bot API; `ChatTransport` is the
  seam the mirror and the question provider render through (unit tests use an
  in-memory recorder).
- Mirroring subscribes to `ctx.on('session/event', ...)` and ignores sessions
  other than the attached one; only events after `attach` are forwarded.
- The question channel is a `ctx.userQuestions` provider registered only while
  a mirror is attached; the shared service aborts competing channels (web GUI
  included) once any channel answers.

## Known Limitations and Deferred Work

- Long polling keeps one HTTP connection open to `api.telegram.org`; a
  firewalled or offline host retries every 5 s. An `Unauthorized` response
  stops polling until settings change.
- Multi-select questions are answered by numbers instead of toggle buttons.
- Streaming text is chunked at hard message boundaries (mid-word splits are
  possible) when it exceeds the Telegram length cap.
- Incoming messages require the target agent to be live in this process
  (`ctx.agents.get`); cold sessions are not resumed by the bridge.
