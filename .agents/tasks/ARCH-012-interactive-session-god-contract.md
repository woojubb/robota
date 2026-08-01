---
title: 'ARCH-012: `IInteractiveSession` is a 40+-member god contract that nothing can implement, with 51 unchecked casts and no conformant test double'
status: todo
created: 2026-08-02
priority: high
urgency: soon
area: packages/agent-interface-transport, packages/agent-framework, packages/agent-transport, packages/agent-transport-ws, packages/agent-transport-http, packages/agent-transport-mcp, packages/agent-transport-tui, packages/agent-transport-protocol, packages/agent-transport-webrtc, packages/agent-cli
depends_on: []
---

# ARCH-012: one wide hand-mirrored interface stands in for a set of capability-scoped ports

## Problem

Nothing can implement `IInteractiveSession` honestly, so every consumer fabricates a private
approximation. There are **51 unchecked casts across 33 files in 8 packages**, each with its own
hand-rolled partial double, none checked against the real implementation — so the test suite proves
things about mocks that no shipped code guarantees.

It is also the de-facto transport contract, which makes it the edit-fan-out multiplier behind the
transport drift filed as ARCH-011.

The optional members are the sharp edge: a capability that is not implemented is indistinguishable
from a capability that is implemented and returned nothing — with no error, no log, and no way to
tell the two apart.

## Evidence

Observed independently by **L0 (foundation, as a contract-quality and testability defect)** and
**L3 (transport, as the seam that makes transport parity impossible)**.

- L0 F7 — `packages/agent-interface-transport/src/session-contracts.ts:337-440`: one interface
  carrying submission, abort, queue control, shutdown, autonomous-goal lifecycle, execution state,
  message/context/cwd accessors, command execution and listing, event subscription, prompt resolution,
  background tasks (7 methods), job groups (4), workspace snapshots and agent jobs (5) — nine
  unrelated responsibilities. `rg "as unknown as IInteractiveSession|as IInteractiveSession"` returns
  **51 matches across 20+ test files in 8 packages** (`agent-transport`, `-ws`, `-http`, `-mcp`,
  `-tui`, `-protocol`, `-webrtc`, `agent-framework`, `agent-cli`), each with its own hand-rolled
  partial double (`createMockSession`, `createFakeSession`, `createStubSession`,
  `createEventDrivenMockSession`), none checked against the real implementation.
- L3 F3 — same interface at `:338-440`; adds the _optional-member_ consequence L0 only names:
  `isInitialized?` (`:337`), `getPendingCount?` (`:366`), `getActiveDriverId?` (`:368`), and the seam
  where it bites — `agent-transport-protocol/src/ws-session-events.ts:48`
  `session.getActiveDriverId?.() ?? undefined`, which silently loses **all** co-drive attribution with
  no error, no log, and no way to distinguish "no active driver" from "capability not implemented".
- L3 F3 also names the parallel defect in the command axis:
  `packages/agent-framework/src/command-api/host-context.ts:126-225` — `ICommandHostContext`, ~50
  members of which ~30 are optional, importing from eight framework subsystems (`:1-44`), so the
  "command contract" transitively couples every command to every subsystem.

