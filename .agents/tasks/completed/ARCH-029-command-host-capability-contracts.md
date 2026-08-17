---
title: 'ARCH-029: command-host consumers claim a 46-member optional facade instead of their declared capabilities'
status: done
completed: 2026-08-17
created: 2026-08-14
priority: high
urgency: soon
area: packages/agent-framework, packages/agent-command, packages/agent-command-workflows, packages/agent-cli, packages/agent-transport-tui
depends_on: [ARCH-012]
issue: https://github.com/woojubb/robota/issues/1722
---

# ARCH-029: decompose the command host into explicit capability contracts

## Problem

`ICommandHostContext` currently has 46 members, 32 of them optional, spanning preset mutation,
history, interaction, adapters, context references, skills, checkpoints, memory, background work,
goals, plans, agent jobs, and terminal handoff. A command needing one role must accept the entire
facade and tests construct partial objects through casts. Production also projects
`InteractiveSession` through `this as unknown as ICommandHostContext`.

The issue reproduces by type-checking a command with a minimal honest host: the command signature
requires unrelated methods, while optional methods cannot distinguish an absent capability from a
provided capability whose result is empty.

## Why this is foundational

The recurring cause is the framework-owned host contract, not any individual command. Fixing one
cast or making another method optional leaves every sibling command under the same pressure. This
item was split from ARCH-012 after an independent depth audit found two distinct owners and migration
graphs.

## Direction

- Define framework-owned named command-host **role ports**, with each aggregate becoming an empty
  `extends`. **No capability map or query** — the approved design supersedes that: the one member it
  would have served (`validateCurrentSessionReplayLog`) turned out to be an override hook with a
  framework-owned default, not a capability whose absence a command must handle.
- Make each command consume only its required roles and handle absence explicitly.
- Provide one production adapter from `InteractiveSession` and reusable exact-role test hosts.
- Remove the production self-cast and every direct `ICommandHostContext` partial cast; add a zero
  mechanical floor.
- Preserve provided-empty results as distinct from capability absence.

## Test Plan

- Type-level RED: a minimal workspace-only or preset-only host is assignable to the corresponding
  command role without a cast; current code must fail before the new surface exists.
- Runtime tests distinguish absent capability from provided `null`/`undefined`/empty-array results.
- Existing command suites migrate to exact capability fixtures and remain green.
- The contract-cast scanner covers `ICommandHostContext` at an exact zero baseline and mutation
  fixtures prove either canonical cast is rejected.
- A public command-path scenario exercises a capability-present and capability-absent path through
  the real framework adapter.

## User Execution Test Scenarios

Applies. Exact agent-executable commands, prerequisites, output, cleanup, and empty evidence fields
will be authored at this item's scenario-planning gate before implementation.

## Plan

Design document: [`.agents/spec-docs/active/ARCH-029-command-host-capability-roles.md`](../spec-docs/active/ARCH-029-command-host-capability-roles.md)
— ENDORSE'd after three review rounds; owner approved the full S1–S4 span on 2026-08-17 against the
corrected cost (128 declaration migrations, not the ~21 an earlier revision stated).

One task per Completion Criterion, grouped by seam. Each seam must be independently green.

**S1 — make conformance checked before anything is reshaped**

- [x] **TC-01** — `InteractiveSession implements ICommandHostContext`; replace
      `() => this as unknown as ICommandHostContext` with `() => this`. It type-checks today, so this is
      one line, and it must land first so every later reshaping is compiler-checked against the real host.

**S2 — the double, and every site the checker sees**

- [x] **TC-02** — `createTestCommandHost(overrides?: Partial<ICommandHostContext>)` in
      `agent-framework/src/testing/`, typed with **no cast**, exported through the existing `./testing`
      subpath. This is the forcing function ARCH-012 proved, not the runtime capability host.
- [x] **TC-03** — migrate the 21 cast sites **and every non-cast site the checker flags** (16 known
      today). The set comes from the `tsgo` error list of a scratch required-members branch, not from an
      enumeration — a contextually-typed literal breaks identically and appears in no list. Then ratchet
      `ICommandHostContext` and `IAgentJobHostContext` to **0** in `contractCastRatchet.contracts`.

