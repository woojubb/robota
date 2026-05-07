# Agent CLI Layering Audit

Source-verified against `develop` on 2026-05-07.

This document owns CLI-specific layer audit findings, resolved lessons, and mechanical guard
candidates.

## Layering Audit

### CLI-AUDIT-001: CLI imports `agent-sessions` directly

Status: resolved in PR #205.

Former files:

- `packages/agent-cli/src/cli.ts`
- `packages/agent-cli/src/ui/render.tsx`
- `packages/agent-cli/src/ui/App.tsx`
- `packages/agent-cli/src/ui/hooks/useInteractiveSession.ts`
- `packages/agent-cli/src/ui/SessionPicker.tsx`
- `packages/agent-cli/package.json`

Problem:

`packages/agent-cli/docs/SPEC.md` says CLI must not import from
`@robota-sdk/agent-sessions`, but the CLI creates and passes `SessionStore` directly.

Resolution:

Session persistence construction and the public resume/picker data contract now live behind
SDK-owned APIs in `agent-sdk/src/interactive/session-persistence.ts`. CLI calls
`createProjectSessionStore(cwd)`, `resolveLatestSessionId()`, `resolveSessionIdByIdOrName()`, and
`listResumableSessionSummaries()` from `@robota-sdk/agent-sdk`; it does not import
`@robota-sdk/agent-sessions` or declare it in `packages/agent-cli/package.json`.

Mechanical guard:

- `scripts/harness/check-command-layering.mjs` flags production CLI imports from
  `@robota-sdk/agent-sessions` and direct CLI package dependencies on it.

### CLI-AUDIT-002: TUI command effects were queued by mutating `InteractiveSession`

Status: resolved in `fix/cli-command-effect-boundary`.

Current files:

- `packages/agent-cli/src/ui/hooks/useSlashRouting.ts`
- `packages/agent-cli/src/ui/hooks/useSideEffects.ts`
- `packages/agent-cli/src/ui/hooks/side-effects-types.ts`
- `packages/agent-cli/src/ui/__tests__/slash-routing-effects.test.ts`

Former problem:

The TUI casts `InteractiveSession` to an `ISideEffects` intersection and stores fields such as
`_pendingCommandInteraction` and `_pendingCommandEffects` on the SDK session object. This keeps the
SDK type clean only at compile time and makes command-effect transport implicit.

Resolution:

`agent-cli/src/ui/hooks/command-effect-queue.ts` now owns an explicit `CommandEffectQueue`. Slash
routing enqueues generic `ICommandInteraction` and pending `TCommandEffect[]` values into that
queue, and `useSideEffects()` drains the queue after the base submit path. The SDK
`InteractiveSession` instance is no longer used as the transport for command interactions or
effects.

Mechanical guard:

- `scripts/harness/check-command-layering.mjs` flags `_pendingCommandInteraction`,
  `_pendingCommandEffects`, and `InteractiveSession & ISideEffects` usage in CLI/TUI source.

### CLI-AUDIT-003: Provider model catalog refresh layer is incomplete

Status: partially resolved.

Current state:

- `/model` is a command module, which is the correct layer.
- The command reads active-provider catalog metadata through SDK model common APIs.
- Provider packages own fallback `IProviderDefinition.modelCatalog` data with source URLs and
  verification timestamps.
- The core provider contract supports provider-owned catalog refresh hooks.
- The OpenAI provider owns a live refresh adapter backed by the OpenAI Models API.

Problem:

Static fallback catalog data is staleable by design. The CLI/TUI should not compensate for that by
hardcoding model lists or provider branches. Remaining work is cache/generation policy expansion for
providers beyond the first live adapter.

Tracked follow-up:

- provider-specific generated catalog refresh and cache invalidation work after the initial adapter
  layer.

### CLI-AUDIT-004: Legacy assembly architecture doc was stale

Status: resolved by this documentation change.

`packages/agent-cli/docs/ASSEMBLY-ARCHITECTURE.md` described an older `createSession()`-centric CLI
assembly path and direct `FileSessionLogger` setup that no longer matches current source. It now
redirects to this map so future readers do not treat stale architecture text as current.

### CLI-AUDIT-005: CLI command compatibility shims blur command ownership

Status: resolved in `refactor/cli-command-shims-retirement`.

Removed files:

- `packages/agent-cli/src/commands/command-registry.ts`
- `packages/agent-cli/src/commands/builtin-source.ts`
- `packages/agent-cli/src/commands/skill-source.ts`
- `packages/agent-cli/src/commands/types.ts`
- `packages/agent-cli/src/commands/skill-executor.ts`

Resolution:

`agent-cli` no longer has a `src/commands/` compatibility surface. TUI code imports
`CommandRegistry` and command contract types directly from `@robota-sdk/agent-sdk`, and the
skill execution tests now live with the SDK-owned `executeSkill()` implementation. The command
layering harness scans for new CLI command shim files under `packages/agent-cli/src/commands`.

Completed backlog:

- `.agents/backlog/completed/cli-command-compat-shims-retirement.md`

### CLI-AUDIT-006: Local runtime adapters need an owner boundary audit

Status: resolved.

Classification:

