# Agent Note: Product plugins must not inject the invariants service

Status: implemented

English | [中文](2026-09-07-execution-plugin-must-not-inject-invariants.zh.md)

## Problem

`dsh web` prints `http://127.0.0.1:3080` then exits with `dsh: plugin tree failed to load`. The unsettled row is `@deepseek-ai/dsh-execution: pending (waiting for service: invariants)`. Nothing listens on port 3080.

`ExecutionService` declared `static inject = ['invariants']`. The invariants registry is a diagnostics host for `./invariant` companions, not a shipped plugin row. Ordinary package entrypoints stay independent of diagnostics ([package invariant contracts](../architecture/2026-07-19-package-invariant-runtime-contracts.md)). Tests hid the hang by mounting `InvariantRegistry` before the product plugin.

## Decision

`ExecutionService` has no `inject`. The `./invariant` companion still injects `invariants` and registers `@deepseek-ai/dsh-execution`. A unit test mounts the product plugin on an empty Context and asserts `list()` returns an empty array. The base bundle lists `@deepseek-ai/dsh-execution` and `@deepseek-ai/dsh-engagement-stub` as production dependencies so those patch rows resolve from the bundle package.

## Alternatives considered

**Mount `@deepseek-ai/dsh-invariants` in the base bundle.** Would activate this one service and every companion waiting on `invariants` in production. Companions register only when a composition mounts the registry.

**Keep the inject and require every profile to mount invariants.** Turns an optional diagnostics service into a boot-hard dependency for every CLI and Web launch.

## Consequences

Shipping profiles activate `ctx.executions` without a diagnostics registry. The jobs adapter's `ctx.get('executions')` projection starts as soon as the service mounts. Companion checks still require an explicit invariants plugin in test or diagnostic compositions.

## Testing

`packages/execution/execution/tests/execution-service.spec.ts` and `resources.spec.ts` mount the service without `InvariantRegistry`. `packages/execution/execution/tests/invariant.spec.ts` still mounts the registry for companion registration.
