# Agent Note: Web GUI Russian locale

Status: implemented

English | [中文](2026-08-20-web-gui-russian-locale.zh.md)

## Problem

The browser client shipped only `zh` and `en`. A user who wanted a Russian UI had no selector entry, and a `ru-*` browser opened in English because Russian was not a shipped locale. Product copy already lived in per-namespace dictionaries; adding a language is a third dictionary plus a `LocaleId`, not a parallel i18n stack.

## Decision

`ru` is a shipped `LocaleId` next to `zh` and `en`. The Language row lists it as `Русский`. Browser detection matches the `ru` primary subtag (`ru-RU` → `ru`). `<html lang>` for that locale is `ru`. The Host settings schema accepts `preference: ru`. Typed `register(ns, dicts)` requires a dictionary for every shipped locale, and the dictionary-parity gate compares `zh`/`en`/`ru` key sets so a missing Russian string cannot ship as a bare key.

Fallback remains English: an unshipped browser language still opens in `en`, and a key missing from the active locale still reads the `en` dictionary. Contributor documentation stays an English/Chinese pair; this change is the product GUI locale, not the docs pairing contract.

Every client dictionary owner registers `{ zh, en, ru }` (or the three-argument form for `permission.access` and the browse directory picker). Welcome-notice copy has a `ru` member consumed by the models settings dictionaries.

## Alternatives considered

- **Ship Russian only in settings chrome** — the Language row would switch `<html lang>` while the rest of the GUI stayed English or Chinese; the selector would lie.
- **Treat Russian as a docs-pairing language** — contributor Markdown pairing is a bilingual English/Chinese contract with sidecars and merge drivers; folding a third docs language into that gate is a different change from making the GUI switch.

## Consequences

A stored `locale.preference: ru` is durable in `$DSH_HOME/settings.yaml` the same way `zh` and `en` are. Adding a fourth GUI language repeats this pattern: extend `LOCALE_IDS`, add dictionaries, keep the parity gate's shipped-locale list in lockstep. Registry-captured copy (command descriptions registered once) still does not follow a live switch until re-registration. Cordis-free primitives (SearchBlock, ReadBlock, DiffBlock, WebBlock, TerminalBlock) take a `labels` prop; conversation tool rows pass the active locale through those props so a language switch reaches the cards.

## Testing

`scripts/locale-dictionary-parity.spec.ts` requires identical keys across `zh`/`en`/`ru`. `packages/client/locale` specs cover selector membership, `ru-RU` detection, Host schema acceptance, and `<html lang>="ru"`. `apps/web/tests/settings-chrome.e2e.ts` opens a `ru-RU` browser onto the Russian settings dialog and pins `dialog-ru.expected.md`.
