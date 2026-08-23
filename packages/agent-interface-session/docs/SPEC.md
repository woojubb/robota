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

| Concern                                             | Owner                                        |
| --------------------------------------------------- | -------------------------------------------- |
| Constructing and running a session                  | `agent-framework`, `agent-session`           |
| Persisting a session record                         | `agent-session`                              |
| Rendering a session to a surface                    | `agent-transport-tui`, `agent-transport-gui` |
| Carrying a session across a wire                    | `agent-transport-*`                          |
| Background tasks, job groups, subagents, workspaces | `agent-interface-execution`                  |
| Commands and capability descriptors                 | `agent-interface-command`                    |
| Usage and run-trace measurements                    | `agent-interface-analytics`                  |
| Transport adapters, channels, admission             | `agent-interface-transport`                  |
| Peer messaging and handoff                          | `agent-interface-session-mobility`           |

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

| Export                            | Kind     | Description                                           |
| --------------------------------- | -------- | ----------------------------------------------------- |
| `createSessionCapabilityHost`     | Function | builds a capability host over a session double        |
| `createTestSessionCapabilityHost` | Function | the same factory under its consumer-facing name       |
| `readSessionCapability`           | Function | reads one capability off a host, for assertions       |
| `createTestInteractiveSession`    | Function | ARCH-012: the conformant `IInteractiveSession` double |

Doubles live with the contract they exercise, per `contracts→agent-interface-*, doubles→owner
/testing`. `createSessionCapabilityHost` moved here in ARCH-106 because it imports a VALUE
(`SESSION_CAPABILITY_MEMBER_KEYS`) from the capability contracts — a cross-package value import that
`interface-runtime` refuses and a relative one it permits.

