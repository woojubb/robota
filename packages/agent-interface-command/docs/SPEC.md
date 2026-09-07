# SPEC.md — @robota-sdk/agent-interface-command

## Package Identity

- **npm name**: `@robota-sdk/agent-interface-command`
- **Layer**: Layer 0 — the dependency set that places it there is declared in this package's manifest
  and enforced by `check-dependency-direction.mjs`; not restated here. The layer itself is declared in
  [`.agents/specs/contract-family-owner-map.md`](../../../.agents/specs/contract-family-owner-map.md)
  and enforced by `scripts/harness/interface-layers.mjs` (ARCH-101).
- **SDK**: (none — contract declarations only)
- **Platform**: node

## Scope

This package owns the **command contract family**: what a command is, what it returns, how it is
listed and invoked, the plugin surfaces a command host exposes, and the capability descriptors a
command declares about itself.

It contains type declarations only. No class, no runtime logic, no mechanism.

## Boundaries

| Concern                                                | Owner                                           |
| ------------------------------------------------------ | ----------------------------------------------- |
| Command _implementations_ and their modules            | `agent-command`, command-module owners          |
| Command infrastructure and reusable host APIs          | `agent-framework`                               |
| Rendering a command's result                           | `agent-transport-tui`, `agent-transport-gui`    |
| Session, interaction, event, turn and driver contracts | `agent-interface-transport` (until issue #2110) |
| Background task, workspace and subagent contracts      | `agent-interface-execution`                     |

**This package declares what a command IS; it decides nothing about what any command DOES.**

## Architecture Overview

**Layer 0.** It depends on no peer `agent-interface-*` package, and composition runs downward into it
— `agent-interface-session` names these types; this package never names a session type. That
direction is a BOUNDARY this package commits to, which the manifest does not carry.

Two modules, one dependency between them:

```text
command-contracts → capability-contracts
```

`capability-contracts` has **no consumer outside this package**. It is exported anyway: the owner
ruled on issue #2177 that it stays public. The measurement that surfaced it — zero external
consumers — established a question about the surface and did not answer it, and the answer was to
keep it.

## Type Ownership

| Type                                                            | Location                      | Purpose                                       |
| --------------------------------------------------------------- | ----------------------------- | --------------------------------------------- |
| `ICommand`, `ICommandSource`                                    | `src/command-contracts.ts`    | what a command is and where it came from      |
| `ICommandResult`, `TCommandResultDataValue`                     | `src/command-contracts.ts`    | what running one produces                     |
| `ICommandListEntry`, `TCommandInvocationSource`                 | `src/command-contracts.ts`    | listing and invocation provenance             |
| `TCommandHostAction`, `TCommandUiIntent`                        | `src/command-contracts.ts`    | what a command asks of its host and of the UI |
| `ICommandPluginAdapter` and the four plugin record types        | `src/command-contracts.ts`    | the plugin surface a command host exposes     |
| `ISkillExecutionPort`, `ISkillResolutionResult`                 | `src/command-contracts.ts`    | resolving a skill command to its prompt       |
| `IStatusLineCommandSettings`, `TStatusLineCommandSettingsPatch` | `src/command-contracts.ts`    | the status-line command's settings shape      |
| `ICapabilityDescriptor`, `TCapabilityKind`, `TCapabilitySafety` | `src/capability-contracts.ts` | what a command declares about its own effects |

21 declarations in total. `src/index.ts` is the single entry point; there is no subpath export.

## Public API Surface

| Export           | Kind | Description                               |
| ---------------- | ---- | ----------------------------------------- |
| every name above | type | contract declarations; see Type Ownership |

**No runtime value is exported.** `scan-interface-runtime` refuses anything beyond a contract's
vocabulary and its discriminators, and this package needs neither.

## Extension Points

None by design. A contract package is extended by amending a declaration. A host needing a narrower
command shape declares it in its own package and states how it relates to `ICommand`.

## Error Taxonomy

| Error | Code | Category | Recoverable |
| ----- | ---- | -------- | ----------- |
| —     | —    | —        | —           |

This package declares no error type and throws nothing. A failed command is reported through
`ICommandResult.success`, which is a result shape rather than an error, and what follows a failure is
the host's decision.

## Test Strategy

`src/__tests__/contracts.test.ts` asserts the exported contract shapes, including that
`ICapabilityDescriptor` is reachable from the entry — which is what makes the issue #2177 ruling a
checked property rather than an intention. `command-effect-grep-floor.test.ts` is a workspace-wide
floor: no production source may reference the deleted legacy command-effect contract.

Beyond that the package declares types and exports no behavior, so the remaining assertion available
is that it compiles, which `pnpm typecheck` makes on every run. Its contracts are exercised by
`agent-command`, `agent-command-workflows` and the transport surfaces that render command results.

**The command/session boundary test stays in `agent-interface-transport`.**
`command-action-split-contracts.test.ts` asserts that a command action and a session event remain
distinct, so it names types from both sides. Moving it here would make this package's test suite
depend on the transport package — an **upward** edge under ARCH-101, which the layer rule forbids —
so it lives on the side that can see both and imports command types from here.

## Class Contract Registry

None. This package declares no class, and `scan-interface-runtime` refuses one.
