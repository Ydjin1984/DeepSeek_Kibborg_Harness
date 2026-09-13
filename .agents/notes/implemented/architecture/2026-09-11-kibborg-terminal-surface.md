# Agent Note: The kibborg terminal surface runs the existing harness in-process

Status: implemented

English | [中文](2026-09-11-kibborg-terminal-surface.zh.md)

## Problem

`DeepSeek_Kibborg_Harness` shipped two surfaces over one core: the profile launcher `dsh` (`apps/cli`) with its `web` and `headless` profiles, and the Web GUI assembled by `packages/bundle/web-app`. The terminal was a stated intention rather than a surface: `apps/cli/src/args.ts` documents `dsh --profile tui` only as an example, `packages/api/remotes/README.md` says its client face "can be reused by Web or a future TUI that provides the same React-free `ctx.remote` contract", and `packages/bundle/web-app/cordis.patch.yml` keeps the agent-plane rows in the base layer explicitly "for the TUI, which is single-session and composes its agent process-wide".

Adding that surface carries one dominant risk: a second agent implementation. A terminal app that reaches for `agent`, `agent-loop`, tool implementations, or the session store directly would fork the core, and the fork would diverge from the Web surface on the first change to either side. The delivered work therefore has to answer two questions with evidence, not intent: which layers a terminal app may touch, and whether the client-side packages the Web surface uses can run in a Node process at all.

## Decision

The terminal surface is a third profile over the same core, with its own application and its own bundle, and it speaks to the core through the same Remote contract the browser uses — in one process, without a socket.

- **A profile of its own.** `kibborg` is a profile under `$DSH_HOME/profiles` whose `dsh.profile.bundles` are `@deepseek-ai/dsh-base` and `@kibborg/cli-bundle`. The application creates the profile on first use and heals the flat module fallback (`$DSH_HOME/profiles/node_modules`) from its own dependency closure, which is the contract `dsh` already uses for its profiles.

- **Its own application and bundle.** `Kibborg_CLI/apps/cli` is `@kibborg/cli` (bin `kibborg`) and owns only process-level concerns: the command line, the profile boot, the config dump, and the diagnostics. `Kibborg_CLI/packages/cli-bundle` is a patch layer that composes the rows the terminal needs over `dsh-base` — the API proxy, the workspace registry with its JSON storage trio, the browse directory-picker backend, and the client transport. Nothing in this bundle renders; the Web bundle is not mounted.

- **In-process transport.** `Kibborg_CLI/packages/client-node` builds `InProcessApiClient(toFetchHandler(ctx.apiProxy))`. The whole wire path — rpcId minting, envelope wrap and unwrap, schema validation — runs in the process, so no port is bound, no server is started, and no background process outlives the command. The transport is the isomorphic carrier point the API proxy package already exposes as `InProcessApiClient` over `toFetchHandler`.

- **A written boundary.** CLI code may use the public exports of `@deepseek-ai/dsh-app-boot`, profile composition (patch layers and overlays), the API proxy through the in-process or HTTP client, the Remote domains, and — once proven Node-safe — the React-free client object layer. It may not import `agent`, `agent-loop`, `orchestrator`, tool implementations, or session storage by internal path, and it may not add a second tool registry, session store, config layer, or skill layer. `Kibborg_CLI/tests/import-boundary.spec.ts` is the planned gate over that allowlist.

- **One name.** The command, the profile, and the package scope are all `kibborg`; the earlier `kiborg` spelling is not used anywhere.

## Alternatives considered

### Importing the browser client bundles in Node

The Web surface's client halves ship as `lib/client.js` bundles that begin with `window.__ModuleLoader__.load({...})`: they are registrations for the page's module loader, not importable ESM libraries. Every one of the five packages fails at import in Node for that reason. Their `tsc` output (`lib/types/client/index.js`) is ordinary ESM and imports cleanly in Node, which keeps the full client stack reachable for a later phase — but it is not what the client packages' `exports` maps advertise, so relying on it is a decision to revisit rather than a foundation to build on today.

### A direct core entry point, as `dsh --profile headless` does

The one-shot headless bundle creates an Agent through the core registry and never mounts the API proxy. It is the shortest path to "print an answer", and it is exactly the shape that would drift from the Web surface: approvals, questions, plan review, slash commands, projections, queue, jobs, and every interactive contract a terminal needs live behind the proxy, not behind the registry. The terminal surface therefore takes the proxy path even for its first spike.

### A loopback HTTP server per invocation

Starting the Web host on a loopback port and attaching a client to it would reuse the HTTP carrier unchanged. It also makes every `kibborg "task"` invocation pay for a server, a port, and two streams, and it invites a second source of truth about which process owns a session. The in-process carrier provides the same request path with none of that, so HTTP is reserved for the server mode where a remote client genuinely needs it.

## Out of scope / possible extensions

- The interactive renderer, session and history surfaces, approvals, questions, plan review, slash commands, and the fullscreen TUI belong to the phases that follow the spike; the design is fixed in `Kibborg_CLI/UI.md`, whose frozen `demo/` golden pins the visual contract.
- `ctx.remote` is not yet wired: a generic RPC caller for the Remote namespaces is either written in `@kibborg/client-node` or provided by one additive subpath export from the client connection package, and that choice is made when the first Remote consumer lands.
- The client-side `typert` service that `api-gateway/client` injects is currently satisfied by the host half already composed in the base layer; a dedicated Node-safe client half is not part of this decision.
- Server mode, remote attach, and their authentication layer are later phases.

## Verification

`Kibborg_CLI/K0.0-REPORT.md` records the spike with its measurements. `kibborg "hello"` answers on stdout and exits 0; `kibborg "прочитай README.md и кратко опиши проект"` shows `kibborg: tool read` on stderr and answers from the file's contents, which demonstrates that the command reaches the existing agent loop with its tools rather than only a model request. `kibborg doctor` reports nine checks with none failing, from a directory outside the repository, and `kibborg --help`, `kibborg version`, and `kibborg --dump-config` answer without booting. The repository outside `Kibborg_CLI/` changes only in `pnpm-workspace.yaml` (two workspace globs) and `tsconfig.host.json` (two project references).

## Consequences

- **The terminal and the browser cannot drift on capability.** Both reach the same core through the same contract, so a new core capability reaches both surfaces without terminal-side work.
- **The terminal inherits the core's interactive contracts**, including the approvals, questions, and plan review that distinguish a harness from a chat client; those arrive with the phases that render them, not with a second implementation.
- **The profile is the seam for composition.** What the terminal mounts is a patch layer, so narrowing or widening it (a different picker backend, an added row) is a composition change rather than a code change.
- **One boundary remains open by design**: the client object layer's Node compatibility is proven at the module level but not yet exercised by a mounted client stack, so the first client-side phase either mounts it or records why it cannot.
