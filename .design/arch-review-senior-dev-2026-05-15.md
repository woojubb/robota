# Architecture Review — Senior Developer Perspective

Date: 2026-05-15

## Executive Summary

The Robota monorepo has strong foundations: clean provider/plugin isolation, well-enforced
`agent-core` zero-dependency invariant, and a reasonably clear session/runtime/SDK separation. The
most urgent implementation-level gap is that `agent-command-agent` bypasses `ICommandHostContext`
entirely and reaches directly into the concrete `InteractiveSession`, which breaks the command
module contract. The second critical gap is the absence of `IInteractiveSession`: transports and
tests resort to `as unknown as InteractiveSession` casts throughout the codebase. The
`ICommandHostContext` contract itself has become ambiguous through accumulated optional methods,
and agent job control surface (`spawnAgentJob`, `sendAgentJob`, etc.) is not declared on the
interface at all.

---

## Findings

### [ARCH-SD-001] `agent-command-agent` bypasses `ICommandHostContext`, uses concrete `InteractiveSession`

- **Severity**: High
- **Area**: Command modules / `agent-command-agent`
- **Problem**: `executeAgentCommand` in `agent-command-agent/src/agent-command.ts` line 207 declares
  its parameter as `session: InteractiveSession`, not `ICommandHostContext`. This violates the
  command module contract (all command modules must interact with the host exclusively through
  `ICommandHostContext`) and couples the command module directly to the assembly-layer class.
- **Evidence**: `agent-command-agent/src/agent-command.ts` line 207:
  `async function executeAgentCommand(session: InteractiveSession, ...)`. The package has
  `@robota-sdk/agent-sdk` as a production dependency where `ICommandHostContext` from
  `@robota-sdk/agent-core` would suffice.
- **Recommendation**: Change `executeAgentCommand` signature to accept `ICommandHostContext`.
  Remove the direct `agent-sdk` production dependency from `agent-command-agent`. Add a harness
  check that `agent-command-*` packages must not import from `@robota-sdk/agent-sdk`.

---

### [ARCH-SD-002] No `IInteractiveSession` interface — concrete class used as contract boundary

- **Severity**: High
- **Area**: Assembly layer / transports / tests
- **Problem**: `InteractiveSession` in `agent-sdk` is a concrete 1,576-line class. Transport
  packages (`agent-transport-tui`, `agent-transport-ws`, `agent-transport-headless`) consume it
  via `as unknown as InteractiveSession` type casts rather than against an interface. This makes
  the transport-to-assembly boundary un-testable and brittle.
- **Evidence**: Multiple transport files use `as unknown as InteractiveSession` to satisfy type
  checking. There is no exported `IInteractiveSession` in `agent-sdk/src/index.ts`.
  15+ test files construct mock sessions with the same unsafe cast pattern.
- **Recommendation**: Define `IInteractiveSession` in `agent-sdk/src/interactive/` exposing only
  the surface transports and tests legitimately consume. Transport packages should depend on
  `IInteractiveSession`. Export from `agent-sdk/src/index.ts`.

---

### [ARCH-SD-003] `InteractiveSession` god class — 1,576 lines, 45 fields, 60+ methods

- **Severity**: Medium
- **Area**: Assembly layer / `agent-sdk`
- **Problem**: `agent-sdk/src/interactive/interactive-session.ts` is 1,576 lines spanning prompt
  queuing, skill activation, background task lifecycle, agent job lifecycle, context references,
  edit checkpoints, sandbox snapshots, fork-skill execution, and streaming. The 300-line
  anti-monolith rule is violated by more than 5×.
- **Evidence**: Lines 178–219: 45 private fields. Methods spanning fundamentally unrelated
  lifecycle concerns in a single class.
- **Recommendation**: Extract `BackgroundTaskState`, `ContextReferenceState`,
  `EditCheckpointState` as focused sub-objects. `InteractiveSession` becomes a thin coordinator.
  Introduce `IInteractiveSession` at the same time (see ARCH-SD-002).

---

### [ARCH-SD-004] Bare `object` type in `TCommandResultDataValue`

- **Severity**: Medium
- **Area**: Command API / `agent-sdk`
- **Problem**: `agent-sdk/src/command-api/command-result.ts` line 5 defines
  `TCommandResultDataValue` with `object` as one of its union members. Bare `object` is
  effectively `Record<string, unknown>` minus type safety — it prevents the caller from accessing
  any properties without casting.
