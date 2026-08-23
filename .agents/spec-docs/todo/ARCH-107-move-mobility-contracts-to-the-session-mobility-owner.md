---
status: approved
type: DATA
tags: [typescript]
---

# ARCH-107: move peer and handoff contracts to the session-mobility owner

Registered as GitHub issue https://github.com/woojubb/robota/issues/2111.
Parent tracker: issue #2068. Owner map: ARCH-100. Layer rule: ARCH-101, corrected by ARCH-106.

## Problem

**Concrete symptom.** `packages/agent-transport-webrtc` — the browser peer transport — imports
`IPeerMessage`, `isSameEnvironmentPeer` and 19 more peer/handoff contracts from
`@robota-sdk/agent-interface-transport`. Peer messaging between live sessions and handoff of authority
to another machine are not transport adapters.

**Reproduction condition.** Present on every checkout. Wave 3; sixth of seven leaves.

**Measured on `origin/develop` @ `22152ef9d`:** 21 symbols across 3 modules; 4 consumer packages; 24
import statements; **0 MIXED**. The smallest leaf, and the only one with no mixed statement to split.

## Prior Art Research

Waived: answered by ARCH-103's spec-doc (`.agents/spec-docs/done/ARCH-103-…md` § Prior Art Research),
citing Nx's `@nx/workspace:move` for importer-rewrite mechanics and Semantic Versioning 2.0.0 §4/§9
for why a prerelease owes no forwarding alias. This leaf is the same operation at smaller scale.

## Architecture Review Checklist

- [x] Affected package/layer list complete — a new `agent-interface-session-mobility`;
      `agent-interface-transport` loses three modules, their barrel exports **and two layers**; 4
      consumer packages change specifiers.
- [x] Sibling scan complete — the four earlier owners are the precedent. This one sits at **layer 2**,
      the highest in the family: it composes session, which composes the three layer-0 owners.
- [x] At least 2 alternatives considered — see Alternatives Considered.
- [x] Decision rationale documented — see Decision.

**New-surface placement (conditional — APPLIES, one new package):** (a) mirrors the four existing
`agent-interface-*` contract-layer packages, at the top of the family rather than the bottom.
(b) Dependencies are `agent-core` and `agent-interface-session` — a declared **downward** edge under
ARCH-101. No product package is depended on.

## Alternatives Considered

**A — Create the owner at layer 2, move all three modules, rewire, and drop transport to layer 0.**
(chosen)

- Pro: the owner map's target; `agent-interface-transport` finally holds only transport contracts, so
  its name describes its contents for the first time since DATA-001.
- Con: none material at this scale — 24 statements, no mixed ones.

**B — Batch with issue #2113 (narrow transport, delete the omnibus barrel).**

- Pro: both touch the same package, and issue #2113 is what closes the tracker.
- Con: issue #2113's job is to prove the obsolete surface is GONE. Batching means the change that removes
  the last families is also the change that certifies their removal — the certificate and the work in
  one diff, which is exactly the shape a closure gate should not have. Rejected.

## Decision

Adopt **A**.

The trade-off that drove it: B is cheaper and makes the final leaf self-certifying, which is the one
property issue #2113 must not have.

### The layer prediction, written first — and refuted

ARCH-106 promoted an abstract rule after its own author got it wrong. This leaf re-ran the test with
the rule in hand, recording the prediction before any module moved or any guard ran.

|                                    | predicted | measured     |
| ---------------------------------- | --------- | ------------ |
| `agent-interface-session-mobility` | 2         | **2** ✅     |
| `agent-interface-transport`        | **0**     | **2** ❌     |
| every other owner                  | unchanged | unchanged ✅ |

**The rule failed a second time, deliberately applied by the author who wrote it.**

The prediction enumerated transport's contents as the four contract modules. All four are clean. But
the package also holds a **`/testing` subpath**, and `testing/index.ts` imports `IInteractiveSession`
for the `createTestInteractiveSession` double — a real dependency on layer 1.

> The rule says _take the maximum of what it holds_. It does not say **what counts as held.** Both
> failures are in that gap, not in the maximum.

ARCH-106 reasoned from what would stop being held. ARCH-107 enumerated contract modules and forgot a
published subpath. Different mistakes, one omission in the wording.

