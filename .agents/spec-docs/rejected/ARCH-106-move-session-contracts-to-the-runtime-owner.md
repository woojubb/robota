---
status: rejected
type: DATA
tags: [typescript]
---

# ARCH-106: move session, interaction, event and persistence contracts to the runtime owner

Registered as GitHub issue https://github.com/woojubb/robota/issues/2110.
Parent tracker: issue #2068. Owner map: ARCH-100. Layer rule: ARCH-101.

## Problem

**Concrete symptom.** `packages/agent-session` — the package that owns interactive sessions — imports
`IInteractiveSession`, `IInteractiveSessionRecord`, `IInteractiveSessionStore` and 82 more of its own
domain's contracts from `@robota-sdk/agent-interface-transport`, across 16 files. `agent-framework`
does the same across 62.

**Reproduction condition.** Present on every checkout. This is wave 2 of the owner map; wave 1
completed with ARCH-103, ARCH-104 and ARCH-105.

**Measured on `origin/develop` @ `c621e4d49`:** 85 symbols across 8 modules; 15 consumer packages;
219 import statements; **38 of them MIXED**.

The earlier figure carried in the tracker — 212 statements, one module — was three leaves stale and
understated the module count by seven. Re-measuring rather than reusing is the shelf-life lesson
issue #2215 records.

## Prior Art Research

Waived: the prior-art question for a contract relocation under this owner map was answered by
ARCH-103's spec-doc (`.agents/spec-docs/done/ARCH-103-…md` § Prior Art Research), citing Nx's
`@nx/workspace:move` for the importer-rewrite mechanics and Semantic Versioning 2.0.0 §4/§9 for why a
prerelease owes no forwarding alias. Both apply unchanged; this leaf differs only in scale.

## Architecture Review Checklist

- [x] Affected package/layer list complete — a new `agent-interface-session`;
      `agent-interface-transport` loses eight modules, their barrel exports **and a layer**; 15
      consumer packages change specifiers.
- [x] Sibling scan complete — `agent-interface-execution` (ARCH-103), `agent-interface-command`
      (ARCH-104) and `agent-interface-analytics` (ARCH-105) are the precedents. Unlike all three, this
      package sits at **layer 1**, not layer 0: it composes the other three downward.
- [x] At least 2 alternatives considered — see Alternatives Considered.
- [x] Decision rationale documented — see Decision.

**New-surface placement (conditional — APPLIES, one new package):** (a) it mirrors the three wave-1
contract-layer packages — declarations only, no runtime mechanism — but at layer 1, composing them.
(b) Reuse is at the shared contract/core level: its dependencies are `agent-core` plus the three
layer-0 interface packages it names, every one a **declared downward edge** under ARCH-101. No product
package is depended on.

## Alternatives Considered

**A — Create the owner at layer 1, move all eight modules, rewire in one change.** (chosen)

- Pro: the owner map's target, reached directly; the tree is never half-migrated; the transport
  package becomes what its name says at a single identifiable commit.
- Con: the largest diff of the programme — 219 statements, 38 of them requiring a hand-checkable
  split.

**B — Batch with issue #2111 (mobility).**

- Pro: one migration instead of two over the same package; mobility is only three modules.
- Con: mobility sits at **layer 2 and depends on session**. Batching buries a layer-2 → layer-1 edge
  inside a 219-statement diff, where nobody reviewing the split would see it. The tracker's own rule
  makes each leaf independently mergeable, and the reason is exactly this. Rejected.

## Decision

Adopt **A**, in three commits rather than one.

The trade-off that drove it: this leaf is overwhelmingly mechanical, and **the two things in it that
are not mechanical would be invisible inside the mechanical part.** So they are separated:

1. **The package and the module move** — mechanical, verifiable by the compiler.
2. **The 38 mixed-statement splits** — mechanical but _not_ verifiable by the compiler, for the
   reason below.
3. **The layer change**, `agent-interface-transport` 1 → 0 — a decision, in its own commit with its
   own reasoning. A layer change buried in a 219-statement diff is a decision nobody will find when
   they need to question it.

### The split rule, written before any statement is split

**A green build after a mixed-statement split is the weakest possible evidence**, because a wrong
split still compiles whenever both packages export the name. So the rule is recorded first and the
result is checked against the rule, not against compilation.

1. **A symbol MOVES if and only if it is declared by one of the eight modules this leaf relocates.**
2. Membership is decided by reading the **declaration** in the moving module's source — not by name
   shape, not by what the transport barrel re-exports, not by which package exports the name
   afterwards.
3. All-moving statements change specifier whole.
4. Mixed statements become **two statements**; no symbol changes its name, its `type` modifier, or
   its alias.
