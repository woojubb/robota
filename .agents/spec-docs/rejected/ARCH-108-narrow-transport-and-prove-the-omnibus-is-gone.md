---
status: rejected
type: DATA
tags: [typescript]
---

# ARCH-108: narrow the transport owner and prove the omnibus surface is gone

Registered as GitHub issue https://github.com/woojubb/robota/issues/2113.
Parent tracker: issue #2068. **The closure leaf** — seventh of seven.

## Problem

**Concrete symptom.** `agent-interface-transport` is declared at **layer 2**, above the session family
it no longer holds. Its four contract modules are clean — each imports only `@robota-sdk/agent-core` —
but `src/testing/index.ts` imports `IInteractiveSession` for `createTestInteractiveSession`, a double
for a contract this package does not own.

**Reproduction condition.** Present since ARCH-106 moved the session family out.

**This leaf differs in kind from the six before it.** Those moved symbols. This one must _prove_ the
migration finished, and issue #2113's closure rule says a partially migrated state does not satisfy
the tracker.

## Prior Art Research

Waived: the relocation mechanics were answered by ARCH-103's spec-doc
(`.agents/spec-docs/done/ARCH-103-…md` § Prior Art Research). The novel part of this leaf is a
_proof of absence_ rather than a move, and its method is drawn from evidence measured inside this
repository — issue #2221's finding that a symbol can be absent from a barrel and still reachable — not
from an external source.

## Architecture Review Checklist

- [x] Affected package/layer list complete — `createTestInteractiveSession` moves from
      `agent-interface-transport/testing` to `agent-interface-session/testing`; transport drops to
      layer 0; 9 consumer packages change one import specifier.
- [x] Sibling scan complete — `runTransportLifecycleConformance` stays: it doubles the transport
      lifecycle contract, which this package owns. The two doubles were in one subpath by history, not
      by ownership.
- [x] At least 2 alternatives considered — see Alternatives Considered.
- [x] Decision rationale documented — see Decision.

**New-surface placement:** N/A — no new package. One double changes owner; one layer declaration
changes.

## Alternatives Considered

**A — Move the double to the package that owns the contract it doubles; transport reaches layer 0.**
(chosen)

- Pro: `.agents/project-structure.md:314` states the convention directly —
  `contracts→agent-interface-*, doubles→owner /testing`. It also removes the last cross-package edge
  from transport, which is what layer 0 means.
- Con: 42 statements across 9 packages change a published subpath specifier.

**B — Leave the double; declare transport layer 2 permanently.**

- Pro: no consumer churn.
- Con: the package would sit above a family it does not own, forever, because of one test helper. And
  the double would live in a package that must track another package's contract to stay correct —
  the coupling this decomposition exists to remove, surviving in the one place nobody looks.

## Decision

Adopt **A**, and record that **the rule decided it, not the argument.**

The ownership argument came first — a double is part of a contract's surface, so a package that cannot
ship its own double cannot ship a complete contract. That argument is sound and it is not why the
double moves. `.agents/project-structure.md:314` already says `doubles→owner /testing`, and the check
against the rule could have come out the other way. It did not.

The 42 consumer statements are a **migration cost, not an architectural input** — consistent with the
owner's 2026-08-23 ruling that in-repo consumer count is not evidence about a `packages/` surface.

### The layer and the subpath are one question

`agent-interface-transport` is layer 2 **because** its `/testing` subpath imports a session type.
There is no version of this leaf that moves the double and leaves the layer, and none that reaches
layer 0 without moving it. One change, two descriptions — so the leaf has **two independent completion
criteria for the same outcome**, and a disagreement between them is a finding rather than a
formality.

### What the closure gate has to prove, and what it does not

"The obsolete surface is gone" is **not** "the barrel no longer exports it". A symbol can be absent
from a barrel and still reachable through a subpath, a deep import, or an `export *` in another file —
issue #2221 is the measured case, where four symbols were invisible to a guard for exactly that
reason.

So absence is proved at the **resolution** level, over three surfaces: the transport package's own
source (including subpaths), every consumer in the workspace, and the **built** `.d.ts`.

