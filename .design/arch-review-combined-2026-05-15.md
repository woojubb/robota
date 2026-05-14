# Architecture Review — Combined Report

Date: 2026-05-15
Sources: System Architect review (ARCH-SA-001–010), Senior Developer review (ARCH-SD-001–012)

## Executive Summary

Two independent reviews converged on the same top-tier risks. The most critical structural
violation is that concrete `child_process` fork logic lives inside `agent-sdk` (ARCH-SA-001),
directly contradicting the adapter-split rule. The second highest-impact gap is a missing
`IInteractiveSession` interface combined with `agent-command-agent` bypassing `ICommandHostContext`
entirely (ARCH-SD-001, ARCH-SD-002): the command contract is broken at the most-used command
module. The `ICommandHostContext` itself is ambiguous — 10+ optional methods and agent job
controls missing from the interface (ARCH-SD-007, ARCH-SD-010). The `auth`/`credits` packages
are contract-only orphans with zero production consumers (ARCH-SA-003). Supporting violations —
wrong import sources, a god class, chalk in the SDK, undocumented croner, playground parallel
path — are real but tractable once the structural gaps above are resolved.

---

## Deduplicated Findings

Items that appeared in both reviews are merged below. Severity is the higher of the two.

---

### [COMBINED-001] Child-process fork logic in `agent-sdk` violates adapter-split rule

- **Sources**: ARCH-SA-001
- **Severity**: High
- **Area**: Assembly layer / `agent-sdk` → `agent-cli`
- **Problem**: `agent-sdk/src/subagents/child-process-subagent-runner.ts` calls `fork` from
  `node:child_process` directly. CLI-AUDIT-006 classified this as a CLI adapter. The file
  nonetheless lives in `agent-sdk` and is re-exported from `agent-cli/src/subagents/index.ts`,
  making `agent-sdk` non-deployable in environments without `child_process`.
- **Files to move**: `child-process-subagent-runner.ts`, `child-process-subagent-runner-result.ts`,
  `child-process-subagent-transport.ts`, `child-process-subagent-ipc.ts`, worker file →
  `packages/agent-cli/src/subagents/`.
- **After**: `agent-sdk/src/subagents/index.ts` exports only `in-process-subagent-runner.ts`
  and `@robota-sdk/agent-runtime` re-exports.
- **Backlog**: ARCH-FIX-024

---

### [COMBINED-002] `auth` and `credits` are contract-only orphans — zero production consumers

- **Sources**: ARCH-SA-003
- **Severity**: High
- **Area**: Cross-cutting contracts / `auth`, `credits`
- **Problem**: Neither `@robota-sdk/auth` nor `@robota-sdk/credits` is depended on by any
  production package. `apps/agent-server/src/websocket-server.ts` lines 4, 66, 178–191 implement
  inline JWT verification with `jsonwebtoken` directly, bypassing the auth port entirely.
- **Decision required**: (a) Wire `@robota-sdk/auth` into `apps/agent-server`; or (b) classify
  `auth`/`credits` as forward-declared contracts and document `agent-server` inline auth as
  acknowledged technical debt with a migration path.
- **Backlog**: ARCH-FIX-025

---

### [COMBINED-003] `agent-command-agent` bypasses `ICommandHostContext` — uses `InteractiveSession` directly

- **Sources**: ARCH-SD-001
- **Severity**: High
- **Area**: Command modules / `agent-command-agent`
- **Problem**: `agent-command-agent/src/agent-command.ts` line 207 declares
  `executeAgentCommand(session: InteractiveSession, ...)`. This breaks the command module contract
  and couples the module to the assembly layer's concrete class.
- **Fix**: Change parameter to `ICommandHostContext`. Remove `agent-sdk` production dependency.
  Add harness check: `agent-command-*` must not import from `@robota-sdk/agent-sdk`.
- **Backlog**: SDK-001 (combined with IInteractiveSession work)