5. Statements with no moving symbol are left byte-identical.

**Checks that do not depend on the build:**

- every moved symbol resolves to a declaration in the new package, asserted against the new barrel;
- **no name is exported by both packages' barrels** — that is the condition under which a wrong split
  compiles, so it is checked directly rather than assumed absent;
- the moved-symbol count equals the 85 the eight modules declare — 84 or 86 is wrong even if green;
- each rewritten statement's symbol multiset equals the original's.

The build passing is necessary and is reported last.

## Completion Criteria

- [ ] **TC-01** `packages/agent-interface-session` exists holding the eight modules, with production
      dependencies limited to `agent-core` and layer-0 `agent-interface-*` packages.
- [ ] **TC-02** Its barrel exports all 85 symbols; **no name is exported by both** its barrel and
      `agent-interface-transport`'s.
- [ ] **TC-03** `agent-interface-transport`'s barrel exports none of the 85, and no forwarding
      re-export is added anywhere.
- [ ] **TC-04** All 15 consumer packages import them from `@robota-sdk/agent-interface-session`; each
      of the 38 mixed statements satisfies the recorded split rule, checked against the rule.
- [ ] **TC-05** `agent-interface-transport` is declared at layer 0 in the owner map, in a separate
      commit, and `interface-family-owner` accepts the resulting graph.
- [ ] **TC-06** `pnpm harness:scan` exits 0 and `pnpm harness:verify-like-ci` reports green.

## Test Plan

| TC    | Test Type        | Tool / Approach                                                                         | Notes                                                              |
| ----- | ---------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| TC-01 | Structural       | Read the new manifest; `deps` asserts every edge is a declared downward one             | —                                                                  |
| TC-02 | Rule conformance | Script: intersect both barrels' export lists; assert empty                              | The overlap is what makes a wrong split compile, so it is asserted |
| TC-03 | Structural       | Diff the transport barrel; assert none of the 85 remains                                | —                                                                  |
| TC-04 | Rule conformance | Script: per rewritten statement, compare symbol multiset and specifier against the rule | Deliberately independent of compilation — see Decision             |
| TC-05 | Gate             | `node scripts/harness/scan-interface-family-owner.mjs`; read the separate commit        | —                                                                  |
| TC-06 | Gate             | `pnpm harness:scan`; `pnpm harness:verify-like-ci`                                      | manual invocation — reported last, as a necessary condition        |

## User Execution Test Scenarios

**Not applicable — this task delivers no user-facing behavior.** It relocates type declarations
between packages. No runtime value, function signature, CLI surface, file format or observable
behavior changes; every moved declaration is a type erased at build time.

The verification surface is the rule-conformance checks above, the workspace typecheck, the harness
gate, and the 15 consumer packages' own suites.

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-08-23

**Status upgrade:** draft → review-ready
**Judged by:** self-assessment against `.agents/specs/gate-catalogue.md` § GATE-WRITE.

- Frontmatter: `status: draft`, `type: DATA`, `tags: [typescript]`; frontmatter scan exits 0.
- Problem — concrete symptom with named packages, named symbols and file counts; figures measured at
  `c621e4d49` and the stale prior figure named as stale.
- Prior Art Research: explicit `Waived:` naming ARCH-103's citations; `scan-spec-research` accepts it.
- Architecture Review Checklist: all 4 `[x]`; sibling scan names the three precedents and the way this
  package differs from all of them — layer 1, composing them.
- New-surface placement (conditional — APPLIES): (a) mirrors the wave-1 contract-layer packages at a
  higher layer; (b) dependencies are `agent-core` plus declared downward interface edges only.
- Alternatives Considered: 2 entries with Pro and Con; B carries the concrete cost — a layer-2 edge
  hidden inside a 219-statement diff.
- Decision: names the driving trade-off and splits the leaf into three commits on the principle that
  the non-mechanical parts would be invisible inside the mechanical part.
- **The split rule is recorded BEFORE the work**, with checks that do not depend on compilation, and
  states why: a wrong split still compiles whenever both packages export the name.
- Completion Criteria: 6 items, all `TC-N`, command or observable-behavior form.
- Test Plan: 6 rows for 6 TCs; TC-02 and TC-04 are rule-conformance rather than gates, and say so.
- `## User Execution Test Scenarios` present with an explicit not-applicable and its reason.

### [GATE-APPROVAL] — ✅ PASS | 2026-08-23

**Status upgrade:** review-ready → approved

