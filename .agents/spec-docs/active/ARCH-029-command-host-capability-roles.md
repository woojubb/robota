---
status: in-progress
type: API
tags: [typescript, contracts, command-host, test-doubles]
---

# ARCH-029: the command host is one 46-member facade that every command must name

Design for Task [`.agents/tasks/ARCH-029-command-host-capability-contracts.md`](../../tasks/ARCH-029-command-host-capability-contracts.md)
(issue [#1722](https://github.com/woojubb/robota/issues/1722)).

> **Depth verdict: LOCAL.** A `finding-depth-triager` pass established that the defect is
> `ICommandHostContext` itself, that ARCH-012 already landed the mechanism, and that nothing
> underneath must change first. All measurements below were taken with the TypeScript checker and the
> repo's own AST scanner, not grep.

## Problem

`packages/agent-framework/src/command-api/host-context.ts` declares `ICommandHostContext` with
**46 members, 32 of them optional**. A command needing one role must name the whole facade, and test
fixtures reach it through casts.

The reachable surface is larger than the item states. Two sibling contracts hang off it:

| Contract                 | Members | Optional | Reached through                     |
| ------------------------ | ------- | -------- | ----------------------------------- |
| `ICommandHostContext`    | 46      | 32       | the command signature itself        |
| `ICommandSessionRuntime` | 18      | 7        | **required** `getSession()`         |
| `IAgentJobHostContext`   | 15      | 0        | optional `getAgentJobCapability?()` |
| **total**                | **79**  | **39**   |                                     |

**The optionality models no real host variation.** 31 of the 32 optional members on
`ICommandHostContext`, and all 7 on `ICommandSessionRuntime`, are implemented by the sole production
host. Only `validateCurrentSessionReplayLog` is genuinely absent — and it is not a capability
(see the Decision). A strict-mode probe shows `InteractiveSession` is assignable to
`ICommandHostContext` **with no cast at all**, yet the class declares
`implements ISession, IAgentJobHostContext, IInteractiveSession` — conspicuously not the command host.
So the production cast at `interactive-session.ts:221` asserts a conformance nothing checks.

**Casts: 18 across 17 files** for `ICommandHostContext` (1 production, 17 test), plus **4** for
`IAgentJobHostContext`, counted with `countContractCasts` from `scan-contract-cast-ratchet.mjs`.

**The optionality and the casts sustain each other.** A required member would not break a cast — a
cast is immune to optionality — but the absence of a reachable honest double is why 17 fixtures are
hand-rolled, and the optionality is what lets the facade keep growing without any consumer paying.

### This finding already shipped once, and the fix held nothing

`.agents/tasks/completed/REFACTOR-006-icommand-host-context-capability-split.md` raised this exact
defect on this exact file and proposed this exact direction — its scope item 4 reads
`각 command module이 필요한 capability interface만 선언.` ("each command module declares only the
capability interfaces it needs"; the original is Korean, so this is a translation, not a quotation). What shipped was **one optional getter, closed in one day,
with no mechanical floor**.

| date                            | members | optional | % optional |
| ------------------------------- | ------- | -------- | ---------- |
| 2026-05-15 (REFACTOR-006 filed) | 20      | 10       | 50%        |
| 2026-05-16 (closed)             | 29      | 15       | 52%        |
| 2026-07-01                      | 38      | 24       | 63%        |
| today                           | 46      | 32       | **70%**    |

`git log -S` puts the production `as unknown as ICommandHostContext` at commit `f007461fe`,
**2026-05-17 — the day after REFACTOR-006 closed on removing a cast.**

That trajectory is what this design must hold, and it is why the floor matters more than the
decomposition: every criterion in the previous attempt could be ticked while the facade survived.

## Prior Art Research

Waived: the decisive prior art is **in this repository and one layer over** — ARCH-012 solved the
identical problem on the session axis three weeks ago, and its landed artifacts (an empty `extends`
aggregate over 16 role ports, a conformant `testing/` double, a cast ratchet held at 0) are directly
inspectable. External product documentation cannot tell us more about robota's own command host than
the controlled experiment already run inside it. The alternatives below are drawn from ARCH-012's own
Alternatives section, which litigated the same choices with the same constraints.

## Decision

**Mirror ARCH-012's landed pattern on the command axis. Build no capability map.**

### 1. Role ports with an empty `extends` aggregate

Decompose all three contracts into named role ports in `agent-framework` (the owner —
`.agents/project-structure.md:315` names `ICommandHostContext` as framework-owned). The aggregate
becomes an empty `extends`, exactly as `IInteractiveSession` is at
`packages/agent-interface-transport/src/session-contracts.ts:349`.

A command may declare a **narrower** parameter and still satisfy
`ISystemCommand.execute(context: ICommandHostContext, args)`. This is sound **contravariance**, not
method bivariance: a role port is a _supertype_ of the aggregate, so narrowing the declared role is the
type-correct direction. Verified by probe under the real strict config for **both** the method-shorthand
and function-property declaration forms — so the mechanism does not depend on `ISystemCommand.execute`
staying a method shorthand, and role narrowing needs no change to the dispatch contract.

### 2. A conformant double in `agent-framework/testing` — NOT a runtime capability host

`packages/agent-framework/package.json` **already exports `./testing`**, and all four cast-holding
packages already depend on `agent-framework` at runtime. So the double is reachable from every cast
site today.

**Rejected: generalizing `packages/agent-interface-transport/src/session-capability-host.ts`.** An
earlier revision of this recommendation proposed it. It is wrong on three counts:

- **It has zero consumers.** Its only callers anywhere are its own unit test and a published-SDK
  scenario. Generalizing an unexercised mechanism is not cheaper than not needing one.
- **It solves a problem the command axis does not have.** ARCH-012's own diagnosis
  (`.agents/tasks/completed/ARCH-012-interactive-session-god-contract.md:187`) records why its 37
  casts existed: the double lived in `agent-framework`, and _"every transport package sits BELOW
  `agent-framework`, so none of them could import it"_. The forcing function was reachability, not
  descriptor forwarding. On the command axis reachability already holds.
- **It deepens a rule conflict a scanner cannot see.** `.agents/project-structure.md:308` — an
  `agent-interface-*` package "must not contain classes or runtime logic". `scan-interface-runtime.mjs`
  bans `class`/`enum` and bare value imports, so a factory function passes the check while sitting
  outside the stated rule. Widening that is an amendment argument, not an exemption.

### 3. `validateCurrentSessionReplayLog` is an override hook, not a capability

`packages/agent-framework/src/command-api/session/session-command-api.ts:63-77` shows the framework
**computes the same report itself** when the host does not provide it. It is an override with a
framework-owned default, implemented by nobody. Resolution: **make it required and have the host
delegate to the same helper**, so there is one path (No-Fallback) and one owner.

With that settled, **the command axis needs no capability map or query** — the item's Plan line
"author and independently approve the DATA spec for the framework-owned capability map" is replaced by
role ports.

### 4. Conformance becomes checked, not asserted

`InteractiveSession implements ICommandHostContext`, and `() => this as unknown as ICommandHostContext`
becomes `() => this`. It type-checks today, so this is one line — and it must land **first**, so every
subsequent reshaping is compiler-checked against the real host.

### 5. Members become required — after the casts are gone, not before

Required-ness does not force fixture migration; casts are immune to optionality. The forcing chain is:
double → migrate casts → ratchet → **then** required. At that point the double and the production host
are the only things checked against the contract — **plus every non-cast site the checker sees**, which
the cast ratchet cannot. Measured today: **16** — 5 variable annotations
(`mode-command-module.test.ts:149,166`, `language-command-module.test.ts:25,110`,
`preset-application.test.ts:86`) and 11 cast-free factory returns annotated `ICommandHostContext` over a
bare object literal (the background, compact, context, help ×2, mode, permissions, plugin, preset and
session command-module tests, plus `command-api.test.ts:117`).

**An earlier revision said "five", and the hand list was the wrong instrument, not merely the wrong
count.** A contextually-typed object literal passed straight to a parameter typed `ICommandHostContext`
breaks identically and appears in no enumeration. So the set is obtained **mechanically**: make the
members required in a scratch branch and take the resulting `tsgo` error set. That is this document's
own stated standard — the checker and the repo's AST scanner, not grep.

All of them migrate in **S2 with the cast sites**, not in S4. That is the sequencing decision §5 exists
to make: otherwise S4 breaks the build for a reason S4 did not create, and `## Sequencing`'s promise
that each seam is independently green becomes false. With them gone, required-ness is behaviourally a
no-op and permanently a floor.

The ~20 `context.foo?.() ?? default` call sites are deleted as a consequence, each reviewed
individually for whether the **value** can legitimately be empty. `scan-no-fallback.mjs` deliberately
excludes `??`, so review is the only thing that has ever seen these.

### 6. The floor that measures what actually grew

An optional-member ceiling would **not** have caught 10 → 32, and the workaround is already in this
file: `getAgentJobCapability?()` adds 15 members to the reachable surface while contributing 1 to any
aggregate optional count, and `getSession()` adds 18 while contributing 0 — it is required.

Three ratchets, all at **zero**, in priority order:

1. **Aggregate-naming ratchet** — declarations naming `ICommandHostContext` in a type position outside
   a named allowlist (`ISystemCommand.execute`, the production host, the double). This is the direct
   mechanization of "each command consumes only the roles it needs", and **the decomposition is not
   real until this falls**: every other criterion can pass while every command still names 46 members.
2. **Zero-optional ban on the command role ports**, with an explicit carve-out (and a stated reason)
   for genuinely variational adapter bags such as `ICommandHostAdapters`.
3. **Cast ratchet at 0** for `ICommandHostContext` **and** `IAgentJobHostContext` — today
   `.agents/harness.config.json`'s `contractCastRatchet.contracts` lists only `["IInteractiveSession"]`.

## Alternatives Considered

### Alternative 1 — one more optional getter (what REFACTOR-006 shipped)

- **Pro** — smallest possible change; no migration.
- **Con** — **measured to fail.** It is what shipped in 2026-05, and the contract went 20/50% → 46/70%
  with a production cast added the next day. The bill has been paid four times.

### Alternative 2 — role ports + conformant double + three zero-ratchets (**chosen**)

- **Pro** — mirrors the analog that worked one layer over, on the same repo, with the same
  constraints; converts member-presence variation into value-level variation the compiler can check;
  the aggregate-naming ratchet measures the quantity that actually regressed.
- **Con — the dominant cost is signature migration, and an earlier revision understated it ~6×.**
  Measured: **128 type-position declarations** naming `ICommandHostContext` — 82 in `agent-command`,
  45 in `agent-framework`, 1 in `agent-command-workflows` — all of which must narrow to role ports for
  TC-05 to reach 0. On top of that: 22 cast sites (21 migrating), ~20 call-site behaviour reviews,
  three contracts reshaped, a new test surface, two new scans, changesets on four published packages.
  **Not "comparable to ARCH-012"** — side by side, ARCH-012 was **37** casts over 39 members (its own
  measurement at lines 16/140/243, and the figure §2 of this document already uses); this is 22 casts
  over **79** members **plus 128 declaration rewrites**.

### Alternative 3 — generalize the existing runtime capability host

- **Pro** — the `{provided:false} | {provided:true,value}` semantics already exist and match the
  item's "provided-empty is distinct from absent" requirement.
- **Con** — zero consumers, so the generic form is unexercised; the command axis has one host, so
  production constructs nothing; and it deepens the interface-package runtime-logic conflict. Rejected
  in the Decision.

### Architecture Review Checklist

- [x] Affected package/layer list complete — `agent-framework` (contracts, production host, new
      `testing/` double), `agent-command`, `agent-command-workflows`, `agent-transport-tui` (one cast and one `Pick<>`; no bare
      `: ICommandHostContext` declaration), plus `.agents/harness.config.json` and two new scans.
- [x] Sibling scan complete — **ARCH-012** (`packages/agent-interface-transport/src/session-contracts.ts:349` + its `testing/` double + the cast ratchet) is the analog, on the same problem one layer over,
      and its Alternatives section already rejected the optional-members option this design also
      rejects. Also inspected: `session-capability-host.ts` (rejected as a mechanism, with reasons)
      and `agent-core/testing`'s scripted provider as the `testing/`-subpath precedent.
- [x] At least 2 alternatives reviewed — three, above, with pro/con for each.
- [x] Decision rationale documented — the deciding trade-off is **which quantity the floor measures**;
      see §6 and the REFACTOR-006 trajectory.

**New-surface placement.** No new package, app, or presentation surface. One new **module** in an
existing exported subpath: `packages/agent-framework/src/testing/createTestCommandHost`. (a) The
analogous existing layer is `agent-interface-transport/testing`'s `createTestInteractiveSession`
(ARCH-012) and `agent-core/testing`'s scripted provider — product-family classification: _neutral
library, test-support subpath_. (b) Reuse is at the contract level: consumers depend on
`agent-framework`, which they already do; no dependency on a sibling product; no new edge.

## Completion Criteria

- [x] TC-01: `InteractiveSession` declares `implements ICommandHostContext` and the production
      `as unknown as` cast is gone — conformance is compiler-checked.
- [x] TC-02: `createTestCommandHost(overrides?: Partial<ICommandHostContext>)` exists in
      `agent-framework/testing`, is typed with **no cast**, and a fixture using it type-checks.
- [x] TC-03: all **22** cast sites are accounted for — `ICommandHostContext` 18 + `IAgentJobHostContext` 4. One (the production cast) is removed by TC-01, so **21 test sites migrate** to the double or to
      exact-role hosts; both contracts are then ratcheted at **0**.
- [x] TC-04: the three contracts are decomposed into role ports; each aggregate is an empty `extends`;
      a command declaring only a narrow role compiles against `ISystemCommand`.
- [x] TC-05: declarations naming `ICommandHostContext` in a type position outside the named allowlist
      (`ISystemCommand.execute`, the production host, the double) are at **0**. Today's measured count
      is **128** — 82 in `agent-command`, 45 in `agent-framework`, 1 in `agent-command-workflows`.
      **Zero, not "frozen and falling."** An earlier revision of this criterion said "falling", which
      would close this design green with 127 of 128 declarations still naming the 46-member facade —
      which is exactly what REFACTOR-006 shipped. The one criterion written to prevent the repeat must
      not permit it. If zero cannot land inside S3, split it (TC-05a freezes at 128 in S3, TC-05b
      reaches 0 in a named seam with every residual site enumerated and justified) — but do not close
      on a fall of one.
      **Baseline caveat:** 128 was measured with the `: ICommandHostContext` pattern, while the
      criterion's "type position" is broader — it also covers `Partial<>`, `Pick<>`, indexed-access
      (`ICommandHostContext['getContextState']`) and function-return (`() => ICommandHostContext`)
      forms, roughly 6 more. The target of **0** subsumes them, so the target is unaffected; the scan's
      definition and the recorded baseline must be the same quantity when it is written.
- [x] TC-06: the role ports carry **zero** optional members, with a named carve-out and a stated
      reason for genuinely variational adapter bags.
- [x] TC-07: all 79 members are preserved — an exact inventory, in ARCH-012's 39-member table format.
- [x] TC-08: `validateCurrentSessionReplayLog` is required and the production host delegates to the
      **same helper** the framework used as its default — one computed path, one owner, and the
      framework's fallback branch is deleted rather than left as a second path.
- [x] TC-09: every `context.foo?.() ?? default` site in `agent-command` and
      `agent-framework/command-api` is resolved individually, and each surviving default is one where
      the **value** can legitimately be empty — not where the member could be absent. This is the
      design's one behaviour-changing surface and where "provided-empty is distinct from absent" is
      actually decided; `scan-no-fallback.mjs` excludes `??`, so nothing has ever inspected them.
- [ ] TC-10: `pnpm harness:verify-like-ci` green.

## Test Plan

| TC-ID | Test Type     | Tool / Approach                                                                                                                              | Notes                                                                                                                |
| ----- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| TC-01 | Type          | `tsgo --noEmit`; delete the `implements` clause to prove it fails                                                                            | It type-checks today, so the value is the CHECK, not the assignability                                               |
| TC-02 | Type/Unit     | A fixture built from the double, asserted to compile with no assertion                                                                       | Red first: no such double exists today, which is why 17 fixtures are hand-rolled                                     |
| TC-03 | Static        | `scan-contract-cast-ratchet.mjs` with both contracts added to `contractCastRatchet.contracts`                                                | The scanner's own caveat applies: a double that internally casts satisfies the ratchet and guarantees nothing        |
| TC-04 | Type          | A command declaring one role port, assigned to `ISystemCommand`                                                                              | Probe already confirms parameter narrowing is accepted under the real strict config                                  |
| TC-05 | Static        | New scan: declarations naming `ICommandHostContext` outside a named allowlist, frozen and falling                                            | **The load-bearing floor.** Every other criterion can pass while the facade survives; this is the one that proves it |
| TC-06 | Static        | New scan: optional-member count on the role ports, at 0 with an explicit carve-out list                                                      | An aggregate-level ceiling would not have caught 10 → 32 — see the Decision                                          |
| TC-07 | Review        | Member inventory diffed against the pre-change checker output                                                                                | "a presence/absence grep is not proof" — the count comes from the checker                                            |
| TC-08 | Unit          | A test asserting the host's report equals the framework helper's for the same inputs, and that the framework retains no second computed path | Red first: the hook is unimplemented today, so the framework branch is the only path that runs                       |
| TC-09 | Review + Unit | An inventory of every `?.() ??` site with a per-site disposition; regression tests where a default survives                                  | The behaviour-changing surface. A site kept "because it might be empty" needs a test showing empty is reachable      |
| TC-10 | Automated     | `pnpm harness:verify-like-ci`                                                                                                                | Mirrors the required checks of `develop`. Labelled Automated, not Manual — the tool IS the command                   |

## Sequencing

Four seams, each independently green and each leaving the tree honest:

- **S1** — TC-01. One line; makes every later step compiler-checked.
- **S2** — TC-02, TC-03. The double, the 21 cast migrations, **and every non-cast site the checker
  flags** (16 known today; the set comes from the `tsgo` error list of a scratch required-members
  branch, not from an enumeration). Required-ness would otherwise break these in S4, for a reason S4
  did not create. This is what actually killed 37 casts on the session axis.
- **S3** — TC-04, TC-05, TC-07. The role ports, the **128** declaration migrations, and the ratchet that
  proves consumers stopped naming the aggregate. **The real design risk and the bulk of the work sit here.**
- **S4** — TC-06, TC-08, TC-09: required members, the replay-log hook resolved, and the `?? default` sites deleted.

## Tasks

Broken down in the task file, one task per Completion Criterion, grouped by seam:
[`.agents/tasks/ARCH-029-command-host-capability-contracts.md`](../../tasks/ARCH-029-command-host-capability-contracts.md).

## Semver

- **`agent-framework` (major)** — `ICommandHostContext`, `ICommandSessionRuntime` and
  `IAgentJobHostContext` are reshaped into role aggregates and their members become required; the
  `./testing` subpath gains `createTestCommandHost`.
- **`agent-command`, `agent-command-workflows`, `agent-transport-tui` (patch)** — command signatures
  narrow to role ports and fixtures move to the double.

  **Not because nothing reaches the barrel** — an earlier revision said "no barrel change in any of
  them", which is false: `packages/agent-command/src/index.ts` is **27 `export *` lines plus 2 named
  exports**, so **60 of the 82** changed declarations land in its emitted `.d.ts` — the other 22 are in
  `__tests__/`, which the barrel does not export and the build does not emit. **patch** is still
  correct, on the accurate reason: no export is added or removed, and _widening_ a parameter type from
  the aggregate to a role port is source-compatible for every caller. The corrected count makes that
  call stronger, not weaker.

## Filed separately, not folded in

- **The interface-package runtime-logic question** — `session-capability-host.ts` sits outside
  `.agents/project-structure.md:308`'s stated rule while passing `scan-interface-runtime.mjs`, which
  checks a narrower thing. That is a gap between a rule's words and its mechanism, owned by the
  harness/INFRA axis. This design avoids the file entirely, so it is not a blocker here. Filed as **HARNESS-103** ([#1797](https://github.com/woojubb/robota/issues/1797)).

## Evidence Log

<!-- Section created by the GATE-WRITE run below to hold its entry; it was absent in the authored document (see failed criterion 1). -->

### [GATE-WRITE] — ❌ FAIL | 2026-08-16

**Status remains:** draft

**Failed criteria:**

- **Structure — "Evidence Log section present and empty (first GATE-WRITE run)":** the authored document
  had no `## Evidence Log` section at all. Headings found were Problem, Prior Art Research, Decision,
  Alternatives Considered, Completion Criteria, Test Plan, Sequencing, Tasks, Semver, Filed separately —
  no evidence surface. 9 of the 11 documents in `.agents/spec-docs/draft/` carry the section at draft time;
  `spec-workflow.md:183` requires every gate to leave an entry in it. Required is a present, empty section;
  found is an absent one.
  **Required action:** author `## Evidence Log` as an empty section in the document body. (This run created
  the heading to hold this entry, so on re-run the section will be present and carry this FAIL — which is
  the expected state for a second GATE-WRITE run, not a fresh violation.)

- **Completion Criteria — "At least 1 criterion per distinct feature or sub-item":** two sub-items of the
  Decision have no TC-N, and therefore no Test Plan row.
  (a) **§3** resolves `validateCurrentSessionReplayLog` to "make it required **and have the host delegate to
  the same helper**". TC-06 (zero optional members on the role ports) covers the required-ness half; the
  host-delegation half — the No-Fallback collapse of the two paths at
  `packages/agent-framework/src/command-api/session/session-command-api.ts:63-77`, verified present as
  `context.validateCurrentSessionReplayLog?.()` with a framework-computed default — has no criterion.
  (b) **§5** commits to deleting the `context.foo?.() ?? default` call sites, "each reviewed individually for
  whether the **value** can legitimately be empty", and `## Sequencing` S4 carries it as distinct work
  ("TC-06 and required members; delete the `?? default` sites"). No TC-N makes that observable. This is the
  design's only behaviour-changing surface, it is the exact place where the parent item's requirement
  "preserve provided-empty results as distinct from capability absence" is decided, and the document itself
  states `scan-no-fallback.mjs` excludes `??` so no mechanism has ever seen these sites. Required is one
  criterion per sub-item; found is TC-06 standing in for the type-level half of two sub-items with the
  behavioural half uncovered.
  **Required action:** add a TC-N (and its Test Plan row) covering the `?? default` call-site collapse with
  an observable form — e.g. the post-change count of `??`-guarded host-capability call sites at 0 plus a
  runtime test asserting provided-empty is distinguishable from absent — and a TC-N or explicit fold-in for
  the §3 host-delegation path.

**Criteria checked and met:**

- **Ordering check (exempt):** GATE-WRITE is the entry gate — no prior-gate PASS required per the
  prior-gate map. Input state verified: frontmatter `status: draft` and the file sits in
  `.agents/spec-docs/draft/`. Status ↔ folder agree.
- **Frontmatter:** opens with `---`; `status: draft`; `type: API` (on the 11-prefix list);
  `tags: [typescript, contracts, command-host, test-doubles]` present.
- **Problem — concrete symptom:** independently re-counted with the TypeScript AST over
  `packages/agent-framework/src/command-api/host-context.ts` — `ICommandHostContext` 46 members / 32
  optional, `ICommandSessionRuntime` 18/7, `IAgentJobHostContext` 15/0. Every number in the document's table
  (79/39 total) matches exactly. Cast counts re-measured over `packages/*/src`: 18 `ICommandHostContext`
  casts across 17 files and 4 `IAgentJobHostContext` casts — both match. The production cast is at
  `packages/agent-framework/src/interactive/interactive-session.ts:221` as stated.
- **Problem — reproduction condition:** the named file, the strict-mode assignability probe, and the
  REFACTOR-006 trajectory table (20/50% → 46/70%) give when and where. `git log -1 f007461fe` confirms
  2026-05-17, the day after REFACTOR-006 closed.
- **Problem — no TBD/TODO/vagueness:** `grep 'TBD\|TODO'` over the document returns nothing.
- **Prior Art Research — waiver accepted:** an explicit `**Waived:** <reason>` line is present, which the
  catalogue permits as an alternative to substantiation. The reason is specific and checkable rather than a
  bare opt-out, and each artifact it leans on was verified: the empty-`extends` aggregate at
  `packages/agent-interface-transport/src/session-contracts.ts:349` ("all 39 required members"), and
  `.agents/harness.config.json` `contractCastRatchet.contracts` = `["IInteractiveSession"]`. Judged on its
  own merits, not on the caller's assertion.
- **Prior Art Research — findings feed Alternatives/Decision:** Alternative 1 is grounded in the measured
  REFACTOR-006 outcome; Alternative 3's rejection rests on `session-capability-host.ts` (file confirmed to
  exist) and on `.agents/project-structure.md`'s "must not contain classes or runtime logic" rule (text
  confirmed at the cited location). Evidence-based, not asserted.
- **Architecture Review Checklist:** all 4 items `[x]`. Sibling scan is `[x]` with completion evidence
  (ARCH-012 + `session-capability-host.ts` + `agent-core/testing`), not a bare tick.
- **Alternatives Considered:** 3 entries, each with an explicit Pro and Con.
- **Decision references the driving trade-off:** yes — "which quantity the floor measures" (§6), with the
  concrete counter-example that an optional-member ceiling would not have caught 10 → 32.
- **New-surface placement (conditional):** applicable and answered. No new package/app/presentation surface;
  one new module in the already-exported `./testing` subpath — confirmed present in
  `packages/agent-framework/package.json` `exports`. (a) names the analogous layer
  (`agent-interface-transport/testing`, `agent-core/testing`) with its family classification; (b) shows reuse
  at the contract level with no sibling-PRODUCT dependency and no new edge.
- **Completion Criteria — TC-N prefixes:** TC-01 … TC-08, all prefixed.
- **Completion Criteria — Command/Observable form, no banned phrasing:** no "works correctly", "no errors",
  "implemented", or "displays correctly" appears in any criterion.
- **Test Plan — row count:** 8 rows for 8 TC-N. Count matches.
- **Test Plan — Test Type and Tool/Approach non-empty, no "TBD":** every row populated.
- **Test Plan — manual-row justification: N/A.** The criterion triggers on the Tool column reading "manual";
  no row's Tool is "manual" (TC-08's Tool is the command `pnpm harness:verify-like-ci`, which produces an
  exit code). Recorded observation, not a failure: TC-08's _Type_ column says "Manual" while its Tool is an
  automated command — a mislabel, since its Notes ("Mirrors the required checks of `develop`") describe the
  command rather than justifying non-automatability.
- **Structure — Tasks section present with placeholder:** met in form; the section names
  `.agents/tasks/ARCH-029-command-host-capability-contracts.md`. **Defect recorded for GATE-IMPLEMENT:** the
  wording "Broken down in the task file, one task per Completion Criterion" is false as of this run — that
  file's `## Plan` holds 6 unprefixed items with no TC-N mapping, and its first item ("Author and
  independently approve the DATA spec for the framework-owned capability map") is explicitly superseded by
  Decision §3. The catalogue places the Plan ↔ Completion-Criteria correspondence at GATE-IMPLEMENT, not
  here, so this does not fail GATE-WRITE; the false completion claim should be reduced to a placeholder or
  made true before GATE-IMPLEMENT.
- **Structure — no `## Status` / `## Classification` in the body:** confirmed absent from the heading list.
- **"Filed separately" claim verified:** HARNESS-096 resolves — the task file
  `.agents/tasks/HARNESS-096-interface-runtime-scan-narrower-than-its-rule.md` exists with
  `issue: .../1797`, and `gh issue view 1797` returns an OPEN issue whose title matches. Not a phantom
  filing. Observation outside this gate's criteria: the ID `HARNESS-096` is also held by an unrelated draft,
  `.agents/spec-docs/draft/HARNESS-096-a-done-spec-doc-never-checks-that-its-task-agrees.md` — an ID
  collision for the backlog owner, with no bearing on this verdict.

### [ORCHESTRATOR CORRECTION] — 2026-08-17

The 2026-08-16 GATE-WRITE entry above is restored to what that run actually recorded. Acting on its
ID-collision observation, the orchestrator renumbered this document's deferred item **HARNESS-096 →
HARNESS-103** (task file moved, GitHub issue #1797 retitled) — but applied the change by blanket
substitution across the whole file, which rewrote the closed entry and left it asserting a path,
`.agents/spec-docs/draft/HARNESS-103-a-done-spec-doc-never-checks-that-its-task-agrees.md`, that does
not exist. The next gate caught it and returned NON-COMPLIANCE.

Recorded here rather than silently repaired: a closed gate entry is that run's evidence, and editing
it in place turns a true finding into a false one. The renumber itself stands — `HARNESS-103` is free,
`HARNESS-096` was not.

### [GATE-WRITE] — 🔴 NON-COMPLIANCE | 2026-08-17

**Status remains:** draft

**Violation:** the recorded evidence of the prior GATE-WRITE run was rewritten after that run closed.
The 2026-08-16 FAIL entry above now reads "the ID `HARNESS-103` is also held by an unrelated draft,
`.agents/spec-docs/draft/HARNESS-103-a-done-spec-doc-never-checks-that-its-task-agrees.md`". That path
does not exist. `ls .agents/spec-docs/draft/` returns eleven files; the one with that exact suffix is
`HARNESS-096-a-done-spec-doc-never-checks-that-its-task-agrees.md`. The prior run's actual finding was a
collision on **HARNESS-096**; the renumber to HARNESS-103 was applied by blanket substitution across the
whole file, including inside the closed entry, so the finding it recorded has been erased and replaced by
a verified-fact claim that is false.

The substitution was selective, which corroborates that the entry is meant to stand as history and that
only the ID was swept: the same entry still says "TC-N prefixes: TC-01 … TC-08", "Test Plan — row count:
8 rows for 8 TC-N", and "TC-08's Tool is the command `pnpm harness:verify-like-ci`" — all accurate for
the 8-criterion document that run judged, all stale now, and none of them touched. No annotation
discloses the edit; the only `<!-- -->` note in this section discloses the section's creation, not the
change to the entry body. A guardian record the authoring side can silently rewrite cannot support any
downstream gate that reads it, so this is a process violation, not an incomplete document.

**Required action:** restore the prior entry's final bullet to what that run found — the collision was on
`HARNESS-096`, against `.agents/spec-docs/draft/HARNESS-096-a-done-spec-doc-never-checks-that-its-task-agrees.md`
— and, if the renumber is to be reflected at all, record it as a new dated line rather than an in-place
edit of a closed entry. Do not alter the rest of the 2026-08-16 entry: its stale counts are correct
history. Re-run GATE-WRITE after the record is repaired. No change to the design content is required.

**GATE-WRITE's own criteria — all checked, all met.** Recorded so the orchestrator knows the record, not
the document, is the blocker:

- **Ordering check (exempt):** GATE-WRITE is the entry gate; the prior-gate map lists no predecessor.
  Input state verified independently: frontmatter `status: draft`, file sits in `.agents/spec-docs/draft/`.
  Status ↔ folder agree. (`git status`: the file is untracked, so no committed prior revision exists to
  diff — the tampering finding above rests on the internal contradiction, not on git history.)
- **Frontmatter:** opens with `---`; `status: draft`; `type: API` (on the 11-prefix list);
  `tags: [typescript, contracts, command-host, test-doubles]` present.
- **Problem — concrete symptom:** re-measured from scratch with the repo's own TypeScript (6.0.3) AST over
  `packages/agent-framework/src/command-api/host-context.ts`: `ICommandHostContext` 46 members / 32
  optional, `ICommandSessionRuntime` 18/7, `IAgentJobHostContext` 15/0 → 79/39 total. Matches the table
  exactly. Casts re-counted over `packages/*/src`: 18 `ICommandHostContext` across 17 files, 4
  `IAgentJobHostContext` — both match. Production cast confirmed at
  `packages/agent-framework/src/interactive/interactive-session.ts:221`
  (`() => this as unknown as ICommandHostContext`), and the class at :95-97 declares
  `implements ISession, IAgentJobHostContext, IInteractiveSession` — not the command host, as stated.
- **Problem — reproduction condition:** the named file, the strict-mode assignability probe, and the
  REFACTOR-006 trajectory (20/50% → 46/70%). `git log -1 f007461fe` → 2026-05-17, the day after
  REFACTOR-006 closed, as claimed.
- **Problem — no TBD/TODO/vagueness:** none in the document body (lines 1-276).
- **Prior Art Research — waiver accepted:** explicit `**Waived:** <reason>` line present, which the
  catalogue permits in place of substantiation. Reason is checkable, and each artifact it leans on was
  verified: the empty-`extends` aggregate at `packages/agent-interface-transport/src/session-contracts.ts:349`
  ("all 39 required members remain source-compatible"), and `.agents/harness.config.json`
  `contractCastRatchet.contracts` = `["IInteractiveSession"]`.
- **Prior Art Research — findings feed Alternatives/Decision:** Alternative 1 rests on the measured
  REFACTOR-006 outcome; Alternative 3's rejection rests on `session-capability-host.ts` and on
  `.agents/project-structure.md:308` ("An `agent-interface-*` package must not contain classes or runtime
  logic" — text confirmed verbatim at that line). Evidence-based, not asserted.
- **Architecture Review Checklist:** all 4 items `[x]`. Sibling scan `[x]` with completion evidence
  (ARCH-012, `session-capability-host.ts`, `agent-core/testing`), not a bare tick.
- **Alternatives Considered:** 3 entries, each with explicit Pro and Con.
- **Decision references the driving trade-off:** yes — "which quantity the floor measures" (§6), with the
  counter-example that an optional-member ceiling would not have caught 10 → 32.
- **New-surface placement (conditional — applicable, answered):** no new package/app/presentation surface;
  one new module in the already-exported `./testing` subpath (confirmed in
  `packages/agent-framework/package.json` `exports`). (a) names the analogous layer and family
  classification; (b) reuse at contract level, no sibling-PRODUCT dependency, no new edge.
- **Completion Criteria — TC-N prefixes:** TC-01 … TC-10, all prefixed.
- **Completion Criteria — ≥1 criterion per distinct feature/sub-item:** now satisfied, re-derived against
  Decision §1-§6 rather than taken on assertion. §1→TC-04, §2→TC-02, §3→**TC-08** (host delegates to the
  same helper _and_ the framework's fallback branch is deleted — the branch is confirmed live at
  `session-command-api.ts:63-77`, `context.validateCurrentSessionReplayLog?.()` guarding a
  framework-computed default), §4→TC-01, §5→TC-06 (required-ness) + **TC-09** (the `?? default` call-site
  deletion, carrying its own criterion and naming itself the one behaviour-changing surface),
  §6→TC-03/TC-05/TC-06. TC-07 covers member preservation, TC-10 the CI floor. The two gaps this gate
  failed on 2026-08-16 are closed. TC-09's supporting claim verified: `scan-no-fallback.mjs:19` states
  verbatim that it "DELIBERATELY excludes … `x ?? default` value-precedence and defaulting-`||`".
- **Completion Criteria — Command/Observable form, no banned phrasing:** no "works correctly", "no
  errors", "implemented", or "displays correctly" in any criterion.
- **Test Plan — row count:** 10 data rows for 10 TC-N, paired one-for-one. Count matches.
- **Test Plan — Type and Tool/Approach non-empty, no "TBD":** every row populated; Notes non-empty on
  every row too.
- **Test Plan — manual-row justification: N/A.** The criterion triggers on the Tool column reading
  "manual"; no row's Tool does. The prior run's mislabel is fixed: TC-10's Type is now "Automated" over
  an automated command, with the reason stated in Notes.
- **Structure — Tasks section present with placeholder:** present, names
  `.agents/tasks/ARCH-029-command-host-capability-contracts.md`, and the false "one task per Completion
  Criterion" wording is gone — it now defers the breakdown to GATE-IMPLEMENT and records that the task
  file's `## Plan` predates this design and still carries the capability-map line Decision §3 supersedes.
  Verified against that file: its `## Plan` still holds that line.
- **Structure — Evidence Log present:** present. The catalogue's "and empty" qualifier is explicitly
  scoped to the first GATE-WRITE run; this is the second, so the section correctly carries the prior
  entry. Met in form — the _integrity_ of what it carries is the violation recorded above.
- **Structure — no `## Status` / `## Classification` in the body:** confirmed absent from the heading list.
- **"Filed separately" claim — re-verified, resolves:** `.agents/tasks/HARNESS-103-interface-runtime-scan-narrower-than-its-rule.md`
  exists with `issue: https://github.com/woojubb/robota/issues/1797`; `gh issue view 1797` returns OPEN,
  title "HARNESS-103: scan-interface-runtime checks a narrower thing than the rule it enforces" — matching.
  No `HARNESS-096` string survives anywhere in this document, and `HARNESS-103` is held by no other backlog
  item or spec doc, so the renumber cleared the collision without creating a new one. The renumber itself
  is correct; only its reach into the closed evidence entry is not.

### [GATE-WRITE] — ✅ PASS | 2026-08-17

**Status upgrade:** draft → review-ready

Third GATE-WRITE run on this document, and the second dated 2026-08-17 (it follows the NON-COMPLIANCE
above, which is a separate run and a separate entry). Every criterion was re-derived from the tree, not
carried over from either prior entry.

**Ordering check (exempt, but input state verified):** GATE-WRITE is the entry gate — the prior-gate map
lists no predecessor for it. Input state checked independently: frontmatter `status: draft`, file sits in
`.agents/spec-docs/draft/`. Status ↔ folder agree. No implementation of this design has started: the
branch `feat/arch-029-command-host-roles` carries 51 commits over `main`, none of them ARCH-029 work; the
working tree holds only this spec and `.agents/tasks/HARNESS-103-…md` as untracked additions;
`createTestCommandHost` does not exist anywhere under `packages/*/src`, and
`packages/agent-framework/src/testing/` contains only `index.ts` + `scripted-session-harness.ts`.

**The record violation that produced the 2026-08-17 NON-COMPLIANCE is repaired.** Judged on the file, not
on the caller's account of it:

- The 2026-08-16 entry's final bullet again reads `HARNESS-096` and names
  `.agents/spec-docs/draft/HARNESS-096-a-done-spec-doc-never-checks-that-its-task-agrees.md`. That file is
  present — `ls .agents/spec-docs/draft/` returns eleven entries and that is one of them. The false
  assertion is gone and the run's actual finding is back.
- The restoration is internally coherent, which is the strongest available check: the file is untracked, so
  there is no committed revision to diff against. The restored bullet now agrees with the rest of its own
  entry, which still reads "TC-01 … TC-08", "8 rows for 8 TC-N" and "TC-08's Tool is the command
  `pnpm harness:verify-like-ci`" — all correct for the 8-criterion document that run judged, all stale for
  the 10-criterion document now, and correctly left alone as that run's history.
- The renumber is disclosed as its own dated line: `### [ORCHESTRATOR CORRECTION] — 2026-08-17`, placed
  before the NON-COMPLIANCE entry, naming what moved (HARNESS-096 → HARNESS-103, task file, issue #1797),
  the mechanism that caused the damage (blanket substitution reaching into a closed entry) and the fact
  that the next gate caught it. Recorded rather than silently repaired, which is the required shape.
- The two surviving occurrences of the non-existent `HARNESS-103-a-done-spec-doc…` path are at lines 386
  and 399, both inside prose quoting the error (the correction entry and the NON-COMPLIANCE entry). Neither
  is an existence claim. **Reading caveat for downstream gates:** these entries are dated history, not
  current-state assertions — the NON-COMPLIANCE entry's "the 2026-08-16 entry now reads HARNESS-103" and
  "no `HARNESS-096` string survives anywhere in this document" were true of that run's tree and are false
  of this one, by design.

**Frontmatter:** file opens with `---`; `status: draft`; `type: API`, on the 11-prefix list;
`tags: [typescript, contracts, command-host, test-doubles]` present.

**Problem — concrete symptom:** re-measured from zero with the repo's own TypeScript 6.0.3 AST over
`packages/agent-framework/src/command-api/host-context.ts`: `ICommandHostContext` 46 members / 32 optional,
`ICommandSessionRuntime` 18 / 7, `IAgentJobHostContext` 15 / 0 → 79 / 39. The table matches exactly. Casts
counted by importing `countContractCasts` from `scripts/harness/scan-contract-cast-ratchet.mjs` itself and
running it over `packages`/`apps`/`scripts` (dist excluded): `ICommandHostContext` **18 casts across 17
files**, of which exactly one is production (`packages/agent-framework/src/interactive/interactive-session.ts`)
and 16 are test files — matching "1 production, 17 test" once `.../provider/__tests__/scripted-interaction.ts`
is counted as a fixture; `IAgentJobHostContext` **4 casts across 3 files**. A grep-level count differs (a
`.tsx` fixture and a `dist/**.d.ts` import alias), which is why the AST was used. Production cast confirmed
at `interactive-session.ts:221` (`() => this as unknown as ICommandHostContext`) with the class declaring
`implements ISession, IAgentJobHostContext, IInteractiveSession` — not the command host, exactly as stated.

**Problem — reproduction condition:** the named file, the strict-mode assignability probe, and the
REFACTOR-006 trajectory. The trajectory table was re-derived, not accepted: `git rev-list` + AST at each
date gives `2026-05-16 → 29/15 (52%)`, `2026-07-01 → 38/24 (63%)`, today `46/32 (70%)`, and REFACTOR-006's
own Problem section states "20개 메서드 중 10개가 optional" for the 2026-05-15 row — all four rows exact.
Its frontmatter reads `created: 2026-05-15`, `completed: 2026-05-16`, and
`git log -S 'as unknown as ICommandHostContext'` puts the production cast at `f007461fe`, dated 2026-05-17
— the day after, as claimed.

**Problem — no TBD/TODO/vagueness:** none in the document body (lines 1–276).

**Prior Art Research — waiver accepted:** an explicit `**Waived:** <reason>` line is present, which the
catalogue permits in place of substantiation, and the reason is checkable rather than a bare opt-out. Each
artifact it leans on was verified: the empty-`extends` aggregate at
`packages/agent-interface-transport/src/session-contracts.ts:349` (16 role ports, empty body, comment "all
39 required members remain source-compatible"); the conformant double `createTestInteractiveSession` under
that package's `testing/`; and `.agents/harness.config.json` `contractCastRatchet.contracts` =
`["IInteractiveSession"]`, whose cast count measures **0** today — so "held at 0" is true, not asserted.

**Prior Art Research — findings feed Alternatives/Decision:** Alternative 1's rejection rests on the
measured REFACTOR-006 outcome verified above; Alternative 3's rests on
`packages/agent-interface-transport/src/session-capability-host.ts` (present) and on
`.agents/project-structure.md:308`, whose text reads verbatim "An `agent-interface-*` package must not
contain classes or runtime logic". Evidence-based.

**Architecture Review Checklist:** all 4 items `[x]`. Sibling scan is `[x]` with completion evidence, each
piece of which exists: ARCH-012's aggregate and double, `session-capability-host.ts`, and
`packages/agent-core/src/testing/scripted-provider.ts` behind that package's `./testing` export.

**Alternatives Considered:** 3 entries, each with an explicit Pro and Con.

**Decision references the driving trade-off:** yes — "which quantity the floor measures" (§6), with the
concrete counter-example that an optional-member ceiling would not have caught 10 → 32 because
`getAgentJobCapability?()` contributes 1 while adding 15 members.

**New-surface placement (conditional — applicable, answered):** no new package, app or presentation
surface; one new module in the already-exported `./testing` subpath, confirmed at
`packages/agent-framework/package.json:21`. (a) names the analogous layer
(`agent-interface-transport/testing`, `agent-core/testing`) with its product-family classification;
(b) shows reuse at the contract level, no dependency on a sibling PRODUCT, no new edge.

**Completion Criteria — TC-N prefixes:** TC-01 … TC-10, ten unchecked items, every one prefixed.

**Completion Criteria — ≥1 per distinct feature/sub-item:** re-derived against the Decision's own
sub-sections rather than taken from the caller. §1 → TC-04; §2 → TC-02 (+TC-03); §3 → **TC-08**, which
covers both halves (host delegates to the same helper _and_ the framework's fallback branch is deleted) —
that branch is confirmed live at `session-command-api.ts:63-78`, `context.validateCurrentSessionReplayLog?.()`
returning early over a framework-computed default; §4 → TC-01; §5 → TC-06 (required-ness) + **TC-09** (the
`?? default` call-site collapse, the design's one behaviour-changing surface); §6 → TC-03 / TC-05 / TC-06.
TC-07 covers member preservation and TC-10 the CI floor. Both 2026-08-16 gaps are closed. TC-09's premise
verified at `scripts/harness/scan-no-fallback.mjs:19`, which states verbatim that it "DELIBERATELY excludes
… `x ?? default` value-precedence and defaulting-`||`"; a crude scan of the two named directories finds 14
single-line `?.() ??` sites against the document's hedged "~20".

**Completion Criteria — Command/Observable form, no banned phrasing:** none of "works correctly", "no
errors", "implemented", "displays correctly" appears in any criterion; each names either a command
(TC-10), a compiler outcome (TC-01/02/04), a scan count (TC-03/05/06) or an inventory artifact
(TC-07/08/09).

**Test Plan — row count:** 10 data rows for 10 TC-N, paired one-for-one (TC-01…TC-10 in both). Count
matches.

**Test Plan — Type and Tool/Approach non-empty, no "TBD":** every row populated across all four columns;
Notes non-empty on every row too.

**Test Plan — manual-row justification: N/A, with the reason.** The criterion triggers on the Tool column
reading "manual"; no row's Tool does. The prior mislabel is gone — TC-10's Type now reads "Automated" over
`pnpm harness:verify-like-ci`, with the reason stated in Notes.

**Structure — Tasks section present with placeholder:** present, naming
`.agents/tasks/ARCH-029-command-host-capability-contracts.md`. The false "one task per Completion
Criterion" wording is gone; it now defers the breakdown to GATE-IMPLEMENT and records that the task file's
`## Plan` predates this design. Verified against that file: line 60 still reads "Author and independently
approve the DATA spec for the framework-owned capability map", which Decision §3 supersedes — so the
document's own caveat is accurate.

**Structure — Evidence Log present:** present. The catalogue scopes "and empty" to the first GATE-WRITE
run; this is the third, so the section correctly carries prior entries, and their integrity is the
repaired condition recorded above.

**Structure — no `## Status` / `## Classification` in the body:** confirmed absent from the full heading
list.

**"Filed separately" claim resolves:** `.agents/tasks/HARNESS-103-interface-runtime-scan-narrower-than-its-rule.md`
exists with `issue: https://github.com/woojubb/robota/issues/1797`; `gh issue view 1797` returns
`{"number":1797,"state":"OPEN","title":"HARNESS-103: scan-interface-runtime checks a narrower thing than
the rule it enforces"}`. `HARNESS-103` is held by no other task or spec doc, so the renumber cleared the
collision without creating one.

**Two precision defects recorded for the GATE-APPROVAL reviewer — neither maps to a GATE-WRITE criterion,
so neither decides this verdict:**

1. The Problem section claims REFACTOR-006 proposed this direction "including, **verbatim**, 'each command
   declares only the capabilities it needs'". That English string appears nowhere in
   `.agents/tasks/completed/REFACTOR-006-icommand-host-context-capability-split.md`. What is there is item
   4 of its plan, in Korean: "각 command module이 필요한 capability interface만 선언." The substance is
   accurate and the argument it supports stands on the measured trajectory, which is exact — but "verbatim"
   is presented as a quotation and is a translation. Fix by attributing it as one.
2. TC-03 reads "all 21 cast sites (`ICommandHostContext` 18 + `IAgentJobHostContext` 4, minus the
   production one removed by TC-01)". 18 + 4 = 22, and 22 − 1 = 21, so the arithmetic resolves only if the
   parenthetical is read as subtracting from the sum; as written the "21" and the "18 + 4" read as the same
   quantity. Cosmetic, but the number is the criterion.

### [GATE-APPROVAL] — ❌ FAIL | 2026-08-17

**Status remains:** review-ready

**Ordering check: PASS.** The prior-gate map names `GATE-WRITE` with expected input `review-ready`. This
log carries `### [GATE-WRITE] — ✅ PASS | 2026-08-17` ("Status upgrade: draft → review-ready"), the third
GATE-WRITE run and the one that follows the repaired record. Input state verified independently:
frontmatter reads `status: review-ready` and the file sits in `.agents/spec-docs/backlog/`, which is the
folder `spec-workflow.md` > Spec-Document Status and Lifecycle Folders maps `review-ready` to. Status ↔
folder agree, so the transition into this gate was not skipped.

**Failed criteria:**

- **"User has provided explicit approval in the current conversation" — NOT MET. The standing delegation
  is real, and it does not reach this item.** No user approval of this document exists; the invocation
  instead invokes the standing instruction recorded at
  `.agents/tasks/RULE-012-standing-delegation-must-not-be-reasked-as-ceremonial-approval.md:23-24`:
  "내가 승인하는게 아니라 근거가 타당하면 너가 알아서 승인하고 넘어가야지." That instruction and its
  auditable form were **not** rejected here — `.agents/spec-docs/done/INFRA-100-macos-harness-portability.md:213-222`
  is a recorded GATE-APPROVAL PASS built on the same verbatim delegation, and this gate accepts that
  precedent's shape. It fails on the precedent's own third leg: **the item must remain inside the
  delegated class.** INFRA-100 qualified because its change was "confined to existing internal harness
  implementation and its tests … changes no public API, ownership, dependency direction, module boundary,
  root policy file, or novel repository practice, and is reversible with low blast radius". ARCH-029 is
  the inverse on the measured facts: `## Semver` declares **`agent-framework` (major)** with three
  contracts reshaped and their members made required, and `packages/agent-framework/package.json` shows
  `@robota-sdk/agent-framework` at `3.0.0-beta.79` with **no `private` field** — a published package.
  `agent-command` and `agent-transport-tui` are likewise published. `.agents/rules/backlog-execution.md:46`
  puts "The decision changes a published or externally visible contract" on the **stop-and-ask** list, and
  its agent-authority test at lines 31-34 requires _all four_ conditions, of which two fail here (public
  API contract change; not reversible / not low blast radius — 21 fixture migrations across 4 packages and
  ~20 call sites whose behaviour changes, by the document's own TC-03 and TC-09). A delegation of a
  defined class is not a delegation of everything, and this item sits outside the class the repository
  defines. Separately noted, not relied on: RULE-012 itself is `status: todo`, so the amendment that would
  write standing delegation into this gate's criteria has not landed — but this verdict does not rest on
  that, because the delegation fails on scope even granting the form.
  **Required action:** obtain the owner's explicit sign-off on this document, and record it verbatim with
  its date. Lead with what `spec-workflow.md` > New-Surface Architecture Placement item 4 says the owner
  most needs to weigh: the published-major on `agent-framework` and the placement of the double.

- **"Independent architecture validation (conditional)" — APPLICABLE, NOT MET.** The condition fires:
  the spec adds a new module to an exported subpath (`packages/agent-framework/src/testing/createTestCommandHost`)
  whose home was contested between two candidates in the Decision itself (§2 rejects generalizing
  `packages/agent-interface-transport/src/session-capability-host.ts`) — spec-workflow's "a new module that
  could plausibly live in more than one place" — and it reshapes three contracts exported from a published
  barrel (`packages/agent-framework/src/command-api/index.ts:30` re-exports from `host-context.js`) into
  new role ports. The document's own `**New-surface placement.**` paragraph and the GATE-WRITE PASS entry
  both treat the condition as applicable. The criterion requires the **Evidence Log** to contain an
  independent architecture-review verdict that **ENDORSED** the placement. Mechanically checked:
  `grep -n "proposal-reviewer\|REVIEW VERDICT\|ENDORSE\|REVISE"` over this document **and** over
  `.agents/tasks/ARCH-029-command-host-capability-contracts.md` returns **no match** — the log holds three
  `[GATE-WRITE]` entries and one `[ORCHESTRATOR CORRECTION]`, and no reviewer entry of any kind. The
  invocation reports that `proposal-reviewer` returned **REVISE** and states plainly that no follow-up
  ENDORSE on the revised document was obtained. A REVISE is not an endorsement; a REVISE whose required
  changes were incorporated is evidence that the design moved, not that the reviewer accepted where it
  landed. This is the same criterion that failed
  `.agents/spec-docs/active/ARCH-021-child-process-subagent-composition.md:715-718`, and the standing
  delegation does not cure it — the delegation speaks to who approves, not to whether the independent
  placement review exists.
  **Required action:** re-run the independent review against **this** revised document and record its
  verdict as its **own** Evidence Log entry, authored from the reviewer's output (verdict line, date, and
  the placement finding — analogous layer, product-family classification, contract-level reuse, dependency
  direction), following `.agents/spec-docs/done/DATA-005-toolregistry-functiontool-ssot.md:181`. Record the
  superseded **REVISE** as its own dated entry too: a verdict was issued against this design and this log
  shows no trace of it, while the document visibly carries its consequences (§2's "An earlier revision of
  this recommendation proposed it", the corrected causal claim, the aggregate-naming ratchet).

**Criteria checked and met, or N/A with the reason — recorded so none is silently skipped:**

- **"Approval is a direct, unambiguous statement directed at this spec document" — N/A, no approval
  exists to assess.** Recorded rather than skipped: the standing delegation quoted above is dated
  2026-08-15 and is not directed at this document, and the session `/goal` directive
  ("ARCH-\* 를 모두 처리하고 완료할 때까지 반복해서 진행하고 완료해줘") is a generic continuation
  instruction, which the catalogue's "What does NOT count" list excludes by name.
- **"No Architecture Review or frontmatter type/tags modified after approval" — N/A: there is no approval,
  so no post-approval window exists.** Checked anyway, to establish the document's integrity at this run:
  the only delta between the staged blob and the worktree is `status: draft` → `status: review-ready`
  (`git diff` = 1 insertion, 1 deletion, on the frontmatter status line only). `type: API` and
  `tags: [typescript, contracts, command-host, test-doubles]` are byte-identical to what GATE-WRITE judged.
  **Observed, not a criterion:** the body was repaired after the GATE-WRITE PASS was written — that entry
  records two "precision defects for the GATE-APPROVAL reviewer" as present, and both are now fixed in the
  body (line 52 attributes the REFACTOR-006 line as "a translation, not a quotation"; TC-03 now reads
  "all **22** cast sites … so **21 test sites migrate**"). The closed GATE-WRITE entry was correctly left
  unedited, so its findings stand as that run's history and now read stale by design — the same shape the
  `[ORCHESTRATOR CORRECTION]` entry established. Neither repair touches the Architecture Review or
  frontmatter type/tags.
- **NON-COMPLIANCE trigger ("implementation work started before this gate ran") — NOT TRIPPED**, verified
  against the tree rather than assumed: `git status --porcelain -- packages apps` is empty;
  `grep -rn "createTestCommandHost" packages/*/src` returns nothing and
  `packages/agent-framework/src/testing/` still holds only `index.ts`, `scripted-session-harness.ts`,
  `__tests__/`, `__fixtures__/`; the production cast this design's TC-01 removes is still present verbatim
  at `packages/agent-framework/src/interactive/interactive-session.ts:221`
  (`() => this as unknown as ICommandHostContext`). Nothing this gate would authorize has been pre-empted,
  which is why this verdict is FAIL — finishable work — and not NON-COMPLIANCE. If this item is
  re-presented with a review verdict **asserted in the invocation but still absent from this log**, that is
  the ARCH-021 fact pattern and becomes NON-COMPLIANCE.

**Verdict:** FAIL on two independent criteria. The design's quality is not what failed here and nothing in
it needs rewriting — what is missing is an owner sign-off the standing delegation does not cover, and an
endorsing independent review on the revised document.

### [ARCHITECTURE REVIEW] — `proposal-reviewer` — ✅ ENDORSE | 2026-08-17

> **Provenance.** Relayed into this log by the orchestrator from the `proposal-reviewer` agent's
> returned output; the reviewer does not write to this file. **Three rounds** ran against this design:
> **REVISE** (conversational form, on the recommendation), **REVISE** (second pass, on the written
> document), and this **ENDORSE** (third pass). The two superseded verdicts are summarised below so
> this log does not present the endorsement as a first-pass result.

**Verdict:** `REVIEW VERDICT: ENDORSE` — "The decision, the mechanism and the placement are correct as
written. Every correction I asked for is applied and independently reproducible from the tree."

**Placement verdict** (recorded verbatim because `spec-workflow.md` item 3 requires it explicitly):

> **ENDORSED.** The design introduces no new package, app or presentation surface. It adds one module,
> `createTestCommandHost`, to `packages/agent-framework/src/testing/` — an **already-exported subpath**.
>
> 1. **Mirror-an-analog — passes, and passes on the analog's own stated principle.** The closest
>    structural analogs are `agent-interface-transport/src/testing/index.ts:67`
>    (`createTestInteractiveSession`, ARCH-012's landed double) and `agent-core`'s scripted provider.
>    Product-family classification: _neutral library, test-support subpath_. The apparent divergence —
>    ARCH-012's double landed in `agent-interface-transport`, this one in `agent-framework` — is not a
>    divergence: that package's SPEC states the governing principle as **the double lives with the
>    contract**. On the command axis the contract owner _is_ `agent-framework`. This is a mirror, not
>    an exception.
> 2. **Reuse level — passes.** `agent-command`, `agent-command-workflows` and `agent-transport-tui`
>    each already declare `@robota-sdk/agent-framework` as a regular dependency, so the double is
>    reachable with **no new dependency edge** and no dependency on a sibling PRODUCT.
> 3. **Placement alternative rejected, with reasons that hold.** Generalizing
>    `session-capability-host.ts` is refused; that file has no production consumers and
>    `project-structure.md:308` bans runtime logic in an `agent-interface-*` package, so widening it is
>    an amendment argument, not an exemption. Correctly filed outward as HARNESS-103 rather than
>    absorbed.

**What the two superseded rounds corrected**, recorded because the endorsement is only meaningful
against them:

- **Round 1 (REVISE, on the recommendation)** — rejected generalizing `session-capability-host.ts`;
  corrected an inverted causal claim (required-ness does not force fixture migration, because casts are
  immune to optionality); replaced the proposed optional-member ceiling with the aggregate-naming
  ratchet; and added `ICommandSessionRuntime` and `IAgentJobHostContext` to scope, taking the reachable
  surface from 46 members to 79.
- **Round 2 (REVISE, on the written document)** — found TC-05 stated two incompatible acceptance
  conditions, and that under "frozen and falling" this design would close green with **127 of 128**
  declarations still naming the facade, which is exactly what REFACTOR-006 shipped; found the cost
  understated ~6× (128 declaration rewrites, not 21 cast sites); found §5's claim about what is checked
  against the contract false; and found the semver rationale's supporting facts wrong.
- **Round 3 (this ENDORSE)** — found the §5 residual was **16**, not five, and — the substantive point
  — that a hand enumeration was **the wrong instrument, not merely the wrong count**, because a
  contextually-typed literal passed straight to a parameter breaks identically and appears in no list.
  §5 now specifies a procedure (the `tsgo` error set of a scratch required-members branch). Also
  corrected the ARCH-012 comparator 41 → **37** (a self-adverse correction: it makes the comparison
  _less_ favourable to the chosen alternative, and the choice stands) and the semver supporting facts
  (27 `export *` + 2 named; 60 of 82 reach the emitted `.d.ts`).

**Reviewer's closing note, carried into implementation:** the 128 baseline is the one number still tied
to a pattern rather than to the checker — define the scan first, then take the baseline from the scan.
The target of 0 makes the baseline non-load-bearing, which is why it is a note and not a finding.

**Found while verifying a citation, filed outward rather than absorbed:**
[#1800](https://github.com/woojubb/robota/issues/1800) (DOCS-026) — `agent-interface-transport`'s SPEC
carries ARCH-012's superseded 41-cast audit figure with no reconciling note, where the migrated figure
was 37.

### [GATE-APPROVAL] — ✅ PASS | 2026-08-17

**Status upgrade:** review-ready → approved

Second GATE-APPROVAL run, following the `❌ FAIL | 2026-08-17` entry above. Both failed criteria are met
on evidence taken from the session record and the tree, not from the invocation's account of them. The
invocation's claims were treated as claims and checked at source; where its account differs from what the
record shows, the record is recorded below.

**Ordering check: PASS.** The prior-gate map names `GATE-WRITE` with expected input `review-ready`. This
log carries `### [GATE-WRITE] — ✅ PASS | 2026-08-17` ("Status upgrade: draft → review-ready"). Input
state verified independently: frontmatter reads `status: review-ready`, and the file sits in
`.agents/spec-docs/backlog/`, which `spec-workflow.md:168` maps `review-ready` to. Status ↔ folder agree.

**Criterion 1 — "User has provided explicit approval in the current conversation": MET, verified at
source rather than relayed.** The prior run's ruling stands unchanged — the standing delegation's form is
valid but this item sits outside the delegated class (`agent-framework` `3.0.0-beta.79`, no `private`
field, `## Semver` major; `backlog-execution.md:46` stop-and-ask). So owner approval was required, and it
exists. Located in this session's own transcript,
`~/.claude/projects/-home-ubunutu-dev-robota-2/e82cfba8-e0c6-4e4b-bf40-c54a5d248ee4.jsonl`:

- Line 7853, `2026-08-16T15:41:16Z` — the orchestrator issues an **`AskUserQuestion`** tool call
  (`toolu_01McX8BBw4LDMXkYYnqW8NmK`), header `ARCH-029`, closing `진행할까요?`, with three options:
  approve S1–S4, approve S1·S2 only, or defer.
- Line 7854, `2026-08-16T15:51:04.418Z` — the answer returns as the tool result:
  `…"진행할까요?"="승인 — S1~S4 전체 진행"`.

Verbatim user statement: **`승인 — S1~S4 전체 진행`** ("Approved — proceed with S1 through S4 in full"),
`2026-08-16T15:51:04Z` = **2026-08-17 00:51 local (UTC+9)**, which is the date this entry carries.
This is decisive on the point the prior FAIL left open: the approval did **not** arrive as an agent
message asserting an approval — it came back through the `AskUserQuestion` surface, so it is the user's
own answer. Independently confirmed by exhaustion: between the `/goal` at line 7040
(`2026-08-16T13:18:00Z`) and this invocation at line 7865, every other `type: user` record in the
transcript is a `tool_result`, a `<task-notification>`, or `isMeta` Stop-hook feedback — this tool result
is the only owner input in the window, so no other candidate could be mistaken for it.

The prompt's accuracy was checked, because an approval obtained on wrong numbers is not an approval of
this design. The question text carries the corrected cost verbatim: `선언 128개 이전` (82 / 45 / 1),
`캐스팅 21곳 + 비캐스팅 16곳`, `호출부 20여 곳`, `계약 3개 재구성`, `새 스캔 2개`,
`배포 패키지 4개 changeset`, the ARCH-012 side-by-side (`39멤버에 캐스팅 37곳`), and the
`agent-framework` published-major as the reason the gate reserved the decision. Those match this
document's `## Alternatives Considered` Alternative 2, §5 and `## Semver` as written. It also leads with
what `spec-workflow.md` > New-Surface Architecture Placement item 4 requires — the published major — which
is exactly the required action the prior FAIL set.

**Criterion 2 — "Approval is a direct, unambiguous statement directed at this spec document": MET.** The
question is headed `ARCH-029` and describes this design, its ENDORSE, and its measured cost; the selected
option is labelled `승인 — S1~S4 전체 진행` and its description walks S1→S2→S3→S4, which are this
document's own `## Sequencing` seams. It is not an answer to a clarifying question — the question **was**
the authorization decision, and the two unchosen options were partial-scope and defer, so the choice
discriminates. `승인` is named in the catalogue's "What counts" list. Not a generic continuation
instruction: the `/goal` directive the prior run correctly excluded is a separate, earlier record.

**Criterion 3 — "No Architecture Review or frontmatter type/tags modified after approval": MET, and
answered mechanically rather than on assertion.** The invocation explicitly asked whether post-ENDORSE
body edits invalidate the approval window. They do not, and the file settles it: the document's mtime is
**`2026-08-16T15:40:13Z`**, which is **11 minutes before** the approval at `15:51:04Z`, and it has not
been written since. There is therefore no post-approval edit of any kind — not to the Architecture Review
Checklist, not to frontmatter, not to the body. Corroborated by `git diff` against the staged blob: the
only frontmatter delta is `status: draft` → `status: review-ready`, which is GATE-WRITE's own recorded
output; `type: API` and `tags: [typescript, contracts, command-host, test-doubles]` are byte-identical to
what GATE-WRITE judged. **Recorded because it is material and was not disclosed:** the Architecture Review
Checklist _was_ edited relative to that blob — the affected-package item now reads
"`agent-transport-tui` (one cast and one `Pick<>`; no bare `: ICommandHostContext` declaration)" where it
read "(cast sites and command signatures)". That edit lands at or before 15:40:13Z, i.e. inside the
pre-approval window and before the owner saw the document, so it is not a violation; it is noted so no
later gate reads the checklist as untouched since GATE-WRITE.

**Criterion 4 — "Independent architecture validation (conditional)": APPLICABLE, MET.** The condition
fires for the reasons the prior FAIL recorded (a new module in an exported subpath whose home was
contested in the Decision itself; three contracts reshaped behind a published barrel). The log now carries
`### [ARCHITECTURE REVIEW] — proposal-reviewer — ✅ ENDORSE | 2026-08-17` with the placement verdict
recorded verbatim. **The entry was checked against the reviewer's own output, not accepted as relayed:**
the returned result of subagent task `a1e16fcfcc6f4ebf7` ("Third review of ARCH-029 spec") is in the
transcript at line 7830, `2026-08-16T15:39:16Z`, 17,039 chars, ending with the line
`REVIEW VERDICT: ENDORSE`. The log entry's quoted verdict sentence ("The decision, the mechanism and the
placement are correct as written. Every correction I asked for is applied and independently reproducible
from the tree.") and its three-part placement block reproduce that output faithfully; nothing in the entry
is absent from the reviewer's text. The provenance note and the two superseded REVISE rounds are recorded,
so the endorsement is not presented as a first-pass result — which is what the prior FAIL's required
action asked for.

The placement verdict's load-bearing facts were re-checked here rather than taken from the reviewer:
`packages/agent-framework/package.json` has no `private` field, version `3.0.0-beta.79`, and exports
`./testing` with `source: ./src/testing/index.ts`; the analog double exists at
`packages/agent-interface-transport/src/testing/index.ts:67`
(`export function createTestInteractiveSession(`); and `agent-command`, `agent-command-workflows` and
`agent-transport-tui` each already declare `@robota-sdk/agent-framework: workspace:*` as a regular
dependency, so the double is reachable with no new dependency edge and no sibling-PRODUCT dependency.

**On the invocation's stale-endorsement worry — the premise is wrong, in the safe direction.** The
invocation states the document "gained three corrections the third pass required" _after_ the ENDORSE
entry was written. The reviewer's own returned output shows the opposite: its premise table verifies each
of the three as already present and reproducible — §5's residual "**TRUE, exactly reproducible**" at 16
(5 variable annotations + 11 cast-free factory returns, re-derived independently), the ARCH-012 comparator
"**TRUE for the cited source**" at 37, and the semver facts "**TRUE, exact**" (27 `export *` + 2 named;
60 of 82 outside `__tests__/`). The endorsement therefore covers the substance of the document as it now
stands. The only edit made after the review is the cosmetic citation the reviewer itself asked for and
pre-classified ("**this is cosmetic and does not block**"): §2 now names
`.agents/tasks/completed/ARCH-012-interactive-session-god-contract.md:187` as the quotation's source.
Verified at source, since the reviewer never saw the applied form — that file's lines 186-187 read
"Every transport package sits BELOW `agent-framework`, so none of them could import it", matching the
quotation verbatim. No re-review is required and the approval window is clean.

**NON-COMPLIANCE trigger ("implementation work started before this gate ran") — NOT TRIPPED**, re-verified
against the tree at this run: `git status --porcelain -- packages apps` is empty;
`grep -rn "createTestCommandHost" packages/*/src` returns nothing;
`packages/agent-framework/src/testing/` still holds only `index.ts`, `scripted-session-harness.ts`,
`__tests__/`, `__fixtures__/`; and the production cast TC-01 removes is still present verbatim at
`packages/agent-framework/src/interactive/interactive-session.ts:221`
(`() => this as unknown as ICommandHostContext`). Nothing this gate authorizes has been pre-empted. The
prior FAIL's stated NON-COMPLIANCE condition — a review verdict asserted in the invocation but absent from
this log — does not apply: the verdict is in the log and matches the reviewer's returned output.

**Outward filings re-verified:** `gh issue view 1797` → OPEN, "HARNESS-103: scan-interface-runtime checks
a narrower thing than the rule it enforces"; `gh issue view 1800` → OPEN, "DOCS-026:
agent-interface-transport's SPEC carries ARCH-012's superseded 41-cast figure with no reconciling note".
Both are real, both open, neither folded into this item.

**Verdict:** PASS on all four criteria. The deciding one is criterion 1 — the owner's `승인 — S1~S4 전체
진행`, given through `AskUserQuestion` at `2026-08-16T15:51:04Z` against a prompt carrying the corrected
128-declaration cost and the `agent-framework` published-major, which is the sign-off the standing
delegation did not cover.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-08-17

**Status upgrade:** approved → in-progress

**Ordering check: PASS.** The prior-gate map names `GATE-APPROVAL` with expected input status `approved`.
This log carries `### [GATE-APPROVAL] — ✅ PASS | 2026-08-17` ("Status upgrade: review-ready → approved"),
the second GATE-APPROVAL run, and it is not a bare claim — its deciding evidence was spot-checked at
source rather than relayed: the string `승인 — S1~S4 전체 진행` is present in this session's transcript,
`~/.claude/projects/-home-ubunutu-dev-robota-2/e82cfba8-e0c6-4e4b-bf40-c54a5d248ee4.jsonl` (6
occurrences — the `AskUserQuestion` call, its tool result, and later citations). Input state verified
independently: frontmatter reads `status: approved` and the file sits in `.agents/spec-docs/todo/`, which
`spec-workflow.md:169` maps `approved` to. Status ↔ folder agree, so no step was skipped into this gate.

- **Criterion 1 — "`.agents/tasks/<ID>.md` has been created": MET.**
  `.agents/tasks/ARCH-029-command-host-capability-contracts.md` exists (6073 bytes, mtime
  `2026-08-17 00:57`), with frontmatter `title: ARCH-029…`, `status: todo`, `issue: …/issues/1722` — the
  same issue this design's header cites. `git status --porcelain` shows it as ` M` (tracked, modified), so
  it is a pre-existing item that was broken down, not a file fabricated to satisfy this gate.

- **Criterion 2 — "Tasks file path is recorded in the `## Tasks` section of the spec document": MET.**
  `## Tasks` (line 291) reads "Broken down in the task file, one task per Completion Criterion, grouped by
  seam: [`.agents/tasks/ARCH-029-command-host-capability-contracts.md`](../../tasks/ARCH-029-command-host-capability-contracts.md)".
  The relative link resolves: from `.agents/spec-docs/todo/`, `../../tasks/` is `.agents/tasks/`, and the
  target exists. The claim is now true, which it was not at GATE-WRITE: `git show :<path>` of the staged
  blob has this section reading "To be broken down … at GATE-IMPLEMENT" plus a caveat that the task file's
  `## Plan` predates this design; both are gone from the worktree because both are obsolete. The
  GATE-WRITE PASS entry's forward-recorded defect ("the false 'one task per Completion Criterion' wording
  … now defers the breakdown to GATE-IMPLEMENT") is therefore closed at the gate that owns it.

- **Criterion 3 — "Tasks in the file correspond to the Completion Criteria (at minimum, one task per
  TC-N)": MET, checked by enumeration in both directions, not by reading the file's own claim.** The spec
  has ten criteria, TC-01…TC-10 (`grep -c '^- \[ \] TC-'` = 10). The task file's `## Plan` holds ten
  `- [ ] **TC-NN**` items at lines 68, 74, 77, 84, 86, 88, 94, 96, 98, 104 — TC-01, TC-02, TC-03, TC-04,
  TC-07, TC-05, TC-06, TC-08, TC-09, TC-10. Every TC-N appears exactly once; none is missing and none is
  duplicated. Content correspondence spot-checked per task, not just the label: TC-01 names the
  `() => this as unknown as ICommandHostContext` → `() => this` replacement (spec TC-01); TC-02 names
  `createTestCommandHost(overrides?: Partial<ICommandHostContext>)` in `agent-framework/src/testing/` with
  no cast (spec TC-02); TC-03 names the 21 migrating cast sites, the 16 checker-flagged non-cast sites and
  the ratchet on both contracts (spec TC-03 + Decision §5); TC-05 carries the "**Zero, not 'falling'**"
  constraint and the scan-before-baseline order the spec's baseline caveat and the reviewer's closing note
  both require. The seam grouping matches `## Sequencing` exactly: S1={TC-01}, S2={TC-02,TC-03},
  S3={TC-04,TC-05,TC-07}, S4={TC-06,TC-08,TC-09}, close-out={TC-10}. The superseded pre-design Plan is
  gone — `git diff` shows the six unprefixed items removed, including "Author and independently approve
  the DATA spec for the framework-owned capability map", which Decision §3 supersedes.

- **Criterion 4 — "The tasks file includes a `## Test Plan` (or `## Testing` / `## 검증`) section with
  ≥50 chars": MET.** `## Test Plan` is present at line 42 of the task file; the section body measures
  **643 characters** (`awk` extraction between `## Test Plan` and the next `## ` heading), well over the
  floor, and carries five substantive lines (type-level RED, absent-vs-provided-empty runtime tests,
  fixture migration, the cast scanner at an exact zero baseline, and a public command-path scenario) — not
  a stub written to clear a character count. **Recorded because the criterion's stated mechanism no longer
  reaches this file:** the parenthetical rationale "[the] `test-plans` harness scan requires development
  docs to carry one (else `harness:scan` fails). [AF-24]" is stale as written —
  `scripts/harness/scan-test-plan.mjs:49-65` deliberately excludes `.agents/tasks` (post-PROC-006, 34 of
  66 Tasks lack one, and a Task is the problem statement, which predates a knowable plan), and its
  `SCAN_DIRS` is `docs/superpowers/{plans,specs}` + `spec-docs/{backlog,todo,active}`. Run at this gate:
  `node scripts/harness/scan-test-plan.mjs` → exit 0, "30 document(s) checked: 4 live … 26 archived",
  which covers **this spec document** (in `todo/`) and not the task file. So the criterion is met on the
  document's own text, which is what the criterion states; the scan is not what proves it. Flagged for the
  catalogue owner, and it does not affect this verdict either way.

**NON-COMPLIANCE trigger ("implementation commits exist but no tasks file was created") — NOT TRIPPED,
and neither half holds.** The tasks file exists (criterion 1), and no implementation exists to have
pre-empted this gate, verified against the tree rather than accepted from the invocation:
`git status --porcelain -- packages apps` returns empty; `grep -rn "createTestCommandHost"` over
`packages`, `apps` and `scripts` returns nothing; and the production cast TC-01 removes is still present
verbatim at `packages/agent-framework/src/interactive/interactive-session.ts:221`
(`() => this as unknown as ICommandHostContext`). The whole working tree on
`feat/arch-029-command-host-roles` holds only documentation changes: this spec (`AM`), the task file
(` M`), two auto-generated lessons files, and the untracked `HARNESS-103` task. This gate is authorizing
work that has not started, which is the correct order.

**Observations outside this gate's criteria — recorded so they are not read as silently checked, and
neither decides this verdict:**

1. The task file's `## Direction` (line 35) still reads "Define framework-owned named command-host roles
   and a typed capability map/query." Decision §3 supersedes the capability map ("the command axis needs
   no capability map or query — … replaced by role ports"). The `## Plan` was corrected; the older
   `## Direction` prose was not. No GATE-IMPLEMENT criterion covers the Direction section, and the Plan is
   what this gate reads, so this is a staleness note for the executor — a task file whose Direction and
   Plan disagree is a place a later seam can drift back toward the rejected mechanism.
2. The rewritten Plan dropped the previous item "Record DONE-GATE-STAGE-1 for the durable public
   command-path scenario". The obligation itself is unaffected — it is owned by `backlog-execution.md` >
   Done Gate, and the task file's `## User Execution Test Scenarios` section still states scenarios "will
   be authored at this item's scenario-planning gate before implementation" — but it is now carried only
   by that sentence and no longer by a checkbox, so nothing in the Plan will show it as pending.

**Verdict:** PASS on all four criteria. The deciding one is criterion 3 — ten `TC-N` tasks for ten
Completion Criteria, each appearing exactly once, grouped in the four seams `## Sequencing` defines, with
the superseded capability-map plan removed.

### [TC-07 MEMBER INVENTORY] — ✅ 79/79 PRESERVED | 2026-08-17

Produced by walking the `extends` graph of both revisions with the repo's own AST helper and
diffing member sets — **not** by reading the diff. The design's own standard: "a presence/absence
grep is not proof."

**Result: 79 rows, 0 members lost, 0 members added.** 46 + 18 + 15, matching the pre-change counts
exactly.

| transition                   | count | meaning                                       |
| ---------------------------- | ----- | --------------------------------------------- |
| required → required          | 40    | untouched                                     |
| optional → required          | 38    | TC-06 + TC-08                                 |
| optional → optional          | 1     | the named carve-out, `getCommandHostAdapters` |
| required → optional          | 0     | no member was weakened                        |
| present before, absent after | 0     | nothing lost                                  |
| absent before, present after | 0     | nothing invented                              |

One correction is on the record here rather than smoothed over. The first `optional → required`
sweep reported **36**; the real figure is 38. Two members were missed and only the TC-06 scan found
them, once its detector was fixed:

- `runWithTerminal?<T>(…)` — the sweep's pattern required `(` immediately after `?`, and this
  declaration has a type-parameter list there.
- `validateCurrentSessionReplayLog` — converted separately under TC-08.

That is the reason the scan is the instrument of record and the sweep is not: the sweep and the
floor disagreed, and the floor was right.

**ICommandHostContext** — 46 members

| role port                       | member                            | before   | after    |
| ------------------------------- | --------------------------------- | -------- | -------- |
| `ICommandHostAdapterAccess`     | `getCommandHostAdapters`          | optional | optional |
| `ICommandHostAgentJobs`         | `getAgentJobCapability`           | optional | required |
| `ICommandHostBackgroundTasks`   | `cancelBackgroundTask`            | required | required |
|                                 | `closeBackgroundTask`             | required | required |
|                                 | `listBackgroundTasks`             | required | required |
|                                 | `readBackgroundTaskLog`           | required | required |
| `ICommandHostCatalog`           | `executeSkillCommandByName`       | optional | required |
|                                 | `listCommands`                    | optional | required |
|                                 | `listSkills`                      | optional | required |
| `ICommandHostCheckpoints`       | `forkCheckpointBranch`            | optional | required |
|                                 | `inspectEditCheckpoint`           | optional | required |
|                                 | `listCheckpointBranches`          | optional | required |
|                                 | `listEditCheckpoints`             | required | required |
|                                 | `restoreEditCheckpoint`           | required | required |
|                                 | `rollbackEditCheckpoint`          | required | required |
|                                 | `switchCheckpointBranch`          | optional | required |
| `ICommandHostContextReferences` | `addContextReference`             | optional | required |
|                                 | `clearContextReferences`          | optional | required |
|                                 | `listContextReferences`           | optional | required |
|                                 | `removeContextReference`          | optional | required |
| `ICommandHostContextWindow`     | `compactContext`                  | required | required |
|                                 | `getAutoCompactThreshold`         | required | required |
|                                 | `getAutoCompactThresholdSource`   | optional | required |
|                                 | `getContextState`                 | required | required |
|                                 | `setAutoCompactThreshold`         | optional | required |
| `ICommandHostGoal`              | `cancelGoal`                      | optional | required |
|                                 | `getGoalState`                    | optional | required |
|                                 | `setGoal`                         | optional | required |
| `ICommandHostMemory`            | `getMemoryStore`                  | optional | required |
|                                 | `getUsedMemoryReferences`         | required | required |
|                                 | `recordMemoryEvent`               | required | required |
| `ICommandHostPlan`              | `approvePlan`                     | optional | required |
|                                 | `getPlanState`                    | optional | required |
|                                 | `revertPlan`                      | optional | required |
|                                 | `setPlan`                         | optional | required |
| `ICommandHostPresetApplication` | `applyCommandModuleSelection`     | optional | required |
|                                 | `applyPersona`                    | optional | required |
|                                 | `applySelfVerification`           | optional | required |
| `ICommandHostSessionAccess`     | `clearConversationHistory`        | optional | required |
|                                 | `getSession`                      | required | required |
|                                 | `validateCurrentSessionReplayLog` | optional | required |
| `ICommandHostTerminalHandoff`   | `canHandoffTerminal`              | optional | required |
|                                 | `runWithTerminal`                 | optional | required |
| `ICommandHostUserInteraction`   | `getUserInteraction`              | optional | required |
| `ICommandHostWorkspace`         | `getCommandInvocationSource`      | optional | required |
|                                 | `getCwd`                          | required | required |

**ICommandSessionRuntime** — 18 members

| role port                      | member                        | before   | after    |
| ------------------------------ | ----------------------------- | -------- | -------- |
| `ICommandSessionContextWindow` | `compact`                     | required | required |
|                                | `getAutoCompactThreshold`     | required | required |
|                                | `getContextState`             | required | required |
|                                | `setAutoCompactThreshold`     | optional | required |
| `ICommandSessionHistory`       | `clearHistory`                | required | required |
|                                | `getFullHistory`              | required | required |
|                                | `getHistory`                  | required | required |
|                                | `getMessageCount`             | required | required |
| `ICommandSessionIdentity`      | `getModelId`                  | optional | required |
|                                | `getSessionId`                | required | required |
|                                | `getSessionTokenUsage`        | optional | required |
| `ICommandSessionModel`         | `applyModelOptions`           | optional | required |
| `ICommandSessionPermissions`   | `getPermissionMode`           | required | required |
|                                | `getSessionAllowedTools`      | required | required |
|                                | `setPermissionMode`           | required | required |
| `ICommandSessionPreset`        | `getActivePresetId`           | optional | required |
|                                | `setActivePresetId`           | optional | required |
|                                | `setParallelSubagentsEnabled` | optional | required |

**IAgentJobHostContext** — 15 members

| role port            | member                     | before   | after    |
| -------------------- | -------------------------- | -------- | -------- |
| `IAgentJobDispatch`  | `cancelAgentJob`           | required | required |
|                      | `closeAgentJob`            | required | required |
|                      | `listAgentDefinitions`     | required | required |
|                      | `listAgentJobs`            | required | required |
|                      | `sendAgentJob`             | required | required |
|                      | `spawnAgentJob`            | required | required |
| `IAgentJobGroups`    | `createBackgroundJobGroup` | required | required |
|                      | `waitBackgroundJobGroup`   | required | required |
| `IAgentJobLogs`      | `readBackgroundTaskLog`    | required | required |
| `IAgentJobMonitors`  | `spawnMonitorWake`         | required | required |
| `IAgentJobSchedules` | `editSchedule`             | required | required |
|                      | `listSchedules`            | required | required |
|                      | `pauseSchedule`            | required | required |
|                      | `resumeSchedule`           | required | required |
|                      | `spawnScheduledWake`       | required | required |

### [SCAN CORRECTION — PRIOR-ART WAIVER] — 2026-08-17

Two gate entries above record that "an explicit `**Waived:** <reason>` line is present, which the
scan accepts". The first half was true and the second half was never checked: `scan-spec-research.mjs`
matches `/(^|\n)\s*Waived:\s*\S/`, which requires the line to BEGIN with the marker. A bolded
`**Waived:**` does not begin with it, so the scan reported this document unsubstantiated the first
time it ran against it — the gate had accepted a claim about a mechanism without running the
mechanism. The marker is now unbolded and `pnpm harness:scan`'s `spec-research` passes.

### [FILE-SIZE BASELINE — WHAT IT LICENSES] — 2026-08-17

`scan-file-size` went red on five files after S3/S4. Recorded here because regenerating a size
baseline is a licence to grow, and a licence taken quietly is indistinguishable from debt.

**Reduced first, by real splits — not by moving the line.**

| file                     | before | after | split                                                                                                 |
| ------------------------ | ------ | ----- | ----------------------------------------------------------------------------------------------------- |
| `host-context.ts`        | 448    | 131   | into `session-roles.ts` (122), `host-roles.ts` (243), `agent-job-roles.ts` (137), along the port seam |
| `command-host-double.ts` | 302    | 227   | `agent-job-host-double.ts` (88) + `double-constants.ts`, same seam                                    |
| `context-command.ts`     | 536    | 306   | `context-breakdown.ts` (266) — the read-only half, which `TContextReadHost` had just named            |
| `interactive-session.ts` | 1018   | 1001  | the TC-08 delegation moved to the base class; a stray blank line and a five-line comment trimmed      |

`context-command.ts` ends **208 lines below** its old frozen 514, and the ratchet is retightened to
306 in the same change — the scan's own instruction, so the gain cannot be spent later.

**The remainder is irreducible, and is what the baseline now records:**

| file                                    | +lines | why no split reduces it                                                                                                                                                                                                           |
| --------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent-framework/src/index.ts`          | +27    | 26 new public names, one line each. These barrels list every export by name — no `export *` appears in any of them — so a sub-barrel still costs one line per name at the top. The names are real exported contracts, not filler. |
| `agent-framework/src/commands/index.ts` | +7     | same, for the ports this barrel forwards                                                                                                                                                                                          |
| `interactive-session-base.ts`           | +11    | one required-member implementation (`validateCurrentSessionReplayLog`) plus its two imports, placed here rather than in `interactive-session.ts` precisely because that file was at its cap                                       |
| `interactive-session.ts`                | +1     | a formatter line                                                                                                                                                                                                                  |

Not claimed: that these four files are now the right size. They are pre-existing monoliths, and this
change made two of them slightly larger while making a third much smaller. What is claimed is that
the growth is new public surface and one contract implementation, that it was minimised by four
splits before the baseline was touched, and that the one file which could be genuinely reduced was
reduced and re-frozen at its new number.

### [MEASUREMENT CORRECTION — THE STARTING NUMBERS WERE WRONG] — 2026-08-17

Independent review re-ran the SHIPPED instruments against the merge-base (`bac03bfcc`). Two of the
numbers reported during implementation, and one in this document, do not reproduce. Reproduced and
confirmed here before being corrected.

| quantity                                          | reported during implementation | re-measured with the shipped instrument  | why they differ                                                                                                                                                                                             |
| ------------------------------------------------- | ------------------------------ | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ICommandHostContext` type-position refs at start | **137**                        | **150** (156 with no allowlist)          | 137 came from the scan BEFORE review found it blind to heritage clauses, and while the allowlist still named a path that does not exist (`command-contracts.ts`). Two instrument defects, both since fixed. |
| cast sites at start                               | **23**                         | **22** (18 + 4)                          | a miscount; the design's own figure of 22 was right and the implementation note was not                                                                                                                     |
| allowlist entries                                 | described as **4**             | **6** at implementation time, now **10** | `system-command-executor.ts` and `interactive-session-skill-router.ts` were added during implementation with reasons in config but no design update; the file split added three declaration sites           |

**This is the exact failure this document warned about**, in its own words: _"the scan's definition
and the recorded baseline must be the same quantity when it is written"_, and _"freezing a number a
different instrument produced is the shape of a floor that cannot fail"_. The commit message for S3
argues that point at length while carrying a number produced by the pre-fix instrument.

What is NOT affected: the END state. `ICommandHostContext` is at **0**, measured by the current
instrument — which now counts heritage clauses, the form that could re-alias all 46 members in one
line — and the zero is falsified by mutation in both directions. The target was always zero, and
zero does not depend on where the count started.

What IS affected: any reading of "137 → 0" as a measured delta. The honest statement is **150 → 0**
against the current instrument, or "the count was never measured with one instrument end to end".
The commit messages already in history are not rewritten; this entry is the correction of record.

### [FILE-SIZE BASELINE — FILED] — 2026-08-17

The `[FILE-SIZE BASELINE]` entry above discussed the three baselined files this change raised and did
not file anything. Review named that omission: the gate's other half is that a licensed increase is
**filed and linked**, not merely explained. Now tracked as **#1806** (`ARCH-038`), which carries the
constraint (`sdk-public-surface` rejects every `export *` form, so a sub-barrel cannot reduce a name
list) and the four splits taken before the baseline was touched.
