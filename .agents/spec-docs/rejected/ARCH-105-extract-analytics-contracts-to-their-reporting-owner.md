---
status: rejected
type: DATA
tags: [typescript]
---

# ARCH-105: extract analytics and usage contracts to their reporting owner

Registered as GitHub issue https://github.com/woojubb/robota/issues/2112.
Parent tracker: issue #2068. Owner map: ARCH-100. Layer rule: ARCH-101.

## Problem

**Concrete symptom.** `packages/agent-session-analytics` — the package that assembles usage and trace
reports — imports `IUsageBySourceReport`, `IUsageSourceTotals` and `IRunTraceTurn` from
`@robota-sdk/agent-interface-transport`, where they are declared inside `session-contracts.ts`.

**This leaf is a file SPLIT, and that is the whole difficulty.** ARCH-103 and ARCH-104 each `git mv`'d
whole modules. Here there is **no `analytics-contracts.ts` to move** — the seven declarations sit in
the middle of a 471-line file that stays behind. The owner map records this: family boundaries and
file boundaries do not coincide, and a file-level plan for this leaf does nothing at all.

**Reproduction condition.** Present on every checkout; the last of the three wave-1 leaves.

**Measured on `origin/develop` @ `0c9c9fd59`:** 7 symbols; 4 consumer packages; 10 import statements;
3 of them MIXED. An order of magnitude smaller than ARCH-104 (9 / 110 / 12) — **the risk is the
operation, not the volume.**

## Prior Art Research

Waived: the prior-art question for a contract relocation under this owner map was answered by
ARCH-103's spec-doc (`.agents/spec-docs/done/ARCH-103-…md` § Prior Art Research), citing Nx's
`@nx/workspace:move` for the importer-rewrite mechanics and Semantic Versioning 2.0.0 §4/§9 for why a
prerelease owes no forwarding alias. Both apply unchanged.

The one thing this leaf does that those did not — splitting declarations out of a file rather than
moving the file — raises no new external question: it is the same relocation with a different unit,
and the mechanics are `git`'s and the compiler's rather than a tool's.

## Architecture Review Checklist

- [x] Affected package/layer list complete — a new `agent-interface-analytics`;
      `agent-interface-transport` loses seven declarations from `session-contracts.ts` and their
      barrel exports; `turn-contracts.ts` re-points one import; 4 consumer packages change specifiers.
- [x] Sibling scan complete — `agent-interface-execution` (ARCH-103) and `agent-interface-command`
      (ARCH-104) are the direct precedents and the template. `interface-runtime`,
      `interface-imports` and `interface-family-owner` police the result; the last of these is the one
      that treats the analytics family as `symbols@session-contracts` rather than a module, which is
      exactly the case this leaf executes.
- [x] At least 2 alternatives considered — see Alternatives Considered.
- [x] Decision rationale documented — see Decision.

**New-surface placement (conditional — APPLIES, one new package):** (a) it mirrors
`agent-interface-execution` and `agent-interface-command`, `agent-interface-*` **contract layer**
packages — declarations only, no runtime mechanism. Contract-layer packages are not a product family.
(b) Reuse is at the shared contract/core level: manifest dependencies are `{}` — it needs nothing at
all, not even `agent-core` — at layer 0 with no peer edge. Its layer is declared in
`.agents/specs/contract-family-owner-map.md` per ARCH-101.

## Alternatives Considered

**A — Extract the seven declarations into a new package; `session-contracts.ts` stays.** (chosen)

- Pro: the owner map's stated target, and the only option that separates the family. The extraction is
  verifiably clean — every field of the seven is a primitive or another member of the set.
- Con: a hand-edited split of a file two other packages import from, rather than a `git mv` the tool
  performs. The move is not recorded as a rename, so `git` shows it as a deletion plus an addition and
  a reviewer cannot diff it as a move.

**B — Move `session-contracts.ts` wholesale to the analytics owner.**

- Pro: a `git mv`, with rename detection and a trivially reviewable diff.
- Con: it takes the **entire session family** — `IInteractiveSession`, the capability slices, the goal
  and plan contracts, ~40 more declarations — into a package named for analytics. That is
  issue #2110's work under a different owner, and it would put the session family in the wrong place to get
  an easier diff. Rejected.

## Decision

Adopt **A**.

The trade-off that drove it: B is genuinely easier to review and produces the wrong architecture. The
whole reason this family is a separate leaf is that its boundary does not follow the file, and
choosing the unit that makes the diff readable would relocate forty unrelated declarations to avoid a
hand edit.

**What makes A safe is a measurement, not confidence.** The seven are self-contained: `source?:
IUsageSource`, `spans: IRunTraceSpan[]`, `bySource: IUsageSourceTotals[]`, `timeline:
IRunTraceTurn[]` — every field is a primitive or another member of the set.