Passed on the standing delegation recorded in ARCH-100's spec-doc, in RULE-012's three-part form. The
provenance limit recorded there applies unchanged; see
`.agents/spec-docs/done/ARCH-100-contract-family-owner-map-and-acyclic-target-graph.md` §
GATE-APPROVAL.

**1 — The delegation.** As recorded in ARCH-100, corroborated in-repo by
`.agents/tasks/completed/RULE-012-…md` § Evidence.

**2 — The evidence condition is satisfied**, and re-measured rather than inherited: the tracker's
212-statement figure was three leaves stale, understated the module count by seven, and did not
measure the mixed statements at all — which are the actual risk.

**3 — The item is inside the delegated class.** It relocates type declarations, moves no runtime
value, changes no shipped behavior. The two things that could take it outside were settled before
this leaf:

- **Public surface.** The transport barrel loses 85 exports, but the owner map relocating them is
  ARCH-100's merged decision, and the owner ruled 「레거시는 고려하지 마세요. 아직 출시 전입니다」
  (`code-quality.md:59`) on forwarding aliases. No symbol leaves the family; each moves to its owner.
- **The layer change.** `agent-interface-transport` 1 → 0 is not a new decision: ARCH-104 promoted
  "a layer declares where a package IS, not where it is going" to a named rule in the owner map, and
  this leaf is the change that makes layer 0 true of that package. It is separated into its own commit
  so it is reviewable as a decision rather than as diff noise.

Nothing here decides which family belongs to which owner — that is ARCH-100's, merged and unchanged.

### [GATE-COMPLETE] — 🔴 NON-COMPLIANCE | 2026-08-24

**Status remains:** approved (`.agents/spec-docs/todo/`)
**Violation:** Ordering check failed on both halves, so this gate's own criteria were not reached.

- **Missing prior gate.** `gate-catalogue.md` § Prior-gate map requires GATE-VERIFY PASS before
  GATE-COMPLETE. The Evidence Log records exactly two entries — `[GATE-WRITE]` (2026-08-23) and
  `[GATE-APPROVAL]` (2026-08-23). There is no `[GATE-IMPLEMENT]` entry and no `[GATE-VERIFY]` entry.
  Two gates, not one, are absent.
- **Wrong input state.** GATE-COMPLETE expects `verifying` / `active/`. Frontmatter reads
  `status: approved` and the file sits in `todo/` — the state GATE-APPROVAL leaves behind, i.e. the
  document never entered implementation on the record.
- **Work this gate chain was to authorize has already shipped.** `packages/agent-interface-session`
  exists on `develop`; commit `22152ef9d` "feat(interface): move session contracts to the runtime
  owner (ARCH-106)" (PR #2217, 2026-08-23) is an ancestor of HEAD, and `4ed80522b` (ARCH-107, PR #2220)
  already builds on it. GATE-IMPLEMENT is the verdict that implementation may _start_; issuing it
  after the merge would be backdating, not judging. It is outside GATE-COMPLETE's remit either way —
  a guardian applies one gate per run and cannot supply a predecessor's verdict.
- **Corroborating tree state (not the deciding finding).** The paired task, now archived at
  `.agents/tasks/completed/ARCH-106-move-session-contracts-to-the-runtime-owner.md`, was
  `status: in-progress` with 0 of 5 checklist items `[x]` at the time; the spec has no `## Tasks`
  section at all, so no task path is
  recorded where GATE-IMPLEMENT requires it; all six TC-N boxes are `[ ]` and the log holds zero
  `[GATE-COMPLETE: TC-N]` entries. Judged against this working tree only; an uncommitted change in
  another clone is not evidence here.

**Required action:** Not a re-run of this gate. The pipeline owner must reconcile the record with the
merged reality — decide whether ARCH-106 is closed out by a retrospective correction that is labelled
as one (never a PASS-shaped GATE-IMPLEMENT entry dated after `22152ef9d`), or rejected and re-filed.
Only once the document legitimately reads `verifying` with a GATE-VERIFY PASS may GATE-COMPLETE be
invoked. No status change, no folder move and no content fix was made by this run.

### [REJECTION] — 2026-08-28

This planning document is deliberately rejected rather than retroactively promoted: PR #2217
(`22152ef9d`) merged the implementation before a valid pre-implementation GATE-IMPLEMENT checkpoint
and before GATE-VERIFY. The earlier GATE-APPROVAL entry is preserved verbatim as historical evidence;
this rejection records that it cannot authorize an implementation that had already landed. The
delivered work remains recorded by the completed Task at
`.agents/tasks/completed/ARCH-106-move-session-contracts-to-the-runtime-owner.md`; rejection closes
the bypassed plan without manufacturing historical gate verdicts.
