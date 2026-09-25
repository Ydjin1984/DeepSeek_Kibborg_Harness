# Go runtime migration plan

English | [中文](go-runtime-migration.zh.md)

This plan moves the Harness product runtime and browser application to Go and ships one executable per target operating system and architecture. The executable embeds its browser assets, starts the selected application profile, and serves the generated HTML and runtime APIs. TypeScript and Python SDKs remain protocol clients so existing callers can continue to drive the runtime.

## Goal and scope

The target runtime includes the application host, HTTP and RPC transports, ACP and stdio JSON-RPC servers, plugin composition, the agent loop, model adapters, session state and persistence, tools, process and sandbox adapters, and the web application. The browser document is rendered from Go templates. Interactive browser behavior is compiled from Go to WebAssembly and embedded with the page; a small generated JavaScript bootstrap may load WebAssembly but owns no product behavior.

The migration replaces TypeScript runtime packages and the React browser application. It does not require repository documentation, release automation, or external TypeScript and Python client SDKs to be rewritten in Go. During development, the existing implementation remains the behavioral reference until the corresponding Go slice passes parity checks.

“One binary” means one distributable executable for each supported OS/architecture pair. It does not mean one executable that runs natively on every operating system. Static assets and templates are embedded; the binary writes no required frontend build tree at installation time.

## Current system and migration implications

The Harness is composed from Cordis plugins. Service registration, events, reversible effects, configuration overlays, and Loader lifecycle are runtime behavior, not just packaging. The Go runtime needs an equivalent composition engine with explicit ownership, ordering, and teardown semantics before product packages can move safely.

The current Web host separates `host/webserver`, `host/apiproxy`, `api/gateway`, Typert, and `client/connection`. `/api` request and response envelopes, server requests, client responses, downlink event streams, and generated method codecs together form the client protocol. ACP and SDK stdio JSON-RPC are additional independent transports and remain compatibility obligations.

The agent loop derives model history from the append-only session event log. Persistence providers include JSONL and SQLite; JSONL can expose verbatim stored artifact text, while SQLite stores packed physical rows and reconstructs a logical event stream. Session events, recovery behavior, cancellation, fork/resume, tools, approvals, subagents, jobs, and projections affect model or user-visible behavior.

The browser app is a React plugin composition with dynamic client modules, UI slots, reconnect state, live event streams, and browser snapshots. Replacing it with Go templates and WebAssembly is a full client rewrite, even though the server-rendered page can be embedded in the same executable.

The repository graph also locates the principal runtime nodes at [`api-proxy.ts`](../packages/host/apiproxy/src/api-proxy.ts), [`typert/protocol`](../packages/typert/protocol/src/index.ts), [`agent-loop`](../packages/core/agent-loop/src/index.ts), [`session types`](../packages/core/session/src/types.ts), [`session persistence`](../packages/session/session-persistence/src/index.ts), and [`ACP`](../packages/acp/acp/src/index.ts). The checked-in graph uses a pre-path-qualified node-ID scheme, so these paths are cross-checked against the package references and [architecture map](architecture.md) rather than treated as a complete dependency inventory.

## Compatibility contract

“Bit for bit” must name the bytes being compared. The migration uses exact byte equality for stable protocol fixtures and persisted record artifacts, and semantic equality for runtime outcomes that necessarily contain generated identifiers, time, scheduling, or operating-system output.

| Surface | Required parity | Comparison method |
|---|---|---|
| JSON-RPC, ACP, and Web RPC | Same methods, fields, discriminants, error codes, omission rules, ordering where observable, and streaming sequence | Compare encoded bytes for deterministic fixtures; compare decoded messages and sequence for live streams |
| Session JSONL | Existing files remain readable without rewriting; deterministic appends preserve canonical record encoding and newline bytes | SHA-256 and byte diff over fixtures and append outputs |
| Session events | Same event names, payload values, sequence numbers, replay and recovery result, and model-visible projection | Canonical event transcript comparison and existing snapshot scenarios |
| SQLite | Existing database opens and produces identical logical rows, event order, schema refusal, and transaction outcomes | SQL-level row comparison and shared persistence contract; do not claim whole-file page-byte identity across SQLite engine builds |
| Model requests | Same provider, endpoint, headers, prompt bytes, tool schemas, retry/cancel decisions, and request order for a deterministic fixture | Capture and compare outgoing HTTP requests byte for byte |
| Tools and OS adapters | Same arguments, outputs, exit status, cancellation, timeout, cleanup, access policy, and visible errors | Real subprocess and sandbox integration fixtures on each supported OS |
| Browser application | Same routes, accessible controls, user journeys, reconnect and error behavior, and visible text | Browser replay snapshots and DOM/accessibility assertions; HTML serialization may differ after the renderer rewrite |
| Build and launch | The release starts from one executable with no Node.js or frontend directory requirement | Clean-machine launch of the packaged artifact for every target |