- **Evidence**: `agent-sdk/src/command-api/command-result.ts` line 5:
  `type TCommandResultDataValue = string | number | boolean | object | ...`.
- **Recommendation**: Replace `object` with `Record<string, unknown>`. If structured payloads are
  needed, define a named discriminated union instead.

---

### [ARCH-SD-005] 9 `agent-plugin-*` packages have zero active consumers in production paths

- **Severity**: Medium
- **Area**: Plugin layer / `agent-plugin-*`
- **Problem**: All nine `agent-plugin-*` packages are correctly isolated (depend only on
  `agent-core`) but none is registered or used in any production assembly path (no production
  `agent-sdk`, `agent-cli`, or `apps/agent-server` imports them). This means the plugin
  architecture is proven at the contract level but unproven at integration.
- **Evidence**: No `agent-cli` or `agent-sdk` production source imports any `@robota-sdk/agent-plugin-*`.
  `agent-cli/src/plugins/` does not exist or contains no plugin registrations.
- **Recommendation**: Either wire at least one plugin into the default CLI assembly (demonstrating
  the integration path) or add an explicit architecture note that plugins are application-consumer
  responsibility, not built into the CLI by default.

---

### [ARCH-SD-006] `command-inventory.md` is missing `/settings` and `/user-local` commands

- **Severity**: Medium
- **Area**: Architecture docs / `command-inventory.md`
- **Problem**: The canonical command inventory at `.agents/specs/command-inventory.md` does not
  list the `/settings` and `/user-local` commands, both of which are implemented in
  `agent-command-settings` and routed via the CLI slash-routing layer. The inventory is meant to
  be the authoritative record of all built-in commands.
- **Evidence**: `agent-command-settings/src/` exists and exports `/settings` and `/user-local`
  handlers. Neither command appears in `.agents/specs/command-inventory.md`.
- **Recommendation**: Add `/settings` and `/user-local` to `command-inventory.md` with owner,
  host effects, and model visibility fields. Add a harness check to detect command module packages
  without corresponding inventory entries.

---

### [ARCH-SD-007] `ICommandHostContext` has 10+ optional methods — contract is ambiguous

- **Severity**: Medium
- **Area**: Domain contracts / `agent-core`
- **Problem**: `ICommandHostContext` in `agent-core/src/interfaces/` has grown to include 10 or
  more optional (`?:`) methods. Optional interface methods are a design smell: they cannot be
  safely called without null-checks, they allow partial implementations that silently skip
  behavior, and they prevent compile-time enforcement of the contract.
- **Evidence**: `agent-core/src/interfaces/command-host-context.ts`: multiple optional fields
  (`spawnAgentJob?`, `sendAgentJob?`, `getContextReferences?`, etc.).
- **Recommendation**: Split `ICommandHostContext` into a required base interface and one or more
  capability sub-interfaces (e.g., `IAgentJobHostContext`, `IContextReferenceHostContext`).
  Command modules that need agent job controls should declare `IAgentJobHostContext` in their
  parameter type. This removes optional fields from the base contract.

---

### [ARCH-SD-008] No `createTestInteractiveSession` factory — 15+ test files use unsafe cast

- **Severity**: Medium
- **Area**: Test infrastructure / `agent-sdk`
- **Problem**: Tests across 15+ files construct mock sessions via `{} as unknown as InteractiveSession`
  or similar. There is no official test factory, making tests fragile: any new required method on
  `InteractiveSession` silently produces `undefined` rather than a type error.
- **Evidence**: Grep for `as unknown as InteractiveSession` yields 15+ hits in test files across
  `agent-command-*` packages.
- **Recommendation**: Export `createTestInteractiveSession(overrides?: Partial<IInteractiveSession>)`
  from a test-utilities package or from `agent-sdk/src/testing/`. This ties to ARCH-SD-002:
  once `IInteractiveSession` exists, the factory can implement it explicitly.

---

### [ARCH-SD-009] `chalk` is a production dependency of `agent-sdk`

