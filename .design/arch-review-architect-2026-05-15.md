# Architecture Review — System Architect Perspective

Date: 2026-05-15

## Executive Summary

The Robota monorepo layer model is fundamentally sound: `agent-core` has genuine zero external
agent-\* dependencies, the `agent-sessions → agent-runtime → agent-core` chain is clean, and the
CLI/SDK boundary has been hardened through several audit cycles (CLI-AUDIT-001 through CLI-AUDIT-009
all resolved). The most significant structural risk is that `agent-sdk/src/subagents/` contains
concrete `child_process` fork logic that belongs in a CLI-owned adapter, contradicting the
architecture's own adapter-split rule and making agent-sdk non-deployable in environments lacking
Node.js `child_process`. A second systemic issue is that `ITerminalOutput`/`ISpinner` — canonically
owned by `agent-core` — are still re-exported through `agent-sessions` in three separate places.
The `auth` and `credits` packages exist as well-designed contracts but are completely unreferenced
in production, meaning authentication and credit policies documented in the cross-cutting contracts
index are not actually enforced anywhere.

---

## Findings

### [ARCH-SA-001] Child-process fork logic lives inside `agent-sdk`, violating the adapter-split rule

- **Severity**: High
- **Area**: Assembly layer / `agent-sdk`
- **Problem**: `packages/agent-sdk/src/subagents/child-process-subagent-runner.ts` calls `fork` from
  `node:child_process` directly. This is concrete Node process I/O classified as a CLI adapter in
  CLI-AUDIT-006, yet the file lives in `agent-sdk` and is re-exported from `agent-cli/src/subagents/index.ts`.
- **Evidence**: `agent-sdk/src/subagents/child-process-subagent-runner.ts` line 1:
  `import { fork } from 'node:child_process'`. `agent-sdk/src/subagents/index.ts` exports
  `ChildProcessSubagentRunner` and `createChildProcessSubagentRunnerFactory`.
- **Recommendation**: Move `child-process-subagent-runner.ts`, `child-process-subagent-runner-result.ts`,
  `child-process-subagent-transport.ts`, `child-process-subagent-ipc.ts`, and the worker file to
  `packages/agent-cli/src/subagents/`. `agent-sdk/src/subagents/index.ts` should export only
  `in-process-subagent-runner.ts` and `@robota-sdk/agent-runtime` re-exports.

---

### [ARCH-SA-002] `ITerminalOutput`/`ISpinner` ownership chain is ambiguous across three packages

- **Severity**: Medium
- **Area**: Cross-cutting contracts / `agent-core` → `agent-sessions` → `agent-sdk`
- **Problem**: `ITerminalOutput` and `ISpinner` are owned by `agent-core` but imported from
  `@robota-sdk/agent-sessions` by `agent-sdk/src/types.ts`, `agent-sdk/src/subagents/in-process-subagent-runner.ts`,
  and `agent-transport-tui/src/InkTerminal.ts`. The cross-cutting contracts index says `agent-core`
  owns terminal types; the relay through `agent-sessions` is an undocumented indirection.
- **Evidence**: `agent-sdk/src/types.ts` line 13–14: comment "Terminal types from agent-sessions."
  `agent-transport-tui/src/InkTerminal.ts` line 10: imports from `@robota-sdk/agent-sessions`.
- **Recommendation**: Update `agent-sdk/src/types.ts`, `in-process-subagent-runner.ts`, and
  `InkTerminal.ts` to import from `@robota-sdk/agent-core`. Remove `@robota-sdk/agent-sessions` from
  `agent-transport-tui` dependencies if it has no other usage. Add a harness check.

---

### [ARCH-SA-003] `auth` and `credits` packages are contract-only orphans with zero production consumers

- **Severity**: High
- **Area**: Cross-cutting contracts / `auth`, `credits`
- **Problem**: Neither `@robota-sdk/auth` nor `@robota-sdk/credits` is depended on by any production
  package or app. `apps/agent-server/src/websocket-server.ts` implements its own inline JWT
  verification using `jsonwebtoken` directly. The architecture's stated intent — that auth/credits
  policy is centralized — is not enforced anywhere at runtime.
- **Evidence**: Zero hits for `@robota-sdk/auth` or `@robota-sdk/credits` in any production
  `package.json`. `apps/agent-server/src/websocket-server.ts` lines 4, 66, 178–191: direct
  `jsonwebtoken` usage with inline JWT secret handling.