The synthesis re-verified, read-only: the cast count is **exactly 51, across 33 files** (L0 said "51
matches across 20+ test files in 8 packages" — the match count is exact, the file count is higher
than L0's floor).

**One note where the code and the finding need care.** The synthesis states the
`getActiveDriverId?.()` seam _"silently loses all co-drive attribution"_. Reading the repo while
writing this Task: the shipped concrete session does implement it
(`packages/agent-framework/src/interactive/interactive-session.ts:529`, wired at `:175`), so today
the optional call resolves and no attribution is lost through the shipped path. The defect the
synthesis describes is therefore **latent for the shipped implementation and live for any other**:
the contract cannot distinguish "not implemented" from "no active driver", so any second
implementation — which is precisely what the 51 casts are — loses it with no signal. Both statements
are recorded here rather than either being silently corrected.

The cause in one sentence, from the synthesis: _one wide hand-mirrored interface stands in for a set
of capability-scoped ports, so nothing can implement it honestly and every consumer fabricates a
private approximation._

## Why this is foundational (or not)

**FOUNDATIONAL — both reports agree.** Blast radius is 8+ packages and 33 test files. The synthesis
ranks it HIGH and notes it is the root L3 names for ARCH-011, which is why ARCH-011 depends on this
one and the two should be sequenced together.

## Direction

The invariant the synthesis states for this class (theme T7): _an interface a host either implements
fully or does not claim; **optional members are a capability question and must be asked
explicitly**._ It lists under the same theme `ICommandHostContext` (~50 members / ~30 optional,
importing from eight subsystems), and — under theme T8 — the absence of a **published conformant test
double**: `IInteractiveSession` has 20+ private hand-rolled doubles and no published conformant one.

So the direction the synthesis contains:

1. Replace the one wide hand-mirrored interface with **capability-scoped ports**, so a host declares
   the capabilities it has rather than implementing 40+ members partially.
2. Make optionality an explicit capability query rather than `?.()` with a `?? undefined` fallback
   (`ws-session-events.ts:48` is the named instance).
3. Publish a **conformant test double**, so the 51 private approximations can be deleted rather than
   maintained.
4. `ICommandHostContext` (`host-context.ts:126-225`, imports at `:1-44`) is the same defect on the
   command axis and is named alongside it.

Risk named by the synthesis: the private doubles are _unchecked against the real implementation_, so
the existing tests cannot be trusted as a safety net for this refactor — replacing the doubles is
part of the work, not a consequence of it.

## Test Plan

- **Required red-first regression:** a conformance test that asserts the shipped `InteractiveSession`
  and the published test double both satisfy the same capability ports, and that a host implementing
  only a declared subset is accepted **without a cast**. Against current code this must FAIL — there
  is no published double, and every consumer reaches the contract through
  `as unknown as IInteractiveSession`.
- A mechanical floor: `rg "as unknown as IInteractiveSession|as IInteractiveSession"` must return
  **0** matches in the repo (it returns 51 across 33 files today). Wire it as a scan so the count
  cannot regress.
- Red-first for the optional-member seam: assert a host that does _not_ provide driver attribution is
  distinguishable from one that provides it and has no active driver
  (`ws-session-events.ts:48`, `session-contracts.ts:368`).
- Same treatment asserted for `ICommandHostContext`'s ~30 optional members
  (`host-context.ts:126-225`).
- `pnpm typecheck`, `pnpm harness:verify-like-ci` green.

## User Execution Test Scenarios

**Applies — via the public SDK surface.** The synthesis's central claim is that this contract cannot
be implemented; the scenario is an SDK consumer implementing it, which is a supported public usage of
the published packages. (The internal refactor and the cast count belong to `## Test Plan`.)

- **Prerequisites:** built workspace and a scratch consumer project depending on the published
  `@robota-sdk/agent-interface-transport`. This example project does not exist today and **will be
  built by this work**.
- **Steps:**
  1. In the scratch project, implement a session host against the published capability ports,
     declaring only the capabilities it actually supports (e.g. submission and events, but no
     background tasks and no driver attribution).
  2. Attach a shipped transport to it and submit a prompt.
  3. From the transport side, query a capability the host did **not** declare.
- **Expected observable result (after the fix):** step 1 type-checks with **no** `as unknown as`
  cast; step 2 delivers the prompt result; step 3 reports "capability not provided" distinctly from
  "provided, empty result".
- **Expected observable result (before the fix, for contrast):** step 1 requires a cast over a
  40+-member interface, and step 3 returns `undefined` indistinguishable from an empty result.
- **Cleanup:** delete the scratch project.
- **Evidence (fill in after implementation):** the consumer's source (showing no casts), the
  typecheck output, and the console output for steps 2 and 3.
