# Agent Note: Skill description localization and menu filtering

Status: implemented

English | [中文](2026-08-30-web-skill-description-localization-and-menu-filtering.zh.md)

## Problem

Two gaps in the web composer's "/" menu, reported in locale testing. The skill group filtered candidates with `skill.name.startsWith(query)` — a case-sensitive prefix match — so typing `/sk` matched nothing (no installed skill name starts with `sk`), while the command group filtered by fuzzy subsequence; the two groups behaved so differently that the skill filter read as broken. And every skill row rendered the raw English frontmatter description in any locale, because the skill format carried a single model-facing `description` and the menu was the only locale-aware consumer.

## Decision

**Skill filtering matches the command group's name-keyed behavior.** `ui-skill` candidates now filter by case-insensitive substring on the skill name, so a query matches anywhere in the id (`/eploy` finds `deploy`, `/sk` finds `find-skills`). Empty queries keep every row. The filter stays name-only, exactly like the command group.

**Skill descriptions gain per-locale variants end to end.** The skill core (`dsh-skill`) adds an optional `localizedDescription` map (`zh`/`ru` keys) to `SkillDefinition`, `SkillCandidate`, and `SkillSummary`, validated at every boundary (provider candidates, loaded definitions, runtime registrations) with the base `description` remaining required and the model-facing default. The filesystem provider reads optional `description.zh` / `description.ru` frontmatter keys, and the bundled `dsh-badge` provider carries the same map. The apiproxy `skill.list` wire (`SkillEntry`) projects the map through to the browser, and `ui-skill` renders the active locale's entry with a fallback to the raw description for `en` and unknown locales. The model catalog (`dsh-tool-skill`) is untouched: it maps only `name`/`description`, so localized variants never reach a model request.

The shipped DSH skills (the `.agents/skills` dsh-* set, `record-browser-gif`, the cordis preset skills, and `dsh-badge`) now carry `description.zh` and `description.ru`. User-installed and third-party skills stay English until their authors add the keys — localization is additive content, not a client-side dictionary, because skill catalogs are deployment content a dictionary cannot cover.

## Alternatives considered

- **A client-side translation dictionary keyed by skill name.** Rejected: the catalog is user-installable content (this deployment alone shows 65 personal skills), so a shipped dictionary could cover only the harness's own skills and would rot as skills change. The skill file is where the description is authored, so that is where its translations belong.
- **Translating the candidate `name` in place.** Rejected for the same reason as the command menu: `name` is the pick and lexicon key; only display text is localized.
- **Host-side locale negotiation (`skill.list` taking a locale).** Rejected: the catalog is already cached per session and the map is small; returning every locale and letting the locale-aware client pick keeps the wire stateless and the cache keyed by session alone.

## Consequences

A Russian or Chinese session sees the skill rows in the menu with localized descriptions for any skill that carries them, and the shipped DSH skills now do. Typing a partial name filters the skill group consistently with commands. The model-facing catalog is byte-identical. The frontmatter format gains two optional keys; existing skills are unaffected, and a malformed map fails the skill's validation loudly instead of silently dropping it.

## Testing

- Host: skill-core validation rejects non-object, unknown-locale, and empty localized maps and carries the map through `list()`/`get()`; the filesystem parser reads `description.zh`/`description.ru` from frontmatter; the apiproxy schema and projection pass the map through; `dsh-badge` publishes it.
- Client: ui-skill candidates assert the case-insensitive substring filter (mid-name and case-variant matches, no-match empty), the active-locale description pick with raw fallback, and the user-only prefix over a localized description.