**Issue #2218's proposed text must change before it lands** — "what it holds" has to name every
published surface: the entry, every subpath, and the doubles.

This is what the pre-registration bought. Had the amendment landed first and this leaf run afterwards,
the wording would have shipped and the failure would have read as an author's error rather than the
rule's. A prediction written after the measurement could not have produced this.

### The guards disagreed, and only the manifest-level one was right

Declaring transport at the predicted 0:

```
[INTERFACE-DEPS] agent-interface-transport (layer 0) → agent-interface-session (layer 1) runs UPWARD
interface-family-owner scan passed — every module edge is a legal downward layer composition
```

`interface-family-owner` projects **mapped contract modules**. `testing/index.ts` is not one, so its
import is outside the projection and the scan is silent about it. The green was accurate about module
edges and said nothing about the package — which is the distinction between the two altitudes ARCH-101
built, working as designed and worth stating so the module-level green is not read as a package-level
one.

## Completion Criteria

- [ ] **TC-01** `packages/agent-interface-session-mobility` exists holding the three modules, with
      production dependencies limited to `agent-core` and `agent-interface-session`.
- [ ] **TC-02** `agent-interface-transport`'s barrel exports none of the 21, and no forwarding
      re-export is added.
- [ ] **TC-03** All 4 consumer packages import them from
      `@robota-sdk/agent-interface-session-mobility`.
- [ ] **TC-04** `agent-interface-transport` stays at **layer 2** — the predicted 0 is refuted by
      `check-dependency-direction.mjs`, because its `/testing` subpath imports a layer-1 type. The
      prediction and its refutation are recorded rather than quietly corrected.
- [ ] **TC-05** `pnpm harness:scan` exits 0 and `pnpm harness:verify-like-ci` reports green.

## Test Plan

| TC    | Test Type   | Tool / Approach                                                           | Notes                                          |
| ----- | ----------- | ------------------------------------------------------------------------- | ---------------------------------------------- |
| TC-01 | Structural  | Read the new manifest; `deps` asserts the edge is a declared downward one | —                                              |
| TC-02 | Structural  | Diff the transport barrel; assert none of the 21 remains                  | —                                              |
| TC-03 | Compilation | Workspace `pnpm typecheck` — a missed rewrite fails to resolve            | Type-level move: the compiler is the assertion |
| TC-04 | Gate        | `node scripts/harness/scan-interface-family-owner.mjs`; read the commit   | Separate commit, per the ARCH-106 precedent    |
| TC-05 | Gate        | `pnpm harness:scan`; `pnpm harness:verify-like-ci`                        | manual invocation — reported last              |

## User Execution Test Scenarios

**Not applicable — this task delivers no user-facing behavior.** It relocates type declarations
between packages; every moved declaration is a type or a discriminator erased or inert at runtime. The
verification surface is the workspace typecheck, the harness gate, and the 4 consumer packages' suites.

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-08-23

**Status upgrade:** draft → review-ready
**Judged by:** self-assessment against `.agents/specs/gate-catalogue.md` § GATE-WRITE.

- Frontmatter: `status: draft`, `type: DATA`, `tags: [typescript]`; frontmatter scan exits 0.
- Problem — concrete symptom with a named package and named symbols; figures measured at `22152ef9d`.
- Prior Art Research: explicit `Waived:` naming ARCH-103's citations; `scan-spec-research` accepts it.
- Architecture Review Checklist: all 4 `[x]`; sibling scan names the four precedents and how this one
  differs — layer 2, the highest in the family.
- New-surface placement (conditional — APPLIES): (a) mirrors the existing contract-layer packages;
  (b) `agent-core` plus one declared downward interface edge.
- Alternatives Considered: 2 entries with Pro and Con; B rejected on a property rather than a cost —
  batching would make the closure leaf certify its own work.
- Decision: names the trade-off, and records the layer prediction **written before the work** with its
  measured outcome.
- Completion Criteria: 5 items, all `TC-N`, command or observable-behavior form.
- Test Plan: 5 rows for 5 TCs, each with Test Type and Tool/Approach.
- `## User Execution Test Scenarios` present with an explicit not-applicable and its reason.

### [GATE-APPROVAL] — ✅ PASS | 2026-08-23

**Status upgrade:** review-ready → approved