**The built check nearly failed as evidence.** `dist/node/index.d.ts` was older than `src/index.ts`,
so the first run measured a stale artifact and passed. Rebuilt and re-run before the result was
trusted. _A check whose oracle is a layer you did not measure is a check of that layer._

### The omnibus is already gone, and that is a measurement rather than a claim

The transport barrel exports **39 symbols**: 38 declared by its own four modules, plus `TActionResponse`
— a documented named exception under ARCH-037, not omnibus residue.

**Satisfied by predecessors.** ARCH-103 through ARCH-107 removed the facade one family at a time.
Recording that with the measurement, rather than manufacturing a deletion so the criterion feels
earned by this leaf.

### No new check is added, deliberately

The absence proof is a one-off verification recorded in this document, not a scan. A standing check
would need a condition it alone catches — and `interface-family-owner`, `deps`, `interface-imports`
and `interface-runtime` already cover every ongoing form of this. **A guard whose only reachable cases
are handled upstream is present and unproven**, and adding one here would be exactly that.

## Completion Criteria

- [x] **TC-01** `createTestInteractiveSession` is exported from `agent-interface-session/testing`, and
      no longer from `agent-interface-transport/testing`.
- [x] **TC-02** All 9 consumer packages import it from the session subpath; the 6 mixed statements are
      split so `runTransportLifecycleConformance` keeps its specifier.
- [x] **TC-03** `agent-interface-transport` imports nothing but `@robota-sdk/agent-core`, across every
      published surface including subpaths.
- [x] **TC-04** `agent-interface-transport` is declared **layer 0**, and BOTH `deps` and
      `interface-family-owner` accept it. Disagreement is a finding, not a formality.
- [x] **TC-05** The resolution-level absence proof passes over source, consumers and **freshly built**
      types — with the build performed as part of the check rather than assumed.
- [x] **TC-06** `pnpm harness:scan` exits 0 and `pnpm harness:verify-like-ci` reports green.

## Test Plan

| TC    | Test Type        | Tool / Approach                                                        | Notes                                                                  |
| ----- | ---------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| TC-01 | Structural       | Read both `testing/index.ts` files                                     | —                                                                      |
| TC-02 | Compilation      | Workspace `pnpm typecheck`                                             | A wrong split fails to resolve — no forwarding alias exists to mask it |
| TC-03 | Structural       | Enumerate every `@robota-sdk/*` import across the package's source     | Subpaths included; that omission is what made ARCH-107 predict wrong   |
| TC-04 | Gate (two-sided) | `check-dependency-direction.mjs` AND `scan-interface-family-owner.mjs` | Both must accept; the altitudes disagreeing is the signal              |
| TC-05 | Verification     | `pnpm build`, then the absence proof over three surfaces               | The build is part of the check — a stale oracle already passed once    |
| TC-06 | Gate             | `pnpm harness:scan`; `pnpm harness:verify-like-ci`                     | manual invocation — reported last                                      |

## User Execution Test Scenarios

**Not applicable — this task delivers no user-facing behavior.** It relocates a test double between
package subpaths and changes one layer declaration. No runtime value reaches a shipped surface that
did not already, and the double is consumed only by tests.

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-08-23

**Status upgrade:** draft → review-ready
**Judged by:** self-assessment against `.agents/specs/gate-catalogue.md` § GATE-WRITE.

- Frontmatter: `status: draft`, `type: DATA`, `tags: [typescript]`; frontmatter scan exits 0.
- Problem — concrete symptom naming the file and the import that holds the package at layer 2, plus
  what makes this leaf differ in kind from the six before it.
