---
title: 'ARCH-012: the 39-member session aggregate still forces 37 unchecked partial casts'
status: done
created: 2026-08-02
completed: 2026-08-14
priority: high
urgency: soon
area: packages/agent-interface-transport, packages/agent-framework, packages/agent-transport, packages/agent-transport-ws, packages/agent-transport-http, packages/agent-transport-mcp, packages/agent-transport-tui, packages/agent-transport-protocol, packages/agent-transport-webrtc, packages/agent-cli
depends_on: [ARCH-019]
---

# ARCH-012: decompose the remaining session aggregate into capability-scoped ports

## Current Problem

P1 corrected the original audit premise: `IInteractiveSession` now has 39 required members and zero
optional members; the shipped `InteractiveSession` and the reachable
`@robota-sdk/agent-interface-transport/testing` double both conform; and the AST ratchet records 37
direct casts rather than the false-positive 51/33 count. The attribution ambiguity named by the
original report is fixed.

The remaining problem is the aggregate itself. Submission, lifecycle, goal, state, commands, events,
prompt resolution, background work, workspace, and agent jobs remain one structural contract. A
consumer needing a subset must still claim every member or cast a partial. This Task now owns only
the session-contract axis. The parallel command-host defect has a different owner and migration graph
and is filed separately as ARCH-029.

## Historical Problem (superseded by P1 measurements)

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

- L0 F7 — `packages/agent-interface-session/src/session-contracts.ts:337-440`: one interface
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

- **Required red-first regression:** the current published testing double and shipped
  `InteractiveSession` structurally satisfy the same 16 named role ports, while a public
  `createSessionCapabilityHost` accepts only submission/events without a cast. Current code fails
  because those role exports and factory do not exist; the full double itself already exists and is
  conformant.
- A mechanical floor: the AST-owned `scan-contract-cast-ratchet.mjs` must lower the current exact
  `IInteractiveSession` count from 37 across 25 files to 0 and reject a reintroduced canonical cast.
- Red-first capability query: absent driver attribution returns `{ provided: false }`, while a
  provided `ISessionDriverAttribution` whose `getActiveDriverId()` returns `null` returns
  `{ provided: true, value }`.
- Public compatibility: each migrated transport factory retains the existing full
  `IInteractiveSession` attach signature and adds its named subset-host overload; old full custom
  sessions and new honest subsets both compile.
- Public SDK scenario: a cast-free host containing the seven HTTP role keys attaches through public
  `createHttpTransport({ admission: { open: true, openReason: 'ARCH-012 local capability scenario' } })`,
  POSTs `/submit`, observes `ARCH012_OK`, and
  prints `NOT_PROVIDED` versus `PROVIDED_EMPTY` from two explicit capability queries.
- Affected package builds/tests/typechecks, SSOT scan, harness scan/conformance, and
  `pnpm harness:verify-like-ci` green.

## User Execution Test Scenarios

**Applies — via the built public SDK and HTTP transport.** The durable agent-executable scenario lives
at [`arch-012-session-capabilities-agent-run.md`](../../evals/scenarios/arch-012-session-capabilities-agent-run.md).

- Prerequisites: built interface-transport and HTTP transport packages, Node.js 22+, pnpm,
  TypeScript, Bash, `timeout`, `mktemp`, and symlink permission; no credential, provider, or network
  service.
- Steps: compile a cast-free isolated consumer; create a host containing exactly the seven HTTP role
  keys; attach it through public `createHttpTransport` with explicit local-open admission; POST
  `/submit` through `getApp().request()`; inspect the SSE result; query absent driver attribution;
  then query a provided driver-attribution capability returning `null`.
- Expected: the consumer prints exactly `ARCH012_OK`, `NOT_PROVIDED`, and `PROVIDED_EMPTY`; Bash then
  prints the separate `CLEANUP_OK` marker and exits `0`.
- Cleanup: the validated `robota-arch012.*` temporary consumer is removed and its absence asserted.
- Evidence: the linked durable scenario records the independently verified exit-0 run, exact
  `ARCH012_OK` / `NOT_PROVIDED` / `PROVIDED_EMPTY` output, `CLEANUP_OK`, and absence of residual temp
  directories.

### [DONE-GATE-STAGE-1] — ✅ PASS | 2026-08-14

