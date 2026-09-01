# Agent Note: Web-search card model fields

Status: implemented

English | [中文](2026-08-20-web-search-card-model-fields.zh.md)

## Problem

`web-search-deepseek` already stores `model`, `maxTokens`, and `apiVersion` in its settings section and sends them on every auxiliary Messages request. The Plugins search card only edited the key, endpoint, and per-request search budget. A custom Anthropic-compatible gateway — the same kind of hand-declared route the Models page tags Custom — therefore still searched as `deepseek-v4-flash` unless the user edited `settings.yaml`.

## Decision

The search card stages `model`, `maxTokens`, and `apiVersion` next to `baseURL` and `maxUses`. They are the same schema keys the provider already projects per search; the card does not add a config field. Empty drafts clear the user layer so the next search re-inherits the composition default (`deepseek-v4-flash`, `4096`, `2023-06-01`). The Host section validator still owns the positive-integer bounds; the card only checks that a numeric draft is a number.

The Models page's custom-provider editor remains the catalog of LLM routes. Search names one model on one Messages call and does not list or fetch that catalog.

## Alternatives considered

**Reuse the conversation model's route for search.** Rejected because search is a separate Anthropic Messages call with the native `web_search` server tool. An OpenAI-compatible custom route does not answer that call, and coupling the two would make a chat-model switch change search without the user seeing it on this card.

**Fetch the custom provider's model catalog onto the search card.** Rejected because the search request names one model id, not a catalog. Interrogating `llm-pi-ai` from a plugins card would couple two namespaces the Host already keeps separate.

**Leave the fields in `settings.yaml` only.** Rejected because a custom gateway that already has a Models card for those fields still cannot point search at the matching model without a second, hidden edit.

## Consequences

A user who pointed search at a custom Anthropic-compatible endpoint can set that gateway's model id, output-token cap, and Anthropic API version on the same Plugins card as the key and endpoint. The conversation model picker is unchanged. A blank field still means "use the provider default", not "send an empty model name".

## Testing

`packages/client/ui-settings-plugins` stages and saves the three fields with the existing endpoint and budget. `packages/web/web-search-deepseek` projects a stored `model`, `maxTokens`, and `apiVersion` onto the next search request body and `anthropic-version` header without re-registering the provider.