- **Recommendation**: Either (a) wire `@robota-sdk/auth` into `apps/agent-server` so the auth
  verifier port is actually used, or (b) formally classify `auth` and `credits` as
  forward-declared contracts not yet wired, and document that `agent-server` inline auth is
  acknowledged technical debt with a migration path.

---

### [ARCH-SA-004] `agent-transport-http` and `agent-transport-mcp` import from `agent-sdk` instead of `agent-interface-transport`

- **Severity**: Medium
- **Area**: Transport layer / `agent-transport-http`, `agent-transport-mcp`
- **Problem**: Both packages import `ITransportAdapter` from `@robota-sdk/agent-sdk` and have
  `agent-sdk` as a production dependency, unnecessarily coupling transports to the full assembly layer.
  `agent-transport-tui` and `agent-transport-headless` correctly depend on
  `@robota-sdk/agent-interface-transport`.
- **Evidence**: `agent-transport-http/src/http-transport.ts` line 8: imports from `@robota-sdk/agent-sdk`.
  `agent-transport-mcp/src/mcp-transport.ts` line 8: same pattern.
- **Recommendation**: Add `@robota-sdk/agent-interface-transport` as a direct dependency to
  `agent-transport-http` and `agent-transport-mcp`; source interface types from there. Add a
  harness check that `agent-transport-*` packages must not import transport interface types from
  `@robota-sdk/agent-sdk`.

---

### [ARCH-SA-005] `agent-runtime` contains concrete Node.js I/O, blurring the adapter boundary

- **Severity**: Medium
- **Area**: Runtime services / `agent-runtime`
- **Problem**: `agent-runtime/src/background-tasks/runners/managed-shell-process-runner.ts` calls
  `spawn` from `node:child_process` directly. `agent-runtime/src/subagents/git-worktree-isolation-adapter.ts`
  calls `execFileSync` and performs Git operations. The SPEC says "Concrete I/O belongs in adapters
  owned by runtime shells." CLI-AUDIT-006 classified `git-worktree-isolation-adapter.ts` as a "CLI
  adapter," yet it lives in and is exported from `agent-runtime`.
- **Evidence**: `agent-runtime/src/background-tasks/runners/managed-shell-process-runner.ts` line 1:
  `import { spawn } from 'node:child_process'`. `agent-runtime/src/index.ts` exports
  `GitWorktreeIsolationAdapter`.
- **Recommendation**: Move `git-worktree-isolation-adapter.ts` to `agent-cli/src/subagents/` per
  its own audit classification. For `managed-shell-process-runner.ts`: either update the SPEC to
  document that `agent-runtime` intentionally provides default concrete process runner
  implementations, or move it to a CLI adapter.

---

### [ARCH-SA-006] `InteractiveSession` is a 1,576-line god class

- **Severity**: Medium
- **Area**: Assembly layer / `agent-sdk`
- **Problem**: `agent-sdk/src/interactive/interactive-session.ts` is 1,576 lines with 45+ private
  fields and 60+ methods spanning prompt queuing, skill activation, background task lifecycle, agent
  job lifecycle, context references, edit checkpoints, sandbox snapshots, fork-skill execution, and
  streaming. This violates the 300-line anti-monolith rule.
- **Evidence**: Fields from line 178–219: 45 private fields. Methods covering fundamentally
  different concerns in the same class.
- **Recommendation**: Extract three focused sub-objects: `BackgroundTaskState`,
  `ContextReferenceState`, `EditCheckpointState`. Keep `InteractiveSession` as a thin coordinator
  delegating to these objects, following the pattern already used in `agent-sessions/session.ts`.

---

### [ARCH-SA-007] `chalk` is a production dependency of `agent-sdk`

- **Severity**: Low
- **Area**: Assembly layer / `agent-sdk`
- **Problem**: `agent-sdk/src/permissions/permission-prompt.ts` imports `chalk` directly and uses
  it for terminal styling. The SDK is declared React-free and platform-neutral. Chalk usage in the
  assembly layer means any environment consuming `agent-sdk` gets ANSI escape sequences injected.
- **Evidence**: `agent-sdk/package.json` line 50: `"chalk": "^5.3.0"`.
  `agent-sdk/src/permissions/permission-prompt.ts` lines 7, 36, 37: `import chalk from 'chalk'`.
