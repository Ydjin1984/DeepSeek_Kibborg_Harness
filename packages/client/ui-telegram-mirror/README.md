# @deepseek-ai/dsh-client-ui-telegram-mirror

Telegram mirror toggle in the composer tool row (`conversation.input.left`
entry `telegram-mirror`, next to the attach button). One click attaches the
current session's mirror (its events then flow into the configured Telegram
chat); the active state highlights the button.

## Model experience

The button probes `api.telegram.status({ sessionId })` on mount. While the
bridge is unconfigured it is disabled with an explanatory title; once
configured, clicking attaches (`api.telegram.attach`) or detaches
(`api.telegram.detach`) the mirror of the current session. `aria-pressed`
reflects the mirrored state.

## Known Limitations and Deferred Work

- The button state is probed once on mount and updated by its own clicks; a
  mirror attached from another tab/session does not live-sync back into this
  button until it remounts.
- The mirror icon is a hand-drawn Telegram glyph consistent with the 16px icon
  set; no `telegram` glyph exists in `ui-primitives`.