---

### [COMBINED-004] No `IInteractiveSession` interface — transports and tests use unsafe casts

- **Sources**: ARCH-SD-002
- **Severity**: High
- **Area**: Assembly layer / transports / tests
- **Problem**: All transport packages and 15+ test files use `as unknown as InteractiveSession`
  casts. There is no exported `IInteractiveSession` interface in `agent-sdk`.
- **Fix**: Define and export `IInteractiveSession`. Transport packages and test utilities switch
  to it. `createTestInteractiveSession(overrides?)` factory replaces all unsafe casts.
- **Related**: ARCH-SD-003 (god class), ARCH-SD-008 (test factory)
- **Backlog**: SDK-001

---

### [COMBINED-005] `ICommandHostContext` — 10+ optional methods, agent job controls missing

- **Sources**: ARCH-SD-007, ARCH-SD-010
- **Severity**: High
- **Area**: Domain contracts / `agent-core`
- **Problem**: The base `ICommandHostContext` interface has accumulated 10+ optional (`?:`) methods.
  Agent job operations (`spawnAgentJob`, `sendAgentJob`, `waitForAgentJob`, `cancelAgentJob`) are
  either missing or optional. Command modules cannot safely call agent job controls without
  unsafe casts or null-checks at every call site.
- **Fix**: Split into required base `ICommandHostContext` + capability sub-interfaces
  (`IAgentJobHostContext`, `IContextReferenceHostContext`). Command modules declare the specific
  sub-interface they need.
- **Related**: ARCH-SD-001 (agent-command-agent bypass), ARCH-SD-002 (no IInteractiveSession)
- **Backlog**: SDK-002

---

### [COMBINED-006] `ITerminalOutput`/`ISpinner` imported from `agent-sessions` instead of `agent-core`

- **Sources**: ARCH-SA-002, ARCH-SA-009
- **Severity**: Medium
- **Area**: Cross-cutting contracts / `agent-core` → `agent-sessions` → `agent-sdk`, `agent-transport-tui`
- **Problem**: `agent-sdk/src/types.ts`, `in-process-subagent-runner.ts`, and
  `agent-transport-tui/src/InkTerminal.ts` import `ITerminalOutput`/`ISpinner` from
  `@robota-sdk/agent-sessions` rather than from the canonical owner `@robota-sdk/agent-core`.
  This creates an undocumented indirection and forces `agent-transport-tui` to carry a sessions
  dependency just for terminal I/O types.
- **Fix**: Redirect all three files to import from `@robota-sdk/agent-core`. Remove
  `@robota-sdk/agent-sessions` from `agent-transport-tui` if no other usage. Add harness check.
- **Backlog**: ARCH-FIX-026

---

### [COMBINED-007] `agent-transport-http`/`agent-transport-mcp` import from `agent-sdk` instead of `agent-interface-transport`

- **Sources**: ARCH-SA-004
- **Severity**: Medium
- **Area**: Transport layer
- **Problem**: Both packages import `ITransportAdapter` from `@robota-sdk/agent-sdk` and list
  `agent-sdk` as a production dependency. `agent-transport-tui` and `agent-transport-headless`
  correctly use `@robota-sdk/agent-interface-transport`. This is an inconsistency in the transport
  family.
- **Fix**: Add `@robota-sdk/agent-interface-transport` as a direct dependency; source interface
  types from there. Add harness check: `agent-transport-*` must not import transport interface
  types from `@robota-sdk/agent-sdk`.
- **Backlog**: ARCH-FIX-027

---

### [COMBINED-008] `agent-runtime` concrete Node.js I/O — adapter boundary unclear