Deterministic fixtures must pin clocks, generated IDs, model streams, filesystem contents, environment variables, and process output. Without those controls, two correct implementations can produce different bytes. A whole SQLite file can also differ because its page allocation, journal, and engine build are physical storage details. If the requirement is literal equality of every runtime-generated byte, including full database images and browser HTML, the Go renderer and persistence engine must reproduce those encodings explicitly; this plan does not label that achievable until fixture evidence proves it.

## Target architecture

The Go executable uses internal packages with explicit interfaces and a statically linked plugin catalog. Application profiles select registered plugins through data-only configuration. Each plugin owns its registrations and disposers; startup and shutdown follow dependency order. A compatibility loader translates supported existing profile and patch files into the new config form before the old runtime is retired.

```text
Go executable
├── boot and profile composition
├── plugin runtime and capability registry
├── agent, session log, tools, model adapters
├── persistence, filesystem, subprocess, sandbox
├── HTTP / Web RPC / Typert-compatible codecs
├── ACP and stdio JSON-RPC
└── embedded web assets
    ├── Go HTML templates
    └── Go WebAssembly client
```

The compatibility SDKs continue using the published JSON-RPC protocol. The Go Web client uses the same domain operations and event envelopes as the TypeScript client during the transition. The new plugin interfaces reproduce service availability, effect cleanup, event dispatch, waterfall delegation, scoped registration, and failure behavior; they do not promise source compatibility with TypeScript Cordis plugins.

Runtime-authored plugins are a special migration risk. The current self-modification path can inspect and mount runtime plugin code. Go's native plugin mechanism is not a portable, unloadable equivalent. Before porting that feature, choose and validate a portable module ABI, such as sandboxed WebAssembly modules with host-provided capabilities, or explicitly defer runtime-authored code while preserving built-in plugin composition. A plan that silently drops this path is not feature parity.

## Package migration map

| Current group | Go destination | Parity focus |
|---|---|---|
| `core`, `llm`, `compaction`, `context`, `goal`, `schedule`, `todo`, `plan`, `workflow`, `guard`, `subagent` | `internal/agent`, `internal/session`, `internal/model`, `internal/capability/*` | Turn lifecycle, prompt assembly, tool flow, cancellation, durable model-visible state |
| `session`, `session-query`, `storage`, `attachment`, `spill`, `feedback`, `identity`, `workspace`, `settings`, `credentials` | `internal/store/*`, `internal/config/*` | Existing data reads, exact JSONL artifacts, schema/version refusal, atomic writes and secret handling |
| `api`, `typert`, `host`, `client/connection` | `internal/protocol/*`, `internal/http/*` | Method codecs, validation, errors, RPC correlation, streams, authentication posture |
| `sdk`, `acp`, `examples` | Go runtime entry points plus unchanged TS/Python clients | Stdio framing, process lifetime, exit codes, protocol transcript |
| `shell`, `subprocess`, `terminal`, `fs`, `lsp`, `sandbox`, `execution`, `e2b` | `internal/platform/*`, `internal/capability/*` | Process trees, PTY, signal/cancel behavior, filesystem policy, OS-specific confinement |
| `web`, `client`, `bundle/web-app`, `boot` | `internal/web/*`, embedded templates and Go WebAssembly client | Routes, UI workflows, static assets, startup flags, CSP/origin behavior |
| `hooks`, `mcp`, `skill`, `extensions`, `telegram`, `experimental` | Separate Go capability packages; experimental scope reviewed individually | Wire formats, permissions, plugin lifecycle, opt-in boundaries |
| `test-support`, build generators, TypeScript/Python SDKs | Compatibility fixtures and client tooling retained outside the Go server binary | Existing callers and reproducible cross-language test vectors |

## Migration stages

1. **Freeze observable behavior.** Inventory shipped profiles, package contributions, public RPC schemas, event names, config fields, supported platforms, session fixtures, and browser journeys. Capture deterministic model requests, event logs, protocol transcripts, JSONL artifacts, error cases, and CLI output. Record known nondeterminism and define an explicit comparison rule for each fixture.

2. **Define the protocol source of truth.** Extract every wire envelope and method into a language-neutral schema. Generate Go codecs and validation from that schema, and preserve the TypeScript and Python client-facing types or generated clients. Prove that both old and Go servers accept and emit the same deterministic fixture bytes before moving business logic.

3. **Build the Go plugin runtime.** Implement plugin identity, config decoding, dependency resolution, activation order, service lookup, effects, event listeners, waterfall `next` behavior, scoped ownership, unload, and rollback. Translate base/headless/web compositions to static Go constructors selected by data-only profile configuration. Add lifecycle and invalid-composition fixtures before migrating consumers.

4. **Port session and persistence foundations.** Implement typed JSON values, event validation, contiguous sequence rules, session preparation, replay, fork/resume, interrupted-turn recovery, JSONL reading/appending, SQLite logical storage, checkpoint and projection coordination. Open existing JSONL and SQLite data read-only in the Go implementation first; run shared conformance fixtures against both runtimes. Preserve existing headers, JSONL bytes, database schema/version refusal, and error classification.

5. **Port the agent loop and model adapters.** Match prompt-section ordering, tool schema encoding, model request serialization, response streaming, tool-call IDs, retries, cancellation, usage accounting, continuation, compaction, and failure recovery. Use captured provider traffic and keyless transcript fixtures. Add real-provider comparisons only after deterministic fixtures pass.