- **Recommendation**: Remove chalk from `agent-sdk`. Use plain strings through `ITerminalOutput`
  and let the CLI adapter apply styling.

---

### [ARCH-SA-008] Playground stack bypasses `agent-sdk`, creating a parallel execution path

- **Severity**: Medium
- **Area**: Playground / `agent-playground`
- **Problem**: `agent-playground/package.json` has no dependency on `@robota-sdk/agent-sdk`,
  `@robota-sdk/agent-sessions`, or `@robota-sdk/agent-runtime`. The playground's `remote-providers.ts`
  instantiates providers directly without SDK assembly. This means the playground does not benefit
  from SDK-owned session management, command APIs, context loading, permission enforcement, or
  compaction — it is a separate, lower-capability execution path not reflected in the architecture map.
- **Evidence**: `agent-playground/package.json`: no `agent-sdk` dependency.
  `agent-playground/src/lib/playground/robota-executor/remote-providers.ts` lines 29–30: direct
  `new OpenAIProvider(...)`, `new AnthropicProvider(...)` construction.
- **Recommendation**: Decide whether the playground intentionally runs without SDK session
  management (a deliberate design choice) or architectural drift. Document this decision in
  `agent-system.md` with an accurate dependency diagram reflecting actual edges.

---

### [ARCH-SA-009] `agent-transport-tui` depends on `agent-sessions` for `ITerminalOutput`

- **Severity**: Low
- **Area**: Transport layer / `agent-transport-tui`
- **Problem**: `agent-transport-tui/src/InkTerminal.ts` imports `ITerminalOutput, ISpinner` from
  `@robota-sdk/agent-sessions` even though the canonical owner is `@robota-sdk/agent-core`. This
  creates a sessions dependency in the transport package just to get a terminal I/O type.
- **Evidence**: `agent-transport-tui/src/InkTerminal.ts` line 10: imports from
  `@robota-sdk/agent-sessions`. `agent-transport-tui/package.json` includes `agent-sessions`.
- **Recommendation**: Change `InkTerminal.ts` to import from `@robota-sdk/agent-core`. Remove
  `@robota-sdk/agent-sessions` from `agent-transport-tui/package.json` if not used elsewhere.

---

### [ARCH-SA-010] `croner` production dependency in `agent-runtime` is undocumented in the SPEC

- **Severity**: Low
- **Area**: Runtime services / `agent-runtime`
- **Problem**: `agent-runtime/package.json` includes `croner: ^10.0.1` as a production dependency.
  The SPEC does not mention a cron scheduling capability. `src/background-tasks/runners/scheduled-task-runner.ts`
  exists but is not listed in the Public API Surface table.
- **Evidence**: `agent-runtime/package.json` dependency `croner`.
  `agent-runtime/src/background-tasks/runners/scheduled-task-runner.ts` exists but is absent from
  SPEC.
- **Recommendation**: Update `agent-runtime/docs/SPEC.md` to document `ScheduledTaskRunner`,
  its contract, and `croner` as a production dependency.

---

## Positive Findings

- **`agent-core` zero-dependency invariant** is rigorously maintained and mechanically enforced.
- **Resolved CLI audit items** (CLI-AUDIT-001 through CLI-AUDIT-009) are genuinely resolved in source.
- **Provider dependency chain** is clean — all provider packages depend only on `agent-core`.
- **Plugin isolation** is complete — all `agent-plugin-*` depend only on `agent-core`.
- **`agent-interface-transport`** circular dependency break is well-executed; TUI, headless, WS transports correctly source from the interface package.
- **`agent-sdk`** is genuinely React-free; `check-sdk-react-free.mjs` guards this mechanically.
- **Command module isolation** is correctly enforced — no `agent-command-*` imports `agent-cli`.

---

## Priority Recommendations

1. Move child-process subagent runner from `agent-sdk` to `agent-cli` (ARCH-SA-001) — most architecturally significant violation.
2. Wire `@robota-sdk/auth` into `apps/agent-server` or formally document it as forward-declared debt (ARCH-SA-003).
3. Extract sub-objects from `InteractiveSession` to address god-class risk (ARCH-SA-006).
4. Fix `ITerminalOutput`/`ISpinner` import chain and add harness check (ARCH-SA-002 + ARCH-SA-009).
5. Clarify and document `agent-runtime` concrete I/O boundary decision (ARCH-SA-005 + ARCH-SA-010).