That was worth checking rather than assuming, because a first pass reported six outside types —
`IExecutionOrigin`, `IHistoryEntry`, `IInteractiveSessionRecord`, `ISpanCompletionEventData`,
`TServerMessage`, `TUI`. **All six are comment mentions** explaining how the record-side projection
relates to the framework's event. A scan that does not separate a field position from a doc comment
reports this extraction as entangled when it is not, and the answer would have been to abandon a
correct plan.

**The new package needs no dependencies at all** — not even `agent-core`. Every field is a primitive
or internal. That makes it the only contract package in the family with an empty dependency set, and
it is worth stating rather than defaulting `agent-core` in because the template had it.

## Completion Criteria

- [ ] **TC-01** `packages/agent-interface-analytics` exists holding the seven declarations, with an
      **empty** production dependency set.
- [ ] **TC-02** `session-contracts.ts` no longer declares any of the seven and imports the ones it
      still references from the new package.
- [ ] **TC-03** `agent-interface-transport`'s barrel exports none of the seven, and no forwarding
      re-export is added anywhere.
- [ ] **TC-04** All 4 consumer packages import them from `@robota-sdk/agent-interface-analytics`;
      each of the 3 mixed statements is split so only moving symbols change specifier.
- [ ] **TC-05** `interface-family-owner` accepts the layer graph with
      `transport(1) → analytics(0)` as a downward edge.
- [ ] **TC-06** `pnpm harness:scan` exits 0 and `pnpm harness:verify-like-ci` reports green.

## Test Plan

| TC    | Test Type   | Tool / Approach                                                              | Notes                                                             |
| ----- | ----------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| TC-01 | Structural  | Read the new manifest; `deps` and `dep-kind` assert the dependency set       | The empty set is the assertion, not an omission                   |
| TC-02 | Structural  | Grep `session-contracts.ts` for the seven declarations; assert none remains  | —                                                                 |
| TC-03 | Structural  | Diff the transport barrel; assert none of the seven remains                  | —                                                                 |
| TC-04 | Compilation | Workspace `pnpm typecheck` — a missed or over-eager rewrite fails to resolve | Type-level move: the compiler is the assertion                    |
| TC-05 | Gate        | `node scripts/harness/scan-interface-family-owner.mjs`                       | —                                                                 |
| TC-06 | Gate        | `pnpm harness:scan`; `pnpm harness:verify-like-ci`                           | manual invocation — `verify-like-ci` is the CI-mirror entry point |

## User Execution Test Scenarios

**Not applicable — this task delivers no user-facing behavior.** It relocates type declarations
between packages. No runtime value, function signature, CLI surface, file format or observable
behavior changes; every moved declaration is a type erased at build time.

The verification surface is the workspace typecheck, the harness gate, and the 4 consumer packages'
own suites, recorded in the Test Plan above.

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-08-23

**Status upgrade:** draft → review-ready
**Judged by:** self-assessment against `.agents/specs/gate-catalogue.md` § GATE-WRITE. Not a
`backlog-gate-guard` verdict.

- Frontmatter: `status: draft`, `type: DATA`, `tags: [typescript]`; frontmatter scan exits 0.
- Problem — concrete symptom: a named package importing three named types from a file inside a
  transport-named package, with the measured scope beside it.
- Problem — states the difficulty that distinguishes this leaf: there is no file to move.
- Problem — figures measured at `0c9c9fd59`, not carried forward from ARCH-100's earlier count.
- Prior Art Research: explicit `Waived:` naming ARCH-103's citations and stating why the one novel
  aspect raises no new external question. `scan-spec-research` accepts it.
- Architecture Review Checklist: all 4 `[x]`; sibling scan names both precedents and the three scans
  that police the result, including that `interface-family-owner` already models this family as
  `symbols@session-contracts`.
- New-surface placement (conditional — APPLIES): (a) mirrors the two sibling contract-layer packages;
  (b) empty dependency set, layer 0, no peer edge.
- Alternatives Considered: 2 entries with Pro and Con; B carries the concrete cost — forty unrelated
  declarations relocated to buy a readable diff.
- Decision: names the driving trade-off and, more usefully, records that the safety of A rests on a
  measurement that nearly read the other way — six apparent outside references that are all comments.
- Completion Criteria: 6 items, all `TC-N`, command or observable-behavior form.
- Test Plan: 6 rows for 6 TCs, each with Test Type and Tool/Approach; TC-01 notes that the empty
  dependency set is an assertion rather than an omission.
- `## User Execution Test Scenarios` present with an explicit not-applicable and its reason.

### [GATE-APPROVAL] — ✅ PASS | 2026-08-23

**Status upgrade:** review-ready → approved

Passed on the standing delegation recorded in ARCH-100's spec-doc, in RULE-012's three-part form. The
provenance limit recorded there applies unchanged; see
`.agents/spec-docs/done/ARCH-100-contract-family-owner-map-and-acyclic-target-graph.md` §
GATE-APPROVAL.

