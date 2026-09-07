# Agent Note: Product plugins must not inject the invariants service

Status: implemented

[English](2026-09-07-execution-plugin-must-not-inject-invariants.md) | 中文

## Problem

`dsh web` 会打印 `http://127.0.0.1:3080`，随后以 `dsh: plugin tree failed to load` 退出。未结算的行是 `@deepseek-ai/dsh-execution: pending (waiting for service: invariants)`。端口 3080 上没有监听。

`ExecutionService` 声明了 `static inject = ['invariants']`。invariants 注册表是 `./invariant` companion 的诊断宿主，不是随发行配置挂载的插件行。普通包入口保持与诊断无关（[包 invariant 契约](../architecture/2026-07-19-package-invariant-runtime-contracts.md)）。测试通过在产品插件之前挂载 `InvariantRegistry` 掩盖了这一挂起。

## Decision

`ExecutionService` 没有 `inject`。`./invariant` companion 仍注入 `invariants` 并注册 `@deepseek-ai/dsh-execution`。单元测试在空 Context 上挂载产品插件，并断言 `list()` 返回空数组。base bundle 将 `@deepseek-ai/dsh-execution` 和 `@deepseek-ai/dsh-engagement-stub` 列为生产依赖，使这些 patch 行能从 bundle 包解析。

## Alternatives considered

**在 base bundle 中挂载 `@deepseek-ai/dsh-invariants`。** 会在生产中激活这一服务以及所有等待 `invariants` 的 companion。companion 仅在组合挂载该注册表时注册。

**保留 inject，并要求每个 profile 都挂载 invariants。** 会把可选的诊断服务变成每次 CLI 和 Web 启动都必须满足的启动硬依赖。

## Consequences

发行 profile 在没有诊断注册表的情况下激活 `ctx.executions`。jobs 适配器通过 `ctx.get('executions')` 的投影在服务挂载后立即开始。companion 检查仍要求在测试或诊断组合中显式挂载 invariants 插件。

## Testing

`packages/execution/execution/tests/execution-service.spec.ts` 与 `resources.spec.ts` 在不挂载 `InvariantRegistry` 的情况下挂载该服务。`packages/execution/execution/tests/invariant.spec.ts` 仍挂载该注册表以进行 companion 注册。