Passed on the standing delegation recorded in ARCH-100's spec-doc, in RULE-012's three-part form. The
provenance limit recorded there applies unchanged.

**1 — The delegation.** As recorded in ARCH-100, corroborated in-repo by
`.agents/tasks/completed/RULE-012-…md` § Evidence.

**2 — The evidence condition is satisfied**, and this leaf strengthens it: the layer claim was
recorded as a falsifiable prediction before any measurement, together with the specific way it could
be unfounded, and then checked. That is a stronger form of "근거가 타당하면" than a measurement taken
after the fact, because it could have come out wrong.

**3 — The item is inside the delegated class.** It relocates type declarations, moves no runtime
value, changes no shipped behavior. The two things that could take it outside were settled before this
leaf: the transport barrel losing 21 exports is ARCH-100's merged decision under the owner's
「레거시는 고려하지 마세요」 ruling, and the `mobility(2) → session(1)` edge is a declared downward
edge under ARCH-101.

The layer change to 0 is not a new decision either — it is the state ARCH-106's corrected rule
predicts once mobility leaves, and it is separated into its own commit so it stays reviewable as a
decision.

### [GATE-COMPLETE] — 🔴 NON-COMPLIANCE | 2026-08-24

**Status remains:** approved

**Violation:** The ordering check failed on both of its parts, so GATE-COMPLETE's own criteria were not
evaluated.

- **Missing prior gate.** The gate catalogue's prior-gate map requires **GATE-VERIFY = PASS** before
  GATE-COMPLETE. The Evidence Log above holds exactly two entries — `[GATE-WRITE]` and
  `[GATE-APPROVAL]`. There is no `[GATE-IMPLEMENT]` entry and no `[GATE-VERIFY]` entry. Two gates are
  missing, not one.
- **Wrong input state.** GATE-COMPLETE expects `status: verifying` in `.agents/spec-docs/active/`. This
  document is `status: approved` in `.agents/spec-docs/todo/`. Status and folder agree with each other,
  but they are the state expected as _input to GATE-IMPLEMENT_ — two transitions upstream.

**Work this gate never authorized has already shipped.** Verified in-tree, not taken on report:

- `packages/agent-interface-session-mobility` exists on `origin/develop`.
- `4ed80522b feat(interface): move mobility contracts to the session-mobility owner (ARCH-107) (#2220)`
  is merged.
- A dependent follow-on leaf is merged on top of it:
  `c1dd93768 refactor(interface): narrow the transport owner to what it owns (ARCH-108) (#2244)`.

GATE-IMPLEMENT is the verdict that implementation may **start**. It was never run, and the
implementation has since merged — which is the `NON-COMPLIANCE trigger` named under GATE-APPROVAL
("implementation work was started before this gate ran") applied to the gate after it.

**The missing gates are outside this gate's remit.** GATE-COMPLETE judges TC-N verification evidence
against a document that GATE-VERIFY has already passed. It cannot stand in for GATE-IMPLEMENT or
GATE-VERIFY, and it cannot authorize retroactively: a PASS recorded here would not be a judgement of
those two gates, it would be a **backdating** of them — writing `verifying → done` over a document that
never entered `in-progress`. That is the one thing a gate must never do, so this halts here.

**Paired task record contradicts completion** (judged as this working tree holds it, unmodified —
`git status` reports it clean): `.agents/tasks/ARCH-107-move-mobility-contracts-to-the-session-mobility-owner.md`
is `status: in-progress` with **0 of 4 tasks checked**. An uncommitted change in a different clone is
not evidence in this one.

**Incidental, not the deciding basis** (recorded so a later run does not read this entry as clearing
them): the spec has **no `## Tasks` section at all**, so no active task path is named; all 5 TC-N
boxes are `[ ]`; and there are **0** `[GATE-COMPLETE: TC-N]` entries. Each is independently fatal to
GATE-COMPLETE, but none was reached — the ordering check decided this run.

**Required action:** Not resolvable by re-running this gate, and not by editing this document. The
gap between the recorded pipeline state and the merged tree is a process breach that needs an owner
decision — reconstruct the skipped GATE-IMPLEMENT/GATE-VERIFY record against the merged commit, or
close this item out under the Rejection Action. Routing that decision belongs to the orchestrator,
not to this guardian.