| File                                                                       | Classification       | Owner Boundary                                                                                  |
| -------------------------------------------------------------------------- | -------------------- | ----------------------------------------------------------------------------------------------- |
| `packages/agent-cli/src/background/managed-shell-process-runner.ts`        | CLI adapter          | Owns Node `spawn`, stdin, env, and cancellation; uses SDK-reexported runtime log helpers/ports. |
| `packages/agent-cli/src/subagents/child-process-subagent-runner.ts`        | CLI adapter          | Owns Node `fork`, worker path resolution, and payload composition.                              |
| `packages/agent-cli/src/subagents/child-process-subagent-transport.ts`     | CLI adapter          | Owns child-process IPC send/cancel mechanics.                                                   |
| `packages/agent-cli/src/subagents/child-process-subagent-runner-result.ts` | CLI adapter          | Owns child-worker result orchestration and adapter-specific timeout cleanup.                    |
| `packages/agent-cli/src/subagents/child-process-subagent-ipc.ts`           | CLI adapter protocol | Owns serializable worker protocol for the CLI child process.                                    |
| `packages/agent-cli/src/subagents/child-process-subagent-worker.ts`        | CLI adapter worker   | Owns child-process SDK session reconstruction.                                                  |
| `packages/agent-cli/src/subagents/git-worktree-isolation-adapter.ts`       | CLI adapter          | Implements the runtime worktree port with Git/filesystem I/O.                                   |
| `packages/agent-runtime/src/background-tasks/log-pages.ts`                 | Runtime primitive    | Owns bounded output capture, prefixed log projection, and cursor pagination.                    |

Resolution:

`agent-cli` keeps concrete terminal-host process, IPC, worker, and Git adapters. Reusable bounded
output capture and task log pagination moved to `agent-runtime` and are exposed to CLI through
SDK re-exports, preserving the import rule that CLI consumes runtime contracts through SDK
composition/facades.

Completed backlog:

- `.agents/backlog/completed/cli-runtime-adapter-boundary-audit.md`

### CLI-AUDIT-007: SDK public exports hide some package ownership

Status: resolved.

Current files:

- `packages/agent-sdk/src/index.ts`
- `packages/agent-sdk/src/types.ts`
- `packages/agent-sdk/src/background-tasks/index.ts`
- `packages/agent-sdk/src/subagents/index.ts`

Problem found:

The SDK entrypoint intentionally exposes SDK-owned facades and command APIs, but it also re-exports
selected lower-package symbols for compatibility and host convenience. Some exports are legitimate
SDK facades; others may be pass-through surfaces that make consumers import through the SDK instead
of the actual owner package.

Resolution:

The SDK public surface is classified in `packages/agent-sdk/docs/PUBLIC-SURFACE.md`.
Top-level `@robota-sdk/agent-sdk` exports now expose SDK-owned APIs plus explicit SDK facades only.
General-purpose `agent-core`, `agent-tools`, and `agent-sessions` utilities are owner-direct imports.
Runtime lifecycle contracts remain intentionally available through SDK facade barrels because CLI
and transport hosts consume runtime contracts through SDK composition/facades.

Mechanical guard:

- `pnpm harness:scan:sdk-public-surface` rejects broad SDK `export *` barrels.
- It rejects top-level pass-through exports from `agent-core`, `agent-sessions`, or `agent-tools`.
- It allows `agent-runtime` re-exports only from `agent-sdk/src/background-tasks/index.ts` and
  `agent-sdk/src/subagents/index.ts`.

Completed backlog:

- `.agents/backlog/completed/sdk-public-surface-owner-audit.md`

### CLI-AUDIT-008: Prompt file references must not move into TUI input handling

Status: resolved in `feat/cli-at-file-reference-import`.

Current files:

- `packages/agent-sdk/src/context/prompt-file-references.ts`
- `packages/agent-sdk/src/context/prompt-file-reference-parser.ts`
- `packages/agent-sdk/src/context/prompt-file-reference-paths.ts`
- `packages/agent-sdk/src/context/context-reference-inventory.ts`
- `packages/agent-sdk/src/interactive/interactive-session.ts`
- `packages/agent-cli/src/ui/hooks/useSlashRouting.ts`
- `packages/agent-cli/src/ui/flows/input-area-flow.ts`

Risk:

`@file` prompt syntax is visible in the CLI, but parsing it in Ink input components or slash-routing
hooks would make the CLI own context-loading semantics and would duplicate the SDK host contract.

Resolution:

The CLI continues to route non-slash prompt text directly to `InteractiveSession.submit()`.
`agent-sdk` owns path-like token parsing, workspace-root enforcement, recursive reference bounds,
file/total byte limits, diagnostics, and structured `prompt-file-reference` history records. The
TUI renders those records as ordinary SDK history events and does not inspect `@file` tokens.

### No SDK-to-command-package edge found

This audit did not find `agent-sdk` importing `@robota-sdk/agent-command-*`. That preserves the
rule that command packages consume SDK contracts like third-party modules.

### No command-package-to-CLI edge found

This audit did not find `agent-command-*` importing `agent-cli` files. That preserves command module
portability and keeps CLI/TUI as a generic host.