**1 — The delegation.** As recorded in ARCH-100, corroborated in-repo by
`.agents/tasks/completed/RULE-012-…md` § Evidence.

**2 — The evidence condition is satisfied**, and the check that mattered was the one that could have
gone the other way: the seven declarations were verified self-contained by reading FIELD positions,
after a naive pass over the block reported six outside types that turned out to be comment mentions.
An extraction plan approved on the naive reading would have been abandoned as entangled.

**3 — The item is inside the delegated class.** It relocates type declarations, moves no runtime
value, and changes no shipped behavior. The two things that could take it outside were settled
before this leaf:

- **Public surface.** The transport barrel loses seven exports, but the owner map relocating them is
  ARCH-100's merged decision, and the owner ruled 「레거시는 고려하지 마세요. 아직 출시 전입니다」
  (`code-quality.md:59`) on forwarding aliases. No surface is removed from the family — every symbol
  remains exported, from its owner.
- **The interface→interface edge.** `transport(1) → analytics(0)` is a declared downward edge under
  ARCH-101.

Nothing here decides which family belongs to which owner — that is ARCH-100's, merged and unchanged.

### [GATE-COMPLETE] — 🔴 NON-COMPLIANCE | 2026-08-24

**Status remains:** approved

**Violation:** The ordering check for GATE-COMPLETE fails on both halves, and the work this pipeline
was supposed to authorize has already shipped.

- **Missing prior gate.** `gate-catalogue.md` § Prior-gate map requires GATE-VERIFY to show PASS
  before GATE-COMPLETE runs. This Evidence Log contains exactly two entries — `[GATE-WRITE] ✅ PASS |
2026-08-23` and `[GATE-APPROVAL] ✅ PASS | 2026-08-23`. There is no GATE-VERIFY entry, and no
  GATE-IMPLEMENT entry either, so the missing predecessor is itself missing a predecessor.
- **Wrong input state.** The gate expects `verifying` / `active/`. Frontmatter reads `status:
approved` and the file sits in `.agents/spec-docs/todo/` — the state GATE-APPROVAL left it in, two
  transitions back.
- **Work already performed without its authorizing gate.** GATE-IMPLEMENT is the verdict that
  implementation may _start_. Implementation is merged: `c621e4d49` ("feat(interface): extract
  analytics contracts to their reporting owner (ARCH-105)" (PR #2214), 2026-08-23), verified an ancestor
  of HEAD, creating `packages/agent-interface-analytics/` (`src/usage-contracts.ts`, 123 lines),
  removing 111 lines from `packages/agent-interface-transport/src/session-contracts.ts` and 7 barrel
  exports from its `src/index.ts`, and rewiring 4 consumer packages. A gate that authorizes a start
  cannot be recorded after the finish; that entry would be a backdate, not a judgement.

**Not adjudicated:** GATE-COMPLETE's own criteria were deliberately not evaluated, per the
guardian ordering rule (evaluate ordering first; on failure, name the missing gate and stop). For the
record, two of them are independently observable and would not have carried a PASS: all six TC-01…
TC-06 boxes in `## Completion Criteria` are unchecked `[ ]` with no `[GATE-COMPLETE: TC-N]` evidence
entries, and the spec has no `## Tasks` section at all (section list: Problem, Prior Art Research,
Architecture Review Checklist, Alternatives Considered, Decision, Completion Criteria, Test Plan,
User Execution Test Scenarios, Evidence Log), so no active task path is named.

**Working-tree note:** the paired task record, now archived at
`.agents/tasks/completed/ARCH-105-extract-analytics-contracts-to-their-reporting-owner.md`, read
`status: in-progress` with 0 of 5 completion criteria checked at the time, and
`git status --porcelain` reported it clean.
An uncommitted change in another clone is not evidence available to this gate.

**Required action:** Not this guardian's call to sequence, but the record cannot be repaired by
re-running GATE-COMPLETE. The pipeline owner must decide how a spec whose implementation merged ahead
of its GATE-IMPLEMENT verdict is reconciled — the choice is between a recorded, dated
out-of-order-execution finding that the later gates then judge against the shipped state, and
rejection of the spec document — per `spec-workflow.md` HARD GATE and
`backlog-execution-orchestrator` Phase 5.

### [REJECTION] — 2026-08-28

This planning document is deliberately rejected rather than retroactively promoted: PR #2214
(`c621e4d49`) merged the implementation before a valid pre-implementation GATE-IMPLEMENT checkpoint
and before GATE-VERIFY. The earlier GATE-APPROVAL entry is preserved verbatim as historical evidence;
this rejection records that it cannot authorize an implementation that had already landed. The
delivered work remains recorded by the completed Task at
`.agents/tasks/completed/ARCH-105-extract-analytics-contracts-to-their-reporting-owner.md`; rejection
closes the bypassed plan without manufacturing historical gate verdicts.
