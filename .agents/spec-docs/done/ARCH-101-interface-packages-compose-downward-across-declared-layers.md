---
status: done
type: RULE
tags: [typescript]
---

# ARCH-101: interface packages compose downward across declared layers

Registered as GitHub issue https://github.com/woojubb/robota/issues/2180.
Unblocks issues #2108–#2113 under tracker issue #2068.

## Problem

`.agents/project-structure.md` § Interface Package Rule restricts an `agent-interface-*` package's
internal dependencies to a subset of `{agent-core}`. `checkInterfacePackageDeps`
(`scripts/harness/check-dependency-direction.mjs:232-246`) enforces the literal reading: any
`@robota-sdk/*` production dependency other than `agent-core` is an `[INTERFACE-DEPS]` violation.

The contract-family owner map merged by ARCH-100 requires interface→interface edges. The owner has
since ruled that the general layer rule governs this prefix too — composition across **differing**
layers, one-directional, is permitted; only **same-layer** dependencies are forbidden. So the target
graph is legal.

**Concrete symptom, and it is what blocks work today.** Nothing implements the ruling. Issue #2109
creates `agent-interface-execution`; `agent-interface-transport` retains `session-contracts` and
`session-capability-contracts` until issue #2110, and those name 20 execution symbols. So transport's
manifest must depend on `agent-interface-execution`, and `pnpm harness:scan` fails with

```
[INTERFACE-DEPS] Interface-package violation: @robota-sdk/agent-interface-transport must not
depend on @robota-sdk/agent-interface-execution … (deps ⊆ {@robota-sdk/agent-core}).
```

**Reproduction condition.** The first migration leaf that creates an owner package while any consumer
of its families remains behind — which, by the migration order, is every leaf.

**The second half, which is easy to miss.** Relaxing the prohibition is not sufficient and is not
safe alone. Today a same-layer interface edge is refused only as a side effect of refusing _every_
edge, and `interface-family-owner` proves the module graph is **acyclic** — which no longer implies
legal, because a same-layer edge can be perfectly acyclic. Relax the prohibition without adding a
direction check and the case the ruling exists to forbid becomes reachable and unguarded.

## Prior Art Research

