# SPEC.md — @robota-sdk/agent-interface-session

## Package Identity

- **npm name**: `@robota-sdk/agent-interface-session`
- **Layer**: Layer 1 — the dependency set that places it there is declared in this package's manifest
  and enforced by `check-dependency-direction.mjs`; not restated here. The layer itself is declared in
  [`.agents/specs/contract-family-owner-map.md`](../../../.agents/specs/contract-family-owner-map.md)
  and enforced by `scripts/harness/interface-layers.mjs` (ARCH-101).
- **SDK**: (none — contract declarations only)
- **Platform**: node

## Scope

This package owns the **runtime session contracts**: what an interactive session is and exposes, the
channel a surface talks to it through, the events it emits, the handle for one turn, the record that
persists it, and the compaction trigger.

It contains type declarations only, plus the narrow accessors and discriminators the Interface Package
Rule permits at the entry.

## Boundaries

| Concern                                             | Owner                                           |
| --------------------------------------------------- | ----------------------------------------------- |
| Constructing and running a session                  | `agent-framework`, `agent-session`              |
| Persisting a session record                         | `agent-session`                                 |
| Rendering a session to a surface                    | `agent-transport-tui`, `agent-transport-gui`    |
| Carrying a session across a wire                    | `agent-transport-*`                             |
| Background tasks, job groups, subagents, workspaces | `agent-interface-execution`                     |
| Commands and capability descriptors                 | `agent-interface-command`                       |
| Usage and run-trace measurements                    | `agent-interface-analytics`                     |
| Transport adapters, channels, admission             | `agent-interface-transport`                     |
| Peer messaging and handoff                          | `agent-interface-transport` (until issue #2111) |

## Architecture Overview

**Layer 1, and the first owner in this family that COMPOSES rather than sits at the bottom.** The
three wave-1 owners are layer 0 and name nothing from each other. This package names execution,
command and analytics contracts and depends on those packages **downward**; nothing at layer 0 names a
type from here.

Eight modules. The internal graph has cycles among `session-contracts`,
`session-capability-contracts`, `turn-contracts` and `event-contracts` — type-level and legal inside
one package, and inherited deliberately: ARCH-100 recorded them rather than making a leaf that moves
symbols also redesign their composition.

## Type Ownership

| Type                                                             | Location                              | Purpose                                                 |
| ---------------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------- |
| `IInteractiveSession`, `IInteractiveSessionEvents`               | `src/session-contracts.ts`            | the session surface and its event map                   |
| the 16 `ISession*` capability slices                             | `src/session-capability-contracts.ts` | what a session exposes, one capability at a time        |
| `IInteractiveSessionRecord`, `IInteractiveSessionStore`          | `src/session-contracts.ts`            | the persisted session and its store port                |
| `IGoalState`, `IPlanStep`, `IPlanArtifact`, `IBranchEvent`       | `src/session-contracts.ts`            | goal, plan and branch state carried on a session        |
| `IInteractionChannel`, `InteractionEvent`, `IAgentDriver`        | `src/interaction-contracts.ts`        | the in-process channel port and its one-way event union |
| `ISkillActivationEvent`, `IMemoryEvent`, `IContextReferenceItem` | `src/event-contracts.ts`              | session-event payloads                                  |
| `TDriverId`, `ISubmitOptions`, `IUiIntentEvent`                  | `src/driver-contracts.ts`             | driver identity and driver-routed events                |
| `ITurnHandle`, `IExecutionResult`, `ITurnNotRunError`            | `src/turn-contracts.ts`               | one turn's handle and outcome                           |
| `ICompactEvent`, `TCompactTrigger`                               | `src/compact-contracts.ts`            | context compaction                                      |
| `IResumableSessionSummary`                                       | `src/session-summary-contracts.ts`    | the resume-list projection                              |

85 declarations. `src/index.ts` is the single entry point.

## Public API Surface

| Export                           | Kind     | Description                                                                             |
| -------------------------------- | -------- | --------------------------------------------------------------------------------------- |
| the 85 names above               | type     | contract declarations                                                                   |
| `readAssistantReplies`           | Function | pure accessor — assistant reply records from an `InteractionEvent` stream               |
| `readLastAssistantText`          | Function | pure accessor — the last assistant text from an `InteractionEvent` stream               |
| `readToolCalls`                  | Function | pure accessor — tool-call records from an `InteractionEvent` stream                     |
| `readErrors`                     | Function | pure accessor — error records from an `InteractionEvent` stream                         |
| `isTurnNotRunError`              | Function | the discriminator for a rejected `ITurnHandle.completed`                                |
| `OWNER_DRIVER_ID`                | Constant | driver id for a local/owner turn — display-only attribution, never authorization        |
| `AGENT_DRIVER_ID`                | Constant | driver id for an agent-initiated turn — display-only attribution                        |
| `SESSION_CAPABILITY_MEMBER_KEYS` | Constant | the capability-map vocabulary, in exact role/member parity with `ISessionCapabilityMap` |

### `./testing` subpath

| Export                            | Kind     | Description                                     |
| --------------------------------- | -------- | ----------------------------------------------- |
| `createSessionCapabilityHost`     | Function | builds a capability host over a session double  |
| `createTestSessionCapabilityHost` | Function | the same factory under its consumer-facing name |
| `readSessionCapability`           | Function | reads one capability off a host, for assertions |

Doubles live with the contract they exercise, per `contracts→agent-interface-*, doubles→owner
/testing`. `createSessionCapabilityHost` moved here in ARCH-106 because it imports a VALUE
(`SESSION_CAPABILITY_MEMBER_KEYS`) from the capability contracts — a cross-package value import that
`interface-runtime` refuses and a relative one it permits.

The runtime values are the vocabulary and discriminators the Interface Package Rule permits at the
entry. **Eight of them are why ARCH-106's split rule derives membership from declarations rather than
from the barrel's `export type` blocks** — a codemod reading only type exports left all eight behind.

## Extension Points

None by design. A consumer needing a narrower session surface names one of the capability slices
rather than the whole `IInteractiveSession`.

## Error Taxonomy

| Error              | Code                | Category                                            | Recoverable        |
| ------------------ | ------------------- | --------------------------------------------------- | ------------------ |
| `ITurnNotRunError` | `TTurnNotRunReason` | data contract, discriminated by `isTurnNotRunError` | the caller decides |

Declared as a SHAPE here and constructed in `@robota-sdk/agent-framework`, because an interface
package is inert by rule. `isTurnNotRunError` is the permitted discriminator.

## Test Strategy

`src/__tests__/` holds the contract-surface, interaction-accessor and obsolete-event assertions that
moved with their declarations.

**Two tests deliberately did NOT move**, and the reasoning is the same rule reaching opposite
conclusions at different times:

- `session-capability-contracts.test.ts` stays in `agent-interface-transport` because it needs the
  `/testing` doubles, which stay there. Moving it would make this package's suite depend on transport
  — an **upward** edge under ARCH-101.
- `command-action-split-contracts.test.ts` moved _to_ this package. ARCH-104 kept it in transport
  because that was the side that could see both command and session; ARCH-106 moved session out, so
  this package became that side.

A test belongs where it can name both sides without creating an upward edge, and which package that is
changes as families move.

## Class Contract Registry

None. This package declares no class, and `scan-interface-runtime` refuses one.