- Prior Art Research: explicit `Waived:` with a reason specific to this leaf — its novel part is a
  proof of absence, whose method comes from a measurement inside this repository (issue #2221) rather
  than an external source.
- Architecture Review Checklist: all 4 `[x]`; sibling scan explains why the OTHER double in the same
  subpath stays.
- New-surface placement: N/A with reason.
- Alternatives Considered: 2 entries with Pro and Con; B's con is the coupling this programme exists
  to remove, surviving in the place nobody looks.
- Decision: records that **the rule decided it, not the argument**, and that the check could have gone
  the other way.
- Completion Criteria: 6 items, all `TC-N`; TC-04 is deliberately two-sided and TC-05 folds the build
  into the check rather than assuming a fresh oracle.
- Test Plan: 6 rows for 6 TCs, each with Test Type and Tool/Approach.
- `## User Execution Test Scenarios` present with an explicit not-applicable and its reason.

### [WITHDRAWN GATE-APPROVAL] — ❌ INVALID | 2026-08-23

**Status upgrade:** review-ready → approved

Passed on the standing delegation recorded in ARCH-100's spec-doc, in RULE-012's three-part form. The
provenance limit recorded there applies unchanged.

**1 — The delegation.** As recorded in ARCH-100, corroborated in-repo by
`.agents/tasks/completed/RULE-012-…md` § Evidence.

**2 — The evidence condition is satisfied**, and the two claims that could have been asserted were
both measured instead: the omnibus is gone (39 exports, 38 own + 1 documented exception) and nothing
resolves to a moved symbol (three surfaces, re-run after a rebuild when the first oracle proved
stale).

**3 — The item is inside the delegated class**, and the one thing that could have taken it outside was
checked rather than assumed. Moving a double changes a **published subpath** for 9 packages, which is
normally an owner-reserved surface question. It is not a fresh decision here:
`.agents/project-structure.md:314` already states `doubles→owner /testing`, so this leaf applies an
existing rule rather than deciding a new one — and the owner ruled on 2026-08-23 that in-repo consumer
count is not evidence about a `packages/` surface, which is what disposes of the 42 statements.

Had the rule said otherwise, the rule would have won and this leaf would have reported that instead.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-08-23

**TC-01.** `createTestInteractiveSession` (137 lines) plus 36 helper lines moved to
`packages/agent-interface-session/src/testing/interactive-session-double.ts`, exported from that
package's testing barrel and no longer from transport's. Membership decided by reading the
DECLARATION in the moving module, not by what a barrel re-exports — the rule written before the
split, after a codemod derived membership from `export type {…}` blocks in an earlier leaf and
silently excluded 8 value exports.

**TC-02.** 42 files rewritten: 36 redirected whole, 6 split so `runTransportLifecycleConformance`
keeps the transport specifier — it doubles the transport lifecycle contract, which that package still
owns. The split count was predicted as 6 before the codemod ran and measured 6 after. The codemod
handled `import` and `export … from`, not `import` alone; that blind spot cost a build in an earlier
leaf and is filed as issue #2206.

Three tests moved with the double (`test-double-turn-identity`, `test-double-id-coherence`,
`session-capability-contracts`), and transport's own `contracts.test.ts` gave up its
interaction-channel and interactive-session assertions to the session package. Those two blocks were
the last thing in transport naming a contract it does not own — a test asserting a foreign contract,
which is the same coupling this decomposition removed everywhere else and the last place it survived.

**TC-03.** Every `@robota-sdk/*` import across `packages/agent-interface-transport/src`, subpaths
included, resolves to `@robota-sdk/agent-core`. The manifest's now-unused
`@robota-sdk/agent-interface-session` entry was dropped in the same change, and
`apps/remote-signaling` lost a transport dependency it no longer reaches through.

**TC-04 — both altitudes accept, which is the point of asking twice.**

| Guard                    | Judges         | Verdict                                                      |
| ------------------------ | -------------- | ------------------------------------------------------------ |
| `deps`                   | manifest edges | ✅ no dependency direction violations                        |
| `interface-family-owner` | module edges   | ✅ 21 modules, 6 owners, 6 layers, every edge legal, acyclic |

The layer row is now 0. `interface-family-owner`'s migration-order note independently moved transport
into wave 1 — the observable consequence one altitude up: nothing is left in it that another owner is
waiting for.

**TC-05 — the absence proof, and the defect found inside it.**

Three surfaces: transport's own source including subpaths, every workspace consumer, and the built
types. Result: no path in the workspace reaches a moved symbol through the transport package, over
194 symbols declared by the five new owners.

The third surface was wrong when written. It read `dist/node/index.d.ts` and nothing else; transport
publishes **two** entries, and the one it skipped is `/testing` — the exact surface that refuted
ARCH-107's layer prediction. **A check written after that lesson missed the same surface a second
time.** Repaired by deriving the corpus positively from `package.json` `exports` and reporting its own
size (`2 entries declared, 2 checked`), so a new or unbuilt entry must be excluded on purpose rather
than missed by default.

The asymmetry that makes this the serious one: the other two surfaces sweep WIDE corpora, and for an
ABSENCE proof extra corpus can only manufacture a finding to investigate. A presence-shaped read
inside an absence proof inverts that — it suppresses. **The direction of the danger follows the
direction of the claim.**

The build is part of the check. The first proof run passed against a `dist/` older than `src/`;
freshness is now asserted before the result is read.

**A second, independent measurement agreed.** Dropping the session dependency broke
`build-types-ordered.test.mjs`: transport's build tier fell 3 → 1. Different graph, computed by code
sharing nothing with the layer parser, moving to its floor from the same edge removal. Tier 1 rather
than 0 because `agent-core` occupies tier 0 — the two graphs number different things, so the claim
rests on the DIRECTION and the CAUSE, not on digits matching. Digits matching would have been weaker
evidence, suggesting one graph derived from the other. **Had only one moved, that would have been the
finding.**

**A guard defect found by this leaf, filed as issue #2228.** `check-spec-public-surface.mjs` proves a
SPEC's advertised export by asking whether the name appears anywhere in `src`, comments included.
`src/index.ts:71` said `createSessionCapabilityHost` / `readSessionCapability` are NOT here, and that
sentence satisfied the check for both names — a comment DENYING an export proved the export. It
reported 2 phantom rows; comparing the table against the built `.d.ts` found 6. Two measurements of
the same quantity disagreed, and the gap was the defect. Not a corpus failure but a GRAMMAR one: the
check asks "does this name appear" when the question is "does this module export it", and text search
cannot tell an export from a denial of one.

**Documentation moved with the contracts, not deleted.** 133 lines of session prose (interaction
channel scope, session persistence, ARCH-012 capability presence, turn identity) to
`agent-interface-session/docs/SPEC.md`; 22 lines of peer-messaging prose to
`agent-interface-session-mobility/docs/SPEC.md`. Transport's SPEC lost its fourteen-row re-export
directory — the omnibus written down — and five phantom API rows, and its Boundaries section stopped
claiming families that left in waves 1–3. 487 → 321 lines, every remaining heading its own.

The `reference-kind-qualified` ratchet followed the move correctly: two unqualified references
travelled with the peer prose into a file the baseline did not know. Qualified rather than baselined,
and transport's fallen entry re-frozen in the same change — one line deleted, since a 0-count entry is
dead weight.

### [GATE-VERIFY] — ✅ PASS | 2026-08-23

- `pnpm harness:scan` — 141 passed, 2 skipped, 0 failed (143 registered; 93 declared what they
  examined). 3 advisory findings, none this leaf's.
- `pnpm harness:test` — 4865 tests, 247 files, all green after the two assertions this leaf falsified
  were updated to the measured values rather than the predicted ones.
- `pnpm harness:verify-like-ci` — reported below.

**Two harness tests went red, and both were correct to.** `interface-layers.test.mjs` pinned
transport at layer 2 and `build-types-ordered.test.mjs` pinned it at tier 3. Each was written by an
earlier leaf to record a measured fact; this leaf changed the fact. Both updated with the reasoning
that produced the new number, and `interface-layers` now asserts the two edges layer 0 makes ILLEGAL
(`upward` to session, `same-layer` to execution) rather than the bare integer — a layer is what
forbids an edge, not a label.

### [REJECTION] — 2026-08-28

The implementation and its verification evidence were recorded at the same already-completed
checkpoint in PR #2244 (`c1dd93768`), so this document had no valid pre-implementation planning gate.
It is deliberately rejected rather than retroactively promoted. The delivered work remains recorded
by the completed Task at
`.agents/tasks/completed/ARCH-108-narrow-transport-and-prove-the-omnibus-is-gone.md`.
