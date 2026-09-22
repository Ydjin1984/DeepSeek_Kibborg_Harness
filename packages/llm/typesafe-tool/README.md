# @deepseek-ai/dsh-typesafe-tool

Model-facing `typesafe_evaluate` tool over the TypeSafe.ai System One API.

TypeSafe.ai is not an OpenAI-compatible chat provider. It serves one `POST /v1/systemone` endpoint that answers typed, probability-backed questions about a single piece of state and returns no free text. This package exposes that endpoint to the model as a tool for classification, routing, sentiment, and scoring.

## Configuration

| Key | Default | Meaning |
| --- | --- | --- |
| `apiKey` | — | Literal key; prefer `apiKeyEnv` so no secret enters configuration files. |
| `apiKeyEnv` | `TYPESAFE_API_KEY` | Credential reference resolved for each call. |
| `baseURL` | `https://api.typesafe.ai` | API base; `/v1/systemone` is appended. |
| `defaultModel` | `jev-latest` | Model id used when a call omits `model`. |
| `timeoutMs` | `60000` | Cooperative timeout budget per call in milliseconds. |

The key resolves per call from the credential store, then the launch environment, so a key stored through the Models/credentials surface takes effect without a restart.

## Model Experience

### typesafe_evaluate tool

#### What the model sees

One tool named `typesafe_evaluate` with a fixed description and input: a `state` string plus `questions`, each `{ id, type, instructions }` with `type` one of `noul` (yes/no), `choice` (pick one option, `criteria` maps option id → description), or `score` (rate on an ordered scale, `levels` lists the ordered level descriptions). The result is the System One answer body as pretty JSON (`model`, `answers`, `usage`), returned verbatim.

#### Token effect

The description and input schema are static per build, so enabling the tool adds a bounded block to every request that mounts it. Each call charges the `state` argument plus the returned `answers` to context, so question batches should stay as small as the decision needs.

#### KV Cache effect

None beyond that static tool block: the description and schema never vary between turns, and the package contributes no system-prompt rows.

## Known Limitations and Deferred Work

- The answer body is returned verbatim; the caller owns interpretation.
- No client-side projection or specialized presentation is provided; calls use the generic card.