`createTestInteractiveSession` moved here in ARCH-108 (issue #2113) for the same reason: it doubles
`IInteractiveSession`, which this package declares. It was the last thing holding
`agent-interface-transport` above layer 0 — a published `/testing` subpath is part of what a package
holds, which is the second of the two layer predictions that missed.

The runtime values are the vocabulary and discriminators the Interface Package Rule permits at the
entry. **Eight of them are why ARCH-106's split rule derives membership from declarations rather than
from the barrel's `export type` blocks** — a codemod reading only type exports left all eight behind.

## Interface Contracts

Moved here from `agent-interface-transport`'s SPEC by ARCH-108 (issue #2113): this package declares
these contracts, so it owns the prose that explains them.

The move was verbatim except for § _Interactive session persistence_, which gained TRANS-007's
four-outcome load vocabulary in the same change — the section described a port that had moved on
without it, which is the staleness this leaf exists to remove.

### Interaction channel scope

`IInteractionChannel` is the in-process port consumed by `createInteractiveRuntime`; today
`ProgrammaticInteractionChannel` is its production implementation. It is not the universal transport
contract. The TUI owns an `IInteractiveSession` and subscribes to its full event map directly, while
headless and remote transports use the session capability/configurable-transport families. A surface
must not nominally implement `IInteractionChannel` while making its central `write()` operation a no-op.

Prompt settlement belongs to the interactive-session event/capability family, not `InteractionEvent`:
surfaces receive `permission_request` / `ask_request`, answer through `resolvePermission` /
`resolveAsk`, and dismiss on the single canonical `prompt_resolved` event. The obsolete
`permission-resolved` interaction variant is not part of the contract.

Checkpoint surfaces consume `branch_event` after a transition is persisted. Its kinds cover checkpoint
creation, restoration, rollback, explicit branch fork, and branch switch. Resume-pointer hydration is
not an event. Shared keys and serializable payloads live here; subscription, rendering, delivery-failure
isolation, and fan-out policy remain owned by transport implementations.

### Interactive session persistence

`IInteractiveSessionRecord` is the complete resumable-record SSOT and
`IInteractiveSessionStore` is its canonical persistence port. The port owns CRUD only. It never exposes a
reusable absolute record path: transcript references belong to the logger/source owner and a trusted host hook
adapter may resolve one only at the hook execution boundary. A writer that updates only part of a loaded record
must preserve every field it does not own before overwriting its authoritative fields.

**`load` answers in a vocabulary, not with a value** (TRANS-007). It returns a `TSessionLoadOutcome`
reporting which of four things happened — `valid`, `missing`, `corrupt`, `unsupported` — declared in
`session-store-contracts.ts` beside the port, along with `ISessionRecordDecodeIssue` and
`ISessionListEntry`. The union exists because `record | undefined` collapsed "no such session" and
"the snapshot is unreadable" into one answer, and a caller cannot act on the difference it cannot see.

That narrows a property this section previously stated more broadly: the store is **not** payload-
agnostic. It decodes the `{ schemaVersion, record }` envelope and validates the record against its
contract, which is inspection. What it still does not do is read any field for its MEANING — no branch
on a `cwd`, a name, or a message body — so it holds no domain policy. "Checks the shape and nothing
else" is the narrower claim and the defensible one.

### Session role contracts and explicit capability presence (ARCH-012)

`IInteractiveSession`'s `isInitialized`, `getPendingCount` and `getActiveDriverId` were OPTIONAL. The
one consumer read attribution as `session.getActiveDriverId?.() ?? undefined`, and two unrelated
situations arrived as the same `undefined`:

- the host attributes turns and none is active right now, and
- the host cannot attribute turns at all.

The second loses every co-drive attribution with no error, no log and nothing to distinguish it from
the first. They are REQUIRED now: a host either provides the capability or does not claim this
contract, so `null` from `getActiveDriverId()` means exactly one thing.

The 39-member legacy interface remains an exported `interface` and extends 16 named role ports. Its
member shape and declaration-merging behavior are unchanged, so existing full implementations remain
source-compatible. `ISessionCapabilityHost` is the genuine interface that owns the canonical map;
`TSessionCapabilityHost` is the flattened selected-port intersection returned by the factory. New
consumers depend on only the roles they use. Optional capability hosts use one
typed `ISessionCapabilityMap`; `readSessionCapability(host, key)` returns `{ provided: false }` when a
role is absent and `{ provided: true, value }` when present. A present role may legitimately return
`null`, `undefined`, or an empty array from one of its methods; that result is not confused with an
absent role. Capability objects are local function-valued ports and are never serialized over a
transport protocol.

`SESSION_CAPABILITY_MEMBER_KEYS` is the runtime SSOT for flattening: its 16 rows are checked in exact
`keyof` parity with all 39 role members. `createSessionCapabilityHost` forwards only those canonical
members from own or prototype implementations, binds methods to their original receiver, treats an
explicit `undefined` role as absent in both runtime and type algebra, and rejects missing/duplicate or
reserved members. The flattened host has a null prototype and a final non-overridable canonical
`capabilities` property, so extra role properties cannot replace the map or trigger prototype setters.

**`createTestInteractiveSession` lives here, with the contract.** A double existed before, published
from `@robota-sdk/agent-framework` and documented in its SPEC — with zero consumers, because every
transport package sits BELOW `agent-framework` and could not import it. The hand-rolled
`as unknown as IInteractiveSession` partials were not an oversight; they were the only thing those
packages could reach.

**Two figures are on record for those partials, and they measure different things** — quote whichever
you mean, never one as the other:

| Figure             | What it measures                                                                                        |
| ------------------ | ------------------------------------------------------------------------------------------------------- |
| **37**             | The AST ratchet baseline ARCH-012's TC-04 actually drove to zero. This is the number that was MIGRATED. |
| 41 across 29 files | The corrected pre-work audit count, taken by hand before the ratchet existed.                           |

This SPEC previously carried the 41 alone. A package SPEC is a package-level SSOT, so a reader
comparing a later migration against ARCH-012 would have taken 41 as the number that was migrated; it
was not.

The sole published owner is `@robota-sdk/agent-interface-session/testing` — this package, since
ARCH-108 (issue #2113) moved the double to the package declaring the contract it doubles.
`agent-framework` intentionally does not re-export it, because pass-through re-exports would create
two apparent owners for one contract, and the same reasoning is why the transport subpath was removed
rather than left forwarding.

The default double preserves identity semantics rather than only type shape. Each factory instance has
one deterministic session id, and its successive default submissions return
`<session-id>-turn-1`, `<session-id>-turn-2`, and so on. Another double restarts its own counter under
its distinct session id. A custom `submit` override remains authoritative. The nested object returned
from default `getSession()` exposes only the transport contract's `getSessionId`; framework-only
`Session` services do not leak into this lower contract fixture.

`createTestSessionCapabilityHost` on the same testing subpath builds honest subset hosts. The
contract-cast scanner now freezes the direct `IInteractiveSession` cast floor at zero: a future
canonical aggregate cast fails the harness instead of restoring partial implementations.

### Turn identity

`submit()` returns an `ITurnHandle` — `{ turnId, completed }` — so an answer belongs to the caller
who asked for it.

Before RUNTIME-003 it returned nothing, and a caller that needed to know when ITS turn ended had
only the session-global `complete` / `interrupted` / `error` events. Those say that A turn ended and
never which one. A session runs one turn at a time and queues the rest, so two concurrent `submit`
calls did not run concurrently: the second waited and then took the RUNNING turn's response as its
own answer. Both callers were told about one turn; neither was told which.

**The id is minted when a submission is ACCEPTED**, and kept if it waits in the queue. One
submission is one identity from end to end.

**`completed` ALWAYS settles**, and that is the part the contract turns on. A queued submission is
not promised a turn — the co-drive queue coalesces a same-driver input into the one behind it, drops
at capacity, and discards everything when cleared. A handle that settled only for submissions that
RAN would leave the rest waiting forever, which is a worse failure than the ambiguity it replaces.
So each of those rejects with a typed `ITurnNotRunError` naming which happened:

| ------------------- | ------------------------------------------------------------------------ |
| `coalesced` | a later same-driver input replaced it in the queue (tail-coalesce) |
| `dropped` | the queue was at capacity when it arrived |
| `cancelled` | the queue was cleared before it ran — abort, cancel, or session shutdown |

There is deliberately no `shutdown` member: shutdown clears the queue through the same path as a
cancel, so it reports as `cancelled`. A reason no code path can emit is a reason a consumer would
write a dead branch for.

**A consumer narrows with `isTurnNotRunError`.** The error is declared here as a shape and
constructed in `@robota-sdk/agent-framework`, so an `instanceof` check is not available to a package
that only depends on this one — narrowing is on `name`, and this package exports the predicate that
does it rather than leaving every consumer to spell it. The distinction it draws is the one that
matters at a transport boundary: a refusal is an OUTCOME to report to the caller, while anything
else escaping `completed` is a failure inside the turn and must keep surfacing as one. The MCP
adapter reported both as a soft tool error for one review round, which hid real failures behind a
message that read like a queue decision.

**Migration.** A caller that ignores the return value is unaffected — `await session.submit(...)`
still means what it did, and the direct path still resolves only when the turn is over. An
IMPLEMENTOR of `IInteractiveSession` must return a handle; `createTestInteractiveSession` already
returns a conforming one, so a double built on it needs no change.

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

**Two tests were decided by the same rule reaching opposite conclusions at different times**, as
what each package held changed underneath it:

- `session-capability-contracts.test.ts` stayed in `agent-interface-transport` while the `/testing`
  doubles were there: moving it earlier would have made this package's suite depend on transport, an
  **upward** edge under ARCH-101. ARCH-108 moved the doubles here, which removed the reason, and the
  test moved with them. The rule did not change; what it was reasoning about did.
- `command-action-split-contracts.test.ts` moved _to_ this package. ARCH-104 kept it in transport
  because that was the side that could see both command and session; ARCH-106 moved session out, so
  this package became that side.

A test belongs where it can name both sides without creating an upward edge, and which package that is
changes as families move.

## Class Contract Registry

None. This package declares no class, and `scan-interface-runtime` refuses one.