- **Sources**: ARCH-SA-005, ARCH-SA-010
- **Severity**: Medium
- **Area**: Runtime services / `agent-runtime`
- **Problem**: `managed-shell-process-runner.ts` calls `spawn` from `node:child_process`.
  `git-worktree-isolation-adapter.ts` calls `execFileSync` and is exported from `agent-runtime`
  despite being classified as a CLI adapter in CLI-AUDIT-006. Additionally, `croner` is a
  production dependency not mentioned in `agent-runtime/docs/SPEC.md`.
- **Decision required**: Either update SPEC to document that `agent-runtime` intentionally
  provides concrete process runners, or move them to `agent-cli`. Move
  `git-worktree-isolation-adapter.ts` to `agent-cli/src/subagents/`. Add `ScheduledTaskRunner`
  and `croner` dependency to SPEC.md.
- **Backlog**: ARCH-FIX-028

---

### [COMBINED-009] `InteractiveSession` god class — 1,576 lines

- **Sources**: ARCH-SA-006, ARCH-SD-003
- **Severity**: Medium
- **Area**: Assembly layer / `agent-sdk`
- **Problem**: 1,576 lines, 45+ fields, 60+ methods. Violates the 300-line anti-monolith rule by 5×.
  Spans fundamentally different concerns.
- **Fix**: Extract `BackgroundTaskState`, `ContextReferenceState`, `EditCheckpointState`.
  Keep `InteractiveSession` as thin coordinator. Introduce `IInteractiveSession` (see COMBINED-004).
- **Backlog**: SDK-001 (as part of the same refactor)

---

### [COMBINED-010] Playground stack bypasses `agent-sdk` — parallel execution path

- **Sources**: ARCH-SA-008
- **Severity**: Medium
- **Area**: Playground / `agent-playground`
- **Problem**: `agent-playground` has no dependency on `agent-sdk`, `agent-sessions`, or
  `agent-runtime`. Providers are instantiated directly. The playground has no session management,
  compaction, permission enforcement, or command APIs.
- **Decision required**: Is this intentional (lightweight playground) or drift? Document in
  SPEC.md and update dependency diagram to reflect actual edges.
- **Backlog**: ARCH-FIX-029

---

### [COMBINED-011] Plugin packages have zero active production consumers

- **Sources**: ARCH-SD-005
- **Severity**: Medium
- **Area**: Plugin layer / `agent-plugin-*`
- **Problem**: All 9 `agent-plugin-*` packages are contract-correct but none is registered in
  any production assembly path. The plugin architecture is proven in isolation, not at integration.
- **Decision required**: Wire at least one plugin into the default CLI assembly, or explicitly
  document that plugins are application-consumer responsibility and not built into the CLI.
- **Backlog**: SDK-003

---

### [COMBINED-012] `command-inventory.md` missing `/settings` and `/user-local`

- **Sources**: ARCH-SD-006
- **Severity**: Medium
- **Area**: Architecture docs
- **Problem**: Both commands are implemented and routed but absent from the canonical inventory.
- **Fix**: Add both commands to `command-inventory.md` with owner, host effects, model visibility.
  Add harness check: command module packages must have inventory entries.
- **Backlog**: DOCS-001

---

### [COMBINED-013] Bare `object` type in `TCommandResultDataValue`

- **Sources**: ARCH-SD-004
- **Severity**: Medium
- **Area**: Command API / `agent-sdk`
- **Problem**: `agent-sdk/src/command-api/command-result.ts` line 5 uses bare `object` type,
  preventing type-safe property access.
- **Fix**: Replace `object` with `Record<string, unknown>` or a named discriminated union.
- **Backlog**: SDK-004

---

### [COMBINED-014] `chalk` is a production dependency of `agent-sdk`

- **Sources**: ARCH-SA-007, ARCH-SD-009
- **Severity**: Low
- **Area**: Assembly layer / `agent-sdk`
- **Problem**: Chalk in `agent-sdk` violates the SDK's platform-neutral contract. ANSI sequences
  are injected in any environment consuming `agent-sdk`, not just CLI contexts.