6. **Port capability providers and OS integration.** Move filesystem, shell, subprocess, PTY, LSP, sandbox, attachment, skill, MCP, jobs, and subagent providers behind the Go interfaces. Preserve per-platform process-tree termination, permission decisions, environment scrubbing, path policy, and teardown. Keep existing sandbox and native security tests as acceptance requirements and add platform-specific Go fixtures alongside them.

7. **Port host transports and compatibility entry points.** Implement the Web HTTP carrier, RPC dispatch, event streams, Typert-compatible descriptors, ACP, and stdio JSON-RPC. Preserve request validation, status mapping, WebSocket/SSE behavior, abort propagation, and SDK launch semantics. Run the TypeScript and Python SDK acceptance suites against the Go executable without changing their public APIs.

8. **Replace the browser renderer.** Translate React screens and plugin slots into Go HTML templates and a Go WebAssembly client. Embed generated assets with `go:embed`; keep route and RPC behavior unchanged. Port each browser replay journey in small groups and compare visible states, accessibility names, keyboard behavior, event reconnects, file uploads, terminal output, approval flows, and error messages. Keep the old browser build available as the comparison oracle until the full journey set passes.

9. **Run differential and fault testing.** For every deterministic fixture, feed the same input to the TypeScript and Go runtimes and compare wire bytes, model requests, canonical session events, persisted artifacts, exit codes, and final state. Inject process crashes, truncated records, slow consumers, client disconnects, provider errors, duplicate registration, and shutdown during active work. Repeat the OS-sensitive cases on every supported platform.

10. **Package and switch the default.** Produce one signed executable per OS/architecture with embedded web assets, profile templates, and required migrations. Verify launch with Node.js, pnpm, and the frontend source tree absent. Add a diagnostic mode that reports build revision, profile, storage format, and enabled capabilities. Switch the default only after the Go runtime passes the compatibility matrix; retain a documented rollback release while the existing formats remain untouched.

## Release gates

The Go runtime is ready to replace the current server only when all of these hold:

- Every supported profile composes from the same user-visible settings and exposes the expected capabilities.
- Existing session JSONL files and SQLite databases open without a data rewrite; replay, recovery, fork, resume, export, and query results match fixtures.
- Deterministic Web RPC, ACP, stdio JSON-RPC, and SDK conversations match their encoded compatibility fixtures.
- Deterministic provider requests match captured bytes, and streaming/cancellation behavior matches the current snapshots.
- All browser scenarios pass against the generated page and WebAssembly client, including reconnect and error paths.
- Security, subprocess, filesystem, sandbox, terminal, shutdown, and resource cleanup checks pass on every supported OS.
- The packaged executable runs from a clean directory without Node.js, pnpm, or loose frontend files.
- Performance claims come from repeatable before/after benchmarks for startup, idle memory, request throughput, streaming latency, persistence throughput, and process-heavy workloads on the same hardware.

## Risks and decisions to resolve

- **Literal byte identity:** API fixtures and deterministic JSONL writes can be exact. Arbitrary concurrent streams, generated timestamps/IDs, SQLite database images, and React-to-template HTML cannot be presumed byte-identical. Approve the comparison matrix before implementation begins.
- **Dynamic plugin execution:** runtime-authored TypeScript plugins have no direct portable Go equivalent. Choose a WebAssembly host ABI or accept a separately scoped product change; do not claim parity while omitting it.
- **Browser rewrite:** Go templates and WebAssembly replace React composition, dynamic client modules, and UI slots. UI parity needs its own acceptance inventory and will likely be a major schedule driver.
- **Cordis config execution:** current profiles may use JavaScript expressions in plugin config. Replace executable config with validated data and an explicit Go constructor registry; provide a converter and fail loudly on unsupported expressions.
- **SQLite physical output:** the database's logical content can be preserved while its file bytes differ. Keep a byte-image requirement only if the migration deliberately pins the same SQLite engine and proves deterministic page-level output.
- **Security implementations:** Linux Landlock, macOS Seatbelt, Windows process controls, and native directory picking require platform-specific code and may need narrow native bindings. A Go rewrite must preserve policy outcomes, not merely compile on each OS.
- **Speed and reliability:** Go may reduce startup overhead and deployment dependencies, but throughput and reliability depend on workload, algorithms, drivers, and operational behavior. Treat improvement as a measured release gate, not an assumption.
- **Migration duration:** until all product packages and the UI move, two runtime implementations create maintenance cost. Port in vertical slices, require parity evidence per slice, and avoid a long-lived shared business-logic fork.

## Recommended order

Start with the protocol schema and deterministic parity harness, then implement the plugin runtime and session/persistence core. Port the agent loop and capabilities next, followed by transports and SDK acceptance. Begin the web renderer only after the RPC and event contracts are stable; it can then migrate screen by screen against a fixed Go API. Defer runtime-authored plugins until the host ABI decision is proven with a small end-to-end module. The final switch is a packaging milestone, not the point where compatibility work begins.
