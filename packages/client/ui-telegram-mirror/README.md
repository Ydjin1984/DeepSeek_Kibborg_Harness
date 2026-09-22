# @deepseek-ai/dsh-client-ui-telegram-mirror

Telegram mirror toggle in the composer tool row (`conversation.input.left` entry `telegram-mirror`, next to the attach button). One click attaches the current session's mirror (its events then flow into the configured Telegram chat); the active state turns the icon green with a glow.

## Model Experience

None, as the button only calls the bridge APIs; the telegram bridge owns every model-visible effect of a mirrored session.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- The button state is probed once on mount and updated by its own clicks; a mirror attached from another tab/session does not live-sync back into this button until it remounts.
- The mirror icon is a hand-drawn Telegram glyph consistent with the 16px icon set; no `telegram` glyph exists in `ui-primitives`.