- **ArchUnit — `layeredArchitecture()`** (ArchUnit User Guide, "Layered Architecture",
  <https://www.archunit.org/userguide/html/000_Index.html#_layer_checks>). The documented form of
  exactly this check: layers are _declared by name_, packages are assigned to them, and the assertion
  is about which layer may be accessed by which. The declaration is data the checker reads, not prose
  a reviewer applies — which is the shape adopted here.
- **Nx — Enforce Module Boundaries** (Nx documentation, `@nx/enforce-module-boundaries`,
  <https://nx.dev/features/enforce-module-boundaries>). Packages carry **tags**; a rule declares which
  tag may depend on which. Already cited by ARCH-100 for the owner map; it is the same mechanism
  applied to the second axis, which is why the layer declaration belongs beside the owner map rather
  than in a separate registry.

**How the research feeds the decision.** Both say the same two things: the layer assignment is data,
and the direction assertion is derived from it rather than restated. That is why the declaration gets
one machine-readable owner (Decision, point 1) and why neither guard is allowed to hard-code a layer
(Alternative B, rejected).

## Architecture Review Checklist

- [x] Affected package/layer list complete — `.agents/project-structure.md` (the rule),
      `.agents/specs/contract-family-owner-map.md` (the declaration), a new shared parser under
      `scripts/harness/`, and the two guards that consume it. No production package is touched.
- [x] Sibling scan complete — `checkFullGraphCycles` already keeps the whole workspace graph acyclic
      and is untouched; it is necessary and, as the Problem section says, no longer sufficient.
      `interface-runtime` and `interface-imports` police different properties of the same packages and
      are unaffected. `rule-statement-floor` (HARNESS-117) will require the amended rule to keep
      stating `INTERFACE-DEPS`, which it does.
- [x] At least 2 alternatives considered — see Alternatives Considered.
- [x] Decision rationale documented — see Decision.

**New-surface placement:** N/A — no new package, app, presentation or interface surface. One rule is
amended, one parser module and two guard predicates are added.

## Alternatives Considered

**A — One machine-readable layer declaration, one shared parser, two consumers.** (chosen)

- Pro: one owner for the fact. The map already declares the layers for human readers and is already
  parsed by `interface-family-owner`; making the declaration data lets `checkInterfacePackageDeps`
  enforce the same assignment on manifests. A layer added or moved is picked up by both guards at
  once.
- Con: `check-dependency-direction.mjs` gains a dependency on a document, which is a heavier coupling
  than it has today.

**B — Hard-code the layer assignment in each guard.**

- Pro: no document coupling; each guard stays self-contained.
- Con: two copies of one fact, in two files, with nothing comparing them — the exact drift this
  repository keeps paying for and that ARCH-100's owner map was built to avoid. Rejected.

**C — Relax `checkInterfacePackageDeps` to permit any interface→interface edge and rely on
`checkFullGraphCycles`.**

- Pro: smallest change; the acyclicity guarantee genuinely already exists.
- Con: **acyclicity does not forbid a same-layer edge.** `command → execution` is acyclic and illegal.
  This would encode the half of the ruling that was already true and drop the half that is new.
  Rejected.

## Decision

Adopt **A**, in one change rather than two.

1. **The declaration gets one owner.** `.agents/specs/contract-family-owner-map.md` gains a
   machine-readable layer table beside its owner map, under its own marker. It already holds the
   family→owner assignment; the layer is the second axis of the same fact and belongs with it.
2. **One parser, not two.** A shared `scripts/harness/interface-layers.mjs` reads it and answers
   `layerOf(pkg)` and `isLegalEdge(from, to)`. **Neither guard parses the document.** Two guards
   parsing one markdown table would be two parsers that can disagree about one fact, which is the
   duplication this decision exists to avoid — the document coupling in Alternative A's Con is
   accepted once, in one place, rather than twice.
3. **Both guards consume it.** `checkInterfacePackageDeps` judges manifest edges;
   `interface-family-owner` judges module edges. Same predicate, two altitudes.

**Why this is one pull request.** Points 2 and 3 cannot ship apart. Relaxing the manifest prohibition
without the module-level direction check leaves a window in which the new rule exists and nothing
enforces the part of it that is new — worse than the flat prohibition it replaces, because it reads
as governed.

The trade-off that drove A over B: B is cheaper and self-contained, and it would put the layer of
`agent-interface-session` in two files with no mechanism comparing them. A rule whose two enforcers
can disagree about what it says is not one rule.

**Pattern note.** Issue #2194 asks where a package's layer lives and how the architecture map and a
package `SPEC.md` relate. ARCH-101 does not answer it, but it establishes a worked precedent for one
family: the layer is declared once as data, in the cross-cutting spec that owns the family map, and
guards derive from it. Whoever takes issue #2194 has that rather than a blank page.

## Completion Criteria

- [x] **TC-01** `.agents/project-structure.md` § Interface Package Rule states that an
      `agent-interface-*` package may depend on another only downward across declared layers and
      one-directionally, and that same-layer and upward dependencies are refused.
- [x] **TC-02** The layer assignment is machine-readable in
      `.agents/specs/contract-family-owner-map.md` under a marker, and `interface-layers.mjs` parses
      it; a missing marker fails rather than yielding an empty legal-by-default answer.
- [x] **TC-03** `checkInterfacePackageDeps` accepts a downward interface→interface manifest edge and
      reports a same-layer one and an upward one, each with the layers named.
- [x] **TC-04** `interface-family-owner` reports a same-layer and an upward MODULE edge, and each case
      is demonstrated to pass the acyclicity check — proving the new check is not redundant.
- [x] **TC-05** Every new refusal is demonstrated RED before the code satisfying it is written.
- [x] **TC-06** `pnpm harness:scan` exits 0 and `pnpm harness:verify-like-ci` reports green.

## Test Plan

| TC    | Test Type          | Tool / Approach                                                                                  | Notes                                                       |
| ----- | ------------------ | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| TC-01 | Document assertion | Read the amended rule; `rule-statement-floor` asserts `INTERFACE-DEPS` is still stated           | —                                                           |
| TC-02 | Unit               | `vitest` over `interface-layers.mjs` with in-memory documents, including the missing-marker case | —                                                           |
| TC-03 | Unit               | `vitest` over `checkInterfacePackageDeps` with synthetic package maps                            | —                                                           |
| TC-04 | Unit (falsifying)  | `vitest`: a same-layer edge that `findCycles` reports as acyclic must still be refused           | This is what proves the new check adds a property           |
| TC-05 | Procedure          | Each new case run against the pre-change guard and observed failing                              | manual red-before-green step, recorded in the PR body       |
| TC-06 | Gate               | `pnpm harness:scan`; `pnpm harness:verify-like-ci`                                               | manual invocation — `verify-like-ci` is the CI-mirror entry |

## User Execution Test Scenarios

**Not applicable — this task delivers no user-facing behavior.** It amends a repository rule and two
verification guards, and moves no production TypeScript. No shipped surface changes.

The verification surface is the harness gate, recorded in the Test Plan above — specifically that a
same-layer or upward interface edge is refused at both the manifest and module altitudes.

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-08-23

**Status upgrade:** draft → review-ready
**Judged by:** self-assessment against `.agents/specs/gate-catalogue.md` § GATE-WRITE. Not a
`backlog-gate-guard` verdict — no guardian agent was dispatched.

- Frontmatter: `status: draft`, `type: RULE`, `tags: [typescript]`; frontmatter scan exits 0.
- Problem — concrete symptom: the exact `[INTERFACE-DEPS]` failure text issue #2109 will produce, with
  the guard's file and line.
- Problem — reproduction condition: the first leaf creating an owner package while a consumer remains
  behind, which is every leaf.
- Problem — no "TBD"/"TODO"/vagueness; includes the non-obvious second half (relaxing alone is unsafe).
- Prior Art Research: 2 documentation sources with links (ArchUnit `layeredArchitecture()`; Nx
  `@nx/enforce-module-boundaries`), tied to Decision point 1 and to rejecting Alternative B.
- Architecture Review Checklist: all 4 `[x]`; sibling scan names `checkFullGraphCycles`,
  `interface-runtime`, `interface-imports` and `rule-statement-floor`, and says why each is unaffected
  or still necessary.
- New-surface placement: N/A with reason.
- Alternatives Considered: 3 entries with Pro and Con; B and C each carry the specific property that
  rejected them.
- Decision: names the driving trade-off — a rule whose two enforcers can disagree about what it says
  is not one rule — and states why points 2 and 3 are one pull request.
- Completion Criteria: 6 items, all `TC-N`, command or observable-behavior form.
- Test Plan: 6 rows for 6 TCs; each has Test Type and Tool/Approach; the two manual rows carry Notes.

### [GATE-APPROVAL] — ✅ PASS | 2026-08-23

**Status upgrade:** review-ready → approved

This item amends repository policy — the Interface Package Rule and the guard enforcing it — which is
**outside** the standing delegation's class. It does not pass on that delegation. It passes on a
**specific owner ruling on this specific question.**

**The ruling, as relayed.** Asked whether the general layer rule governs `agent-interface-*`, the
owner answered: 「같은 공통 접두어라고 해도 단계 계층이 다를경우 단방향 조합이 가능하다. 오직 같은
단계만 안된다」 — same prefix is permitted when the layers differ and the composition is
one-directional; only same-layer is forbidden — and, on the direct follow-up, 「판정2는
agent-interface에도 적용된다」.

**Provenance, stated because it bounds this entry.** The ruling was not given in this session's
thread. It reached this session by relay from the orchestrating session, as with ARCH-100, and the
same limit applies. What is different here, and worth naming: the ruling was obtained **through the
escalation path rather than around it.** Issue #2180 was filed precisely because the amendment was
owner-reserved, escalated for that reason, and this ruling is the answer that came back. That
distinguishes an authorization produced by the mechanism from one assumed in its absence — but it
does not convert a relay into a first-hand instruction, and this entry does not claim it does.

**Scope check against the ruling.** What is built here is exactly what was ruled and no more: downward
one-directional composition permitted, same-layer refused, upward refused. It does not decide which
package sits in which layer — that assignment is ARCH-100's, already merged and unchanged. It moves no
production TypeScript and changes no published surface.

**Verification of the premise, independent of the relay.** The ruling's applicability was checked
against the real graph rather than assumed: the only cross-family edges are `mobility → session`,
`session → command` and `session → execution`, all strictly downward, with **zero same-layer edges**.
The single upward edge is the accidental `workspace-contracts → session-contracts` re-export, already
the first precondition of issue #2109. So the merged target graph satisfies the ruling as stated.