- **Severity**: Low
- **Area**: Assembly layer / `agent-sdk`
- **Problem**: Same as ARCH-SA-007. `chalk` in `agent-sdk` violates the SDK's platform-neutral
  contract. Any Node.js environment importing `agent-sdk` gets ANSI escape sequences injected
  into terminal output regardless of whether it runs in a CLI or a server.
- **Evidence**: `agent-sdk/package.json`: `"chalk": "^5.3.0"`.
  `agent-sdk/src/permissions/permission-prompt.ts` lines 7, 36–37: direct `chalk` import.
- **Recommendation**: Remove chalk from `agent-sdk`. Route styled output through `ITerminalOutput`
  and let the CLI adapter apply ANSI styling.

---

### [ARCH-SD-010] Agent job controls not declared on `ICommandHostContext`

- **Severity**: Medium
- **Area**: Domain contracts / `agent-core`
- **Problem**: Agent job operations (`spawnAgentJob`, `sendAgentJob`, `waitForAgentJob`,
  `cancelAgentJob`) are either missing from `ICommandHostContext` entirely or declared as optional
  fields (see ARCH-SD-007). Command modules that invoke agent jobs must either cast the context to
  a concrete type or null-check optional fields at every call site.
- **Evidence**: `agent-command-agent/src/agent-command.ts` reaches into `InteractiveSession`
  methods that are not on `ICommandHostContext`.
- **Recommendation**: Define `IAgentJobHostContext` in `agent-core/src/interfaces/` with the full
  required agent job surface. `ICommandHostContext` can extend it. Command modules declare
  `IAgentJobHostContext` when they need job controls.

---

### [ARCH-SD-011] `agent-sdk/src/index.ts` publicly exports SDK-internal assembly helpers

- **Severity**: Low
- **Area**: Assembly layer / `agent-sdk`
- **Problem**: `agent-sdk/src/index.ts` exports several symbols that are internal assembly
  utilities (session factory helpers, private command executors) not documented in the SDK SPEC
  Public API Surface table. These become frozen public API once consumers depend on them.
- **Evidence**: Symbols exported from `agent-sdk/src/index.ts` but absent from
  `agent-sdk/docs/SPEC.md` Public API Surface section.
- **Recommendation**: Audit `agent-sdk/src/index.ts` exports against SPEC.md. Move internal
  helpers to a `src/internal/` subpath and remove them from the public barrel. Document the
  remaining public surface explicitly in SPEC.md.

---

### [ARCH-SD-012] `SystemCommandExecutor.executeCommand` has no error boundary

- **Severity**: Low
- **Area**: Assembly layer / `agent-sdk`
- **Problem**: `agent-sdk/src/commands/system-command-executor.ts` dispatches to command handlers
  without a top-level try/catch. An unhandled error in any command handler propagates out of
  `executeCommand` and can crash the active session rather than returning a structured error result.
- **Evidence**: `agent-sdk/src/commands/system-command-executor.ts`: no try/catch wrapping the
  handler dispatch call path.
- **Recommendation**: Wrap the command dispatch in a try/catch that catches `Error` and returns
  a structured `CommandResult` with `success: false` and the error message. Log the stack trace
  via `ITerminalOutput` for diagnostics.

---

## Positive Findings

- **Provider/plugin isolation** is correct — all provider and plugin packages depend only on `agent-core`.
- **Command module isolation** mostly works — `agent-command-*` packages are decoupled from `agent-cli`.
- **`agent-core` zero-dependency invariant** is rigorously enforced.
- **`agent-sdk` React-free guard** is mechanically checked via `check-sdk-react-free.mjs`.
- **Session/runtime split** is structurally clean — `agent-sessions` owns persistence, `agent-runtime` owns background tasks.
- **`agent-interface-transport`** correctly used by TUI, headless, and WS transports.

---

## Priority Recommendations

1. Fix `agent-command-agent` to use `ICommandHostContext` (ARCH-SD-001) — command contract violation.
2. Introduce `IInteractiveSession` interface (ARCH-SD-002) — enables safe transport/test patterns.
3. Split `ICommandHostContext` optional methods into capability sub-interfaces (ARCH-SD-007 + ARCH-SD-010) — restores contract clarity.
4. Extract sub-objects from `InteractiveSession` (ARCH-SD-003) — prerequisite for long-term maintainability.
5. Add `createTestInteractiveSession` factory (ARCH-SD-008) — removes unsafe casts from 15+ test files.