**Status upgrade:** scenario drafted → scenario written
The durable `ARCH-012 — cast-free public session capability host over HTTP` scenario is fully written,
explicitly agent-executable, credential-free, and bounded. Its exact Bash block builds the two public
packages, compiles a no-type-assertion external-style consumer, attaches the exact seven-role host
through public HTTP, checks the SSE result and absent/provided-empty capability queries, validates the
three consumer lines plus separate Bash cleanup marker, and safely removes its basename-validated temp
tree. The approved API surface is deliberately supplied by this work and the evidence field remains
`EMPTY` until independent Stage 2 execution.

### [DONE-GATE-STAGE-2] — ✅ PASS | 2026-08-14

**Status upgrade:** scenario written → scenario verified
The agent independently executed the durable scenario's complete Bash block against the current
ARCH-012 implementation. The isolated consumer compiled against the built public package exports,
attached the exact seven-role capability host through public `createHttpTransport`, submitted through
the public HTTP surface, and exited `0` after printing exactly `ARCH012_OK`, `NOT_PROVIDED`, and
`PROVIDED_EMPTY`. Bash then printed `CLEANUP_OK`; a fresh post-run probe found no
`robota-arch012.*` temporary directory. The durable scenario's observed-evidence section records the
same result, and package build output is treated only as setup rather than user-execution evidence.

## Progress

### P1 — the optionality is gone, the double is reachable, and the count is frozen

**Three corrections to this Task's own evidence, made by measuring rather than repeating.** They
change what the work is, so they are recorded before the progress.

1. **A published conformant double already existed.** The Task says _"there is no published double"_.
   `createTestInteractiveSession` has been exported from `@robota-sdk/agent-framework`'s testing entry
   and documented in its SPEC.
2. **It had zero consumers — and the reason is the dependency direction.** Every transport package
   sits BELOW `agent-framework`, so none of them could import it. The hand-rolled partials were not an
   oversight; they were the only thing those packages could reach. That reframes direction item 3
   entirely: the double did not need building, it needed MOVING.
3. **The cast count was over-reported.** The audit's `rg 'as IInteractiveSession'` also matched
   `as IInteractiveSessionEvents[...]` and `as IInteractiveSessionStandardOptions` — 11 lines that are
   casts to different types. The figure for the contract itself was **41 across 29 files**, not 51/33.

**The optionality is removed.** `isInitialized`, `getPendingCount` and `getActiveDriverId` are
REQUIRED. That was the sharp edge the Problem statement names: `session.getActiveDriverId?.() ??
undefined` returned the same `undefined` for "no driver is active" and "this host cannot attribute
turns at all", losing every attribution silently. `null` now means one thing. The seam at
`ws-session-events.ts:48` is a plain call.

Red-proved at the TYPE level, which is where it lives: an `@ts-expect-error` on a host that omits
exactly those three members. The first draft of that test was an accidental green — the object it
used was missing forty other required members too, so the directive was satisfied by the wrong error.
It uses `Omit<IInteractiveSession, ...>` now, which differs in the three and nothing else.

**The double moved to `@robota-sdk/agent-interface-transport/testing`** — the SUBPATH, not the main
entry. The first draft put it on the main entry and review measured it in the shipped
`dist/node/index.js`: a test fixture in a published runtime bundle, against an explicit rule with an
existing precedent (`agent-core/testing`). It is NOT re-exported from `agent-framework`: pass-through
re-exports of another package's symbols are banned (STRUCT-07), and the old export had zero importers.

**Five hand-rolled partials replaced** with it, across `agent-transport-protocol`,
`agent-transport-ws` and `agent-transport-webrtc`. Each had been accepted only by a cast: making the
three members required broke them at RUNTIME, which is the finding demonstrated — the casts were
hiding missing members, and those suites were proving things about session shapes no implementation
could have.

**The count is now a ratchet.** `scan-contract-cast-ratchet.mjs`, registered in `run-all-scans`,
config-driven (`.agents/harness.config.json` → `contractCastRatchet`) so it is neutral. It may fall
and never rise. It caught its own author twice: once when the replacement introduced
`as IInteractiveSession['on']` member-type casts, and once when the count did not fall after two
removals because the comments explaining the removals quoted the pattern. Both are fixed and pinned
by cases — the scan counts CODE, not prose, and not member types.

### Remaining

- **Capability-scoped ports** (direction item 1) — the 40+-member interface is still one interface.
  This is the large refactor and it now has a safety net it did not have: a conformant double the
  affected packages can actually reach.