**S3 — the decomposition, and the floor that proves it is real**

- [x] **TC-04** — decompose all three contracts into role ports; each aggregate becomes an empty
      `extends`. A command declaring one role must compile against `ISystemCommand`.
- [x] **TC-07** — an exact 79-member preservation inventory, in ARCH-012's table format. A
      presence/absence grep is not proof; the count comes from the checker.
- [x] **TC-05** — the aggregate-naming ratchet at **0**. Write the scan first, then take the baseline
      from the scan — the recorded 128 came from a narrower pattern than the criterion's definition.
      **Zero, not "falling":** a fall of one is what REFACTOR-006 shipped.

**S4 — required members, and the second paths they remove**

- [x] **TC-06** — role ports carry zero optional members, with a named carve-out and a stated reason for
      genuinely variational adapter bags.
- [x] **TC-08** — `validateCurrentSessionReplayLog` required; the host delegates to the same helper and
      the framework's fallback branch is deleted rather than left as a second path.
- [x] **TC-09** — every `?.() ?? default` site resolved individually; a surviving default must be one
      where the **value** can legitimately be empty. `scan-no-fallback.mjs` excludes `??`, so nothing has
      ever inspected these.

**Close-out**

- [x] Record DONE-GATE-STAGE-1 for the durable public command-path scenario. (Carried forward from the
      pre-design Plan — the rewrite dropped the checkbox, which would have left the obligation visible
      only in `## User Execution Test Scenarios` prose.)
- [x] **TC-10** — `pnpm harness:verify-like-ci` green.
- [x] Changesets: `agent-framework` **major**; `agent-command`, `agent-command-workflows`,
      `agent-transport-tui` patch.

## Blockers

- ARCH-012 session capabilities must land first so the framework adapter is not designed twice.

## Result

Delivered on `feat/arch-029-command-host-roles`. The three aggregates are empty `extends` over **26
role ports** (15 host, 6 session, 5 agent-job); all **79 members preserved** (46 + 18 + 15) with the
declaration kind unchanged, confirmed by an AST diff against the pre-change tree rather than a grep.
`ICommandHostContext` type-position references are at **0** across 2,882 tracked files, outside ten
allowlisted sites each named with a reason. **38 members went optional to required**, with one named
carve-out (`getCommandHostAdapters`, a genuinely variational adapter bag).

Two dead second paths were removed rather than left unreachable: `clearConversationHistory`'s
fallback, which reached past the host into `getSession().clearHistory()` and so did NOT broadcast
`history_cleared` — a fallback clear left other attached surfaces still showing the transcript — and
`validateCurrentSessionReplayLog`'s framework-computed default, which no production host implemented.

Two floors guard the result, both mutation-tested:
`scripts/harness/scan-role-port-optionals.mjs` (TC-06, plus TC-04 mechanised for the first time) and
`scripts/harness/scan-aggregate-naming.mjs` (TC-05, ratcheted at 0).

**Six review rounds** found 25 findings against those two floors, all applied. The arc is worth
recording because it is the item's most transferable output: rounds 4-6 were _the guard fails to
guard_ — a name the scan could not resolve was treated as absence, and absence read as a pass —
and rounds 7-9 were _the guard's exemptions are broader than their reasons_. Both classes are now
closed by a single rule each: names resolve through the DECLARING FILE and an unresolved one is a
finding; and every exemption is NAMED and EXPIRING, asserting the exact type it exempts, with
`rename-carve-out-unused` reporting one that stops matching. Two routes a name-only walk cannot close
(`ReturnType<typeof createTestCommandHost>`, and indexed access through a carved-out member) are
written into the scan header as stated limits rather than left implicit.

Three defects were found only by FALSIFYING a rule against a real evasion, never by reading it — each
a check that was shipped unable to fail: `questionToken` (never populated on a type member by the
native AST), `defaultType` vs `default` on a type parameter, and the TC-06 floor's original one-hop
scope. The first two are recorded as divergences #5 and #6 in `scripts/harness/lib/ts-ast.mjs`.
