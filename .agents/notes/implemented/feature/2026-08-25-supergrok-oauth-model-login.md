# Agent Note: SuperGrok OAuth model login

Status: implemented

English | [中文](2026-08-25-supergrok-oauth-model-login.zh.md)

## Problem

xAI's catalog route was already selectable, but the only authentication the Models page could store was an API key billed on the xAI meter. A SuperGrok or X Premium subscriber who already pays for Grok had no way to use that allowance as the conversation model. Reading Grok CLI's `~/.grok/auth.json` would share a refresh token with another product and rotate it out from under that CLI. Spawning `grok agent stdio` as the session agent would replace Harness tools with Grok Build's own tools.

## Decision

The conversation stays on the Harness agent loop and Harness tools. xAI is only the model. Catalog routes that pi-ai ships with an OAuth method (xAI: "Sign in with SuperGrok or X Premium") offer device-code login on the Models card. The Host talks to `auth.x.ai`; the browser shows the user code and opens the verification URL. Tokens are JSON under `<ROUTE>_OAUTH` in the credential seam (`XAI_OAUTH` for xai) and are refreshed per request. Login never reads or writes `~/.grok/auth.json`.

A named `apiKeyEnv` still wins. A profile with no key reference tries the stored OAuth access token, then pi-ai ambient discovery. Successful login writes an empty `providers.<route>` profile so the route registers. Logout unsets the OAuth credential and leaves the row.

`openai-codex` stays out of the dormant directory: it is OAuth-only and this adapter still has no Codex token refresh.

## Alternatives considered

**Reuse Grok CLI's `~/.grok/auth.json`.** Rejected because a refresh rotates the token and would sign the CLI out.

**ACP-host `grok agent stdio` as the session agent.** Rejected for this change because the user-visible editor must keep Harness tools (read/write/bash cards, sandbox, permissions). ACP would run Grok Build's tool set.

**Browser-side device-code fetch.** Rejected because `auth.x.ai` does not serve CORS to the Web origin; the Host must run the flow.

## Consequences

Settings → Models → Add provider → xai → Sign in with SuperGrok or X Premium authenticates the catalog models (`grok-4.5`, `grok-4.3`, `grok-build-0.1` in the installed pi-ai catalog). Usage draws on the SuperGrok / X Premium allowance. The installed catalog does not yet list `grok-4.6`; adding it still requires a `models` list and a route-level `api` because xAI's catalog is mixed-protocol.

## Testing

`packages/llm/llm-pi-ai/tests/oauth.spec.ts` covers codec, device-code start/wait/cancel, refresh coalescing, and logout. `packages/llm/llm/tests/topology.spec.ts` covers the OAuth login registry. Wire methods are on `llm.oauthLoginStart|Wait|Cancel` and `llm.oauthLogout`, loopback-only like `credentials.*`.