- **`ICommandHostContext`** (direction item 4, ~50 members / ~30 optional) — untouched.
- **The remaining 37 casts.** The ratchet stops them growing; deleting them is the port work above.
- **User Execution Test Scenarios** — the scratch consumer project that implements the contract
  without a cast. It depends on the capability ports, so it closes with that work.

### Review round — five findings, two of them MUST

- **The double landed on the published main entry.** Measured in `dist/node/index.js`. Moved behind a
  `./testing` subpath with its own build entry, matching `@robota-sdk/agent-core/testing`.
- **No changeset** for three members going optional → required on a published interface, plus a moved
  export, across two non-private packages. Added, with the migration for both.
- **The `agent-framework` re-export was a banned pass-through** (STRUCT-07) with zero importers.
  Deleted, and the removal explained where the file used to be.
- **The ratchet's own counter mis-parsed.** Its hand-rolled comment/string blanker under-counted on a
  string ending in a backslash, an apostrophe inside a regex, and a cast inside a template
  substitution — the worse direction, since the scan treats a FALL as something to re-freeze, so a
  wrong low number gets frozen and the ratchet goes blind by that many casts. It parses with the
  TypeScript AST now; `as IFoo['bar']` and `as IFooEvents` are excluded by the shape of the tree
  rather than by a lookahead. Reproduces 37 exactly, which the reviewer's independent AST walk agrees
  with (35 plain + 2 intersection).
- **The scan's docstring asserted the 51/33 numbers this change disproves** — the explanation an agent
  reads when the ratchet fires. Corrected to the measured figures.

Also taken: five further doubles that flow into `subscribeSessionEvents` and would have thrown on the
first attributed event, a now-unreachable `getPendingCount?.() ?? …` fallback in `useTuiChannel`, the
`agent-framework` SPEC's stale description, and the config block's missing `$comment`.

## Plan

- [x] TC-01: add red-first role-map/query types and prove cast-free subset plus absent/provided-empty
      discrimination.
- [x] TC-02: preserve the legacy interface declaration kind and prove complete production/full-double
      plus exact subset-host conformance.
- [x] TC-03: migrate every session consumer to named role requirements while retaining public legacy
      attach compatibility.
- [x] TC-04: lower the AST-owned direct `IInteractiveSession` cast floor from 37 to zero and add the
      reintroduction regression.
- [x] TC-05: author, Stage-1 gate, execute, and Stage-2 gate the exact public HTTP SDK scenario.
- [x] TC-06: synchronize owner SPECs/changesets and pass targeted, conformance, scan, and CI-equivalent
      verification before completion/archive.

## Blockers

- None. ARCH-019 is completed and archived; ARCH-011 and ARCH-029 remain downstream.

### Final implementation verification — 2026-08-14

- Independent Round-A review converged at `ACTIONABLE FINDINGS: 0` after the capability host's
  immutable snapshot, runtime-frozen 16-role/39-member registry, class/prototype and accessor-backed
  forwarding, undefined/non-enumerable role handling, legacy transport declarations, and scenario
  evidence were re-audited.
- `pnpm --filter @robota-sdk/agent-interface-transport test` passed 8 files / 39 tests; package
  typecheck passed.
- `node scripts/harness/scan-contract-cast-ratchet.mjs` passed with zero direct
  `IInteractiveSession` casts across 2,793 production/test TypeScript files; its 14-test regression
  suite passed.
- `pnpm harness:conformance`, the SSOT declaration scan, and `pnpm harness:scan` passed (109 scans,
  1 intentional skip).
- `pnpm harness:verify-like-ci` passed all 12 mirrored stages in 6m54.9s, including full build,
  typecheck, affected verification, binary E2E, examples typecheck, and TUI PTY E2E.
- The durable public HTTP SDK scenario was rerun after the final forwarding changes and exited 0 with
  `ARCH012_OK`, `NOT_PROVIDED`, `PROVIDED_EMPTY`, and the separate `CLEANUP_OK` marker.

## Result

Completed. The 39-member legacy interface remains source-compatible while 16 reachable role
contracts and an honest capability host let consumers declare only what they use. All 37 direct
aggregate casts were removed and the AST ratchet is fixed at zero. Public transport declarations
retain the legacy full-session contract and add named subset support. The final public HTTP SDK
scenario, focused tests/typechecks, conformance and scans, and all 12 CI-equivalent stages passed.