- **Fix**: Remove chalk from `agent-sdk`. Route styled output through `ITerminalOutput`. CLI
  adapter applies ANSI styling.
- **Backlog**: SDK-005

---

### [COMBINED-015] `agent-sdk/src/index.ts` publicly exports internal assembly helpers

- **Sources**: ARCH-SD-011
- **Severity**: Low
- **Area**: Assembly layer / `agent-sdk`
- **Problem**: Internal session factory helpers and command executors are exported from the public
  barrel but not documented in SPEC.md Public API Surface.
- **Fix**: Audit exports vs. SPEC.md. Move internal helpers to `src/internal/`. Update SPEC.md.
- **Backlog**: SDK-006

---

### [COMBINED-016] `SystemCommandExecutor` has no error boundary

- **Sources**: ARCH-SD-012
- **Severity**: Low
- **Area**: Assembly layer / `agent-sdk`
- **Problem**: Unhandled errors in command handlers propagate out of `executeCommand` and can
  crash the session.
- **Fix**: Wrap dispatch in try/catch returning structured `CommandResult` with `success: false`.
- **Backlog**: SDK-007

---

### [COMBINED-017] Test infrastructure — no `createTestInteractiveSession` factory

- **Sources**: ARCH-SD-008
- **Severity**: Medium (test quality / safety)
- **Area**: Test infrastructure / `agent-sdk`
- **Problem**: 15+ test files use `{} as unknown as InteractiveSession`. No official factory.
  New required methods produce silent `undefined` rather than type errors.
- **Fix**: Export `createTestInteractiveSession(overrides?: Partial<IInteractiveSession>)`.
  Depends on COMBINED-004 (IInteractiveSession).
- **Backlog**: SDK-001 (as deliverable within the IInteractiveSession work)

---

## Positive Findings (Both Reviews)

- `agent-core` zero-dependency invariant is rigorously maintained and mechanically enforced.
- All CLI audit items (CLI-AUDIT-001 through CLI-AUDIT-009) are genuinely resolved in source.
- Provider and plugin packages correctly isolate to `agent-core` only.
- `agent-interface-transport` circular dependency break is well-executed.
- `agent-sdk` is genuinely React-free; mechanically guarded.
- Command module isolation mostly correct — only `agent-command-agent` violates it.
- Session/runtime split is structurally clean.

---

## Backlog Plan

| Backlog ID   | Title                                                              | Priority | Severity |
| ------------ | ------------------------------------------------------------------ | -------- | -------- |
| ARCH-FIX-024 | Move child-process runner from agent-sdk to agent-cli              | high     | High     |
| ARCH-FIX-025 | Wire auth/credits or document as forward-declared debt             | high     | High     |
| SDK-001      | IInteractiveSession + InteractiveSession refactor + test factory   | high     | High     |
| SDK-002      | ICommandHostContext capability sub-interfaces + agent job controls | high     | High     |
| ARCH-FIX-026 | Fix ITerminalOutput/ISpinner import chain                          | medium   | Medium   |
| ARCH-FIX-027 | Fix agent-transport-http/mcp to use agent-interface-transport      | medium   | Medium   |
| ARCH-FIX-028 | Clarify agent-runtime I/O boundary + document croner in SPEC       | medium   | Medium   |
| ARCH-FIX-029 | Document playground execution path decision                        | medium   | Medium   |
| SDK-003      | Wire plugin packages in assembly or document as consumer-opt-in    | medium   | Medium   |
| SDK-004      | Replace bare object in TCommandResultDataValue                     | medium   | Medium   |
| DOCS-001     | Add /settings and /user-local to command-inventory.md              | medium   | Medium   |
| SDK-005      | Remove chalk from agent-sdk                                        | low      | Low      |
| SDK-006      | Separate agent-sdk/src/index.ts internal exports to subpath        | low      | Low      |
| SDK-007      | Add error boundary in SystemCommandExecutor                        | low      | Low      |
