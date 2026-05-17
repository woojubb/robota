# Agent CLI Layering Audit

Source-verified against `develop` on 2026-05-15.

Resolved audit findings, durable lessons, and mechanical guard candidates.

> **Evidence policy**: An item may not be marked "resolved" without a verification artifact — a
> commit hash, PR number, or grep-output confirming the fix is present in the codebase.

## Layering Audit

### CLI-AUDIT-001: CLI imports `agent-sessions` directly

Status: resolved — PR #205.

Session persistence construction now lives behind SDK-owned APIs in
`agent-sdk/src/interactive/session-persistence.ts`. CLI calls `createProjectSessionStore(cwd)` and
related facades from `@robota-sdk/agent-framework`; it has no direct dependency on
`@robota-sdk/agent-session`.

Mechanical guard: `scripts/harness/check-command-layering.mjs` flags production CLI imports from
`@robota-sdk/agent-session`.

### CLI-AUDIT-002: TUI command effects were queued by mutating `InteractiveSession`

Status: resolved — `fix/cli-command-effect-boundary`.

`CommandEffectQueue` (`agent-transport-tui/src/hooks/command-effect-queue.ts`) now owns the explicit
effect transport. `InteractiveSession` is no longer used as an `ISideEffects` mutable carrier.

Mechanical guard: `scripts/harness/check-command-layering.mjs` flags `_pendingCommandInteraction`,
`_pendingCommandEffects`, and `InteractiveSession & ISideEffects` usage.

### CLI-AUDIT-003: Provider model catalog refresh layer incomplete

Status: resolved — PR #401 (`feat(prov-001)`).

Live refresh adapters exist for Anthropic, Gemini, Qwen, OpenAI, and DeepSeek via
provider-owned `refreshModelCatalog` hooks. TTL-based auto-refresh (`modelCatalogCacheTtlSeconds`)
is wired in `model-command-api.ts`. CLI/TUI renders freshness state only.

### CLI-AUDIT-004: Legacy assembly architecture doc was stale

Status: resolved — `packages/agent-cli/docs/ASSEMBLY-ARCHITECTURE.md` now redirects to this map.

### CLI-AUDIT-005: CLI command compatibility shims blur command ownership

Status: resolved — `refactor/cli-command-shims-retirement`.

`agent-cli/src/commands/` compatibility surface removed. TUI imports `CommandRegistry` and command
contract types directly from `@robota-sdk/agent-framework`.

Mechanical guard: command-layering harness scans for new CLI command shim files under
`packages/agent-cli/src/commands`.

### CLI-AUDIT-006: Local runtime adapters need owner boundary audit

Status: resolved.

| File                                                              | Classification                                  |
| ----------------------------------------------------------------- | ----------------------------------------------- |
| `agent-cli/src/background/managed-shell-process-runner.ts`        | CLI adapter — Node spawn, stdin, cancellation   |
| `agent-cli/src/subagents/child-process-subagent-runner.ts`        | CLI adapter — Node fork, worker path, payload   |
| `agent-cli/src/subagents/child-process-subagent-transport.ts`     | CLI adapter — IPC send/cancel                   |
| `agent-cli/src/subagents/child-process-subagent-runner-result.ts` | CLI adapter — result orchestration              |
| `agent-cli/src/subagents/child-process-subagent-ipc.ts`           | CLI adapter protocol                            |
| `agent-cli/src/subagents/child-process-subagent-worker.ts`        | CLI adapter worker                              |
| `agent-cli/src/subagents/git-worktree-isolation-adapter.ts`       | CLI adapter — worktree port impl                |
| `agent-runtime/src/background-tasks/log-pages.ts`                 | Runtime primitive — bounded output + pagination |

### CLI-AUDIT-007: SDK public exports hide package ownership

Status: resolved.

SDK public surface is classified in `packages/agent-framework/docs/PUBLIC-SURFACE.md`. `agent-runtime`
re-exports are allowed only from `agent-sdk/src/background-tasks/index.ts` and
`agent-sdk/src/subagents/index.ts`.

Mechanical guard: `pnpm harness:scan:sdk-public-surface` rejects broad `export *` barrels and
pass-through exports from `agent-core`, `agent-sessions`, or `agent-tools`.

### CLI-AUDIT-008: Prompt file references must not move into TUI input handling

Status: resolved — `feat/cli-at-file-reference-import`.

`agent-sdk` owns `@file` token parsing, workspace-root enforcement, byte limits, diagnostics, and
structured `prompt-file-reference` history records. CLI routes non-slash text to
`InteractiveSession.submit()` unchanged.

### CLI-AUDIT-009: CLI-visible features must not become CLI-owned features

Status: active guardrail.

`agent-cli` may own: terminal rendering, input handling, keyboard navigation, ephemeral selection
state, and concrete local host adapters.

`agent-cli` must not own: durable feature behavior, lifecycle state machines, task registries,
command behavior, provider semantics, permission policy, persistence contracts, retention policy,
background task grouping, or transport-visible contracts.

If a TUI component needs data or behavior not exposed by `agent-sdk` or a lower owner, add the
SDK/runtime/command/provider capability first.

### CLI-AUDIT-010: createTuiCliAdapter belongs in agent-transport

Status: active — backlog ARCH-002-p9.

`cli.ts` defines `createTuiCliAdapter` which wraps agent-framework functions into
`ITuiCliAdapter`. `ITuiCliAdapter` is defined in `agent-transport/src/tui/tui-cli-adapter.ts`
and agent-transport already depends on agent-framework. The factory belongs in agent-transport
so cli.ts only wires, not defines.

Target: `agent-transport/src/tui/create-default-tui-cli-adapter.ts` exports
`createDefaultTuiCliAdapter({ providerDefinitions, reloadPluginCommandSource })`.

### CLI-AUDIT-011: cli.ts contains behavior logic — must be pure composition root

Status: active — backlog ARCH-002-p10.

`cli.ts` directly defines: `readVersion`, `resetConfig`, `buildAppendSystemPrompt`,
`readTaskFilePrompt`, `buildCommandSetup`, `runPrintMode`, `createTransportRegistry`.
These are behavior functions, not composition wiring.

Target: each extracted to a dedicated module inside `agent-cli/src/startup/` or
`agent-cli/src/modes/`. `cli.ts` becomes import-and-call only (under ~120 lines).
