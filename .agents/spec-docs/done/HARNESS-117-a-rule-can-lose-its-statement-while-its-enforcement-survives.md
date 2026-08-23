---
status: done
type: INFRA
tags: [typescript]
---

# HARNESS-117: a rule can lose its statement while its enforcement survives

Registered as GitHub issue https://github.com/woojubb/robota/issues/2178.

## Problem

`.agents/project-structure.md` § Interface Package Rule owns five mandatory rules — no runtime logic in
an `agent-interface-*` package, dependencies a subset of `{agent-core}`, implementation packages import
contracts from the interface package, and two more.

**Concrete symptom.** Delete all five. Run `pnpm harness:scan`. It reports
`139 scans passed, 0 failed`, exit code 0.

The scans that enforce those rules — `interface-runtime`, `deps`, `interface-imports` — read the CODE.
They keep working perfectly with the prose gone, because none of them verifies that the document
claiming to own a rule still states it. `routing-document-size` does read the file, but it is a ratchet
on line count: a deletion moves it in the permitted direction.

**Reproduction condition.** Any change that removes a rule's statement while leaving its enforcement
in place. It is not hypothetical — it happened during ARCH-100 (issue #2080), where a slice-based
extraction took the span between two anchors and a pre-existing `Rules:` block sat inside it. Five
mandatory rules were relocated into a document that does not own them and every scan stayed green.

**What caught it was luck.** That change also ADDED lines, so the net crossed the frozen ceiling and
`routing-document-size` — a check about SIZE — went red; following up that red is what exposed the
content loss. A change deleting the same five rules while removing lines elsewhere leaves the ratchet
green and nothing else speaks.

## Prior Art Research

- **DO-178C / DO-331 — bidirectional requirements traceability** (RTCA DO-178C §5.5 and Table A-2;
  overview: <https://en.wikipedia.org/wiki/DO-178C>). Certification requires trace links in BOTH
  directions between requirements and the verification that discharges them. The reverse direction is
  the one that matters here: verification with no requirement behind it is a documented finding
  ("derived requirement"), because a check nobody can read the intent of cannot be reviewed or
  changed safely. That is precisely the state this spec measures — 9 of 10 enforced rule identifiers
  have no statement anywhere.
- **Open Policy Agent — policy as code** (OPA documentation,
  <https://www.openpolicyagent.org/docs/latest/policy-language/>). The alternative structural answer:
  make the policy and its enforcement the SAME artifact, so they cannot diverge because there is only
  one. It is the reason Alternative C below is rejected rather than ignored — this repository has
  deliberately chosen prose rules plus separate mechanical scans, and that choice is what creates the
  divergence this spec detects.

**How the research feeds the decision.** DO-178C says the property worth checking is a two-directional
link, and that the enforcement→requirement direction is the neglected one. That is exactly the
direction chosen here (TC-01). OPA says the divergence disappears only if the two artifacts are
merged, which this repository has not done and this task is not proposing — so a link check, not a
merge, is the proportionate answer.

## Architecture Review Checklist

- [x] Affected package/layer list complete — one new `scripts/harness/` scan, its test file, its
      baseline, and a registration line in `run-all-scans.mjs`. **No rule document is edited**, and in
      particular `.agents/project-structure.md` is read, never written.
- [x] Sibling scan complete — `scan-new-rule-declares-enforcement.mjs` is the nearest sibling and the
      exact complement: it checks that a rule ADDED in a diff declares its enforcement, looking at the
      diff and forward in time. This one checks that enforcement present in the TREE still has a
      statement, looking at the tree and backward. Neither subsumes the other, and the pairing is
      deliberate. `routing-document-size` and `conflict-markers` were both measured and neither covers
      this: the first is a growth ratchet, the second needs two statements to compare and one deleted
      statement contradicts nothing.
- [x] At least 2 alternatives considered — see Alternatives Considered.
- [x] Decision rationale documented — see Decision.

**New-surface placement:** N/A — no new package, app, presentation or interface surface, and no layer
or product-family reclassification. One scan is added to an existing harness.

## Alternatives Considered

Each was **measured**, not reasoned about. The measurements are the reason two were rejected.

**A — Bind the RULE IDENTIFIER a scan emits to a statement in a normative document.** (chosen)

- Pro: it is the granularity at which the loss actually occurs. Measured: `INTERFACE-DEPS` is stated
  in exactly ONE normative document, `.agents/project-structure.md`, so deleting that statement fails
  the gate. Uses an identifier convention the scans already emit; adds no marker to any rule document.
- Con: adoption is low — 1 of 10 identifiers (**10%**) is stated today, so it lands as a baseline of
  9 rather than a clean floor. And it only reaches rules whose scan emits an identifier; a scan that
  reports findings in prose is outside it.

**B — Bind the SCAN FILE to a document that names it.**

- Pro: much higher adoption — 67 of 140 registered scans (**47.9%**) are already named by a normative
  document, so the baseline would be smaller in proportion.
- Con: **rejected by measurement.** A scan file implements many rules. After deleting the Interface
  Package Rule, `check-dependency-direction.mjs` is still named by `publish.md`, `spec-workflow.md`
  and `gate-catalogue.md`, so the gate stays green through the exact deletion that motivated this
  task. Higher adoption of the wrong property.

**C — Bind any TRACKED document, not just normative ones.**

- Pro: highest adoption of all — 133 of 140 scans (**95.0%**), nearly a clean floor.
- Con: **rejected by measurement, and it is the instructive rejection.** All three interface scans are
  also named in `.agents/archive/` and `.agents/spec-docs/done/`. Those record what was once decided,
  not what binds now, so the deletion leaves them named and the check stays green. This was the first
  design considered, and its 95% adoption is what made it attractive — a check that would have been
  green for the wrong reason, which is the defect this task exists to catch, one level up.

## Decision

Adopt **A**.

The trade-off that drove it: B and C both score far better on adoption, and adoption is the wrong
axis. A floor that passes at 95% while failing to catch the case it was built for is worth less than
one that starts at 10% and fails when the statement is deleted. The measurement is what settled
this — all three designs looked reasonable in prose, and only running them against the actual
deletion separated them.

The low adoption is handled the way this repository already handles it: a frozen baseline that may
only shrink, matching `interface-entry-baseline.json` and `examined-adoption-baseline.json`. The 9
unstated identifiers are recorded with the scan that emits each, so the debt is visible and counted on
every run rather than silent.

**A figure in this document was corrected during implementation.** The measurement that chose design A
reported 14 identifiers with 2 stated (14.3%). Three of those 14 name no rule — two regular-expression
character ranges (`A-Z`, `A-Z0-9`) and a documentation example (`SOME-123`) — and the extraction was
tightened to exclude comments, regex literals and single-character segments. The real figure is 10
emitted, 1 stated. **The correction does not disturb the decision**: designs B and C were rejected for
failing the falsification, not for their adoption rates, and design A's falsification is unchanged —
`INTERFACE-DEPS` is stated in exactly one normative document and removing it flips the verdict.

**Not in scope, and filed as issue #2188 rather than absorbed:** those 9 identifiers are `PLUGIN-LAYER`,
`DAG-NODES-LEAF`, `ENTRY-POINT-ONLY`, `CORE-ZERO-DEPS`, `FORBIDDEN-DEP`, `PACKAGE-NAME`, `RE-EXPORT`
and `DEV-CYCLE` — rules enforced on every push that no normative document states at all. That is the
inverse defect (enforcement that never had a statement, rather than a statement that was lost) and
fixing it is a documentation migration, not a scan. Writing those statements here would be the
leaf-expansion the execution rules forbid.

## Completion Criteria

- [x] **TC-01** The scan reports every rule identifier emitted by a harness scan that no normative
      document states, naming the emitting scan for each.
- [x] **TC-02** A document under `.agents/archive/` or `.agents/spec-docs/done/` does NOT satisfy the
      requirement — asserted directly, since accepting them is what made design C green for the wrong
      reason.
- [x] **TC-03** Removing `INTERFACE-DEPS` from the corpus makes the scan report it, demonstrated
      against the real repository content.
- [x] **TC-04** The currently-unstated identifiers are frozen in a baseline file; an identifier absent
      from both the baseline and the documents fails the gate, and the baseline count is printed on
      every run.
- [x] **TC-05** `node scripts/harness/scan-rule-statement-floor.mjs` exits 0 on the real tree and
      declares the size of what it examined.
- [x] **TC-06** `pnpm harness:scan` exits 0 and `pnpm harness:verify-like-ci` reports green.

## Test Plan

| TC    | Test Type         | Tool / Approach                                                                                       | Notes                                                                      |
| ----- | ----------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| TC-01 | Unit              | `vitest` over the exported extractor + matcher with in-memory scan sources and documents              | —                                                                          |
| TC-02 | Unit (falsifying) | `vitest`: an identifier stated ONLY in an archived path must still be reported as unstated            | This is design C's failure encoded as a permanent test                     |
| TC-03 | Integration       | `vitest`: read the real corpus, drop `.agents/project-structure.md`, assert `INTERFACE-DEPS` reported | Uses real repository content, not a fixture, because the claim is about it |
| TC-04 | Unit              | `vitest`: an unstated identifier absent from the baseline produces a finding; present, none           | —                                                                          |
| TC-05 | Integration       | Run the scan on the real tree; assert exit 0 and an `::examined::` declaration                        | —                                                                          |
| TC-06 | Gate              | `pnpm harness:scan`; `pnpm harness:verify-like-ci`                                                    | manual invocation — `verify-like-ci` is the CI-mirror entry point          |

## User Execution Test Scenarios

**Not applicable — this task delivers no user-facing behavior.** It adds a repository verification
scan and its baseline. Nothing a user runs changes.

The verification surface is the harness gate, recorded in the Test Plan above, plus the scan's own
failure output when a rule identifier loses its statement.

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-08-23

**Status upgrade:** draft → review-ready
**Judged by:** self-assessment against `.agents/specs/gate-catalogue.md` § GATE-WRITE. Recorded as a
self-assessment, not a `backlog-gate-guard` verdict — no guardian agent was dispatched.

- Frontmatter: `---`; `status: draft`; `type: INFRA`; `tags: [typescript]`.
  `check-spec-doc-frontmatter.mjs` exits 0.
- Problem — concrete symptom: delete the five rules, `pnpm harness:scan` reports
  `139 scans passed, 0 failed`, exit 0. Named file, named section, named output.
- Problem — reproduction condition: stated, plus the record that it already occurred during ARCH-100
  and that the catch was a size ratchet firing sideways.
- Problem — no "TBD"/"TODO"/single-sentence vagueness.
- Prior Art Research: 2 documentation sources with links (DO-178C bidirectional traceability; Open
  Policy Agent policy-as-code). Not third-party source code. A "How the research feeds the decision"
  paragraph ties the first to TC-01's direction and the second to rejecting Alternative C.
- Architecture Review Checklist: all 4 `[x]`; sibling scan `[x]` naming
  `scan-new-rule-declares-enforcement.mjs` as the exact complement and stating why
  `routing-document-size` and `conflict-markers` do not cover this.
- New-surface placement: N/A with reason.
- Alternatives Considered: 3 entries (A/B/C) with Pro and Con, each carrying its measured adoption
  figure and, for B and C, the specific falsification that rejected it.
- Decision: names the driving trade-off — adoption is the wrong axis — and says the measurement, not
  the prose, separated the three.
- Completion Criteria: 6 items, all `TC-N`, command or observable-behavior form; none uses "works
  correctly" / "no errors" / "implemented" / "displays correctly".
- Test Plan: 6 rows for 6 TCs; every row has Test Type and Tool/Approach; the manual row (TC-06)
  carries a Notes entry.

### [GATE-APPROVAL] — ✅ PASS | 2026-08-23

**Status upgrade:** review-ready → approved

Passed on the standing delegation recorded in ARCH-100's spec-doc, in RULE-012's three-part form. The
provenance limit recorded there applies unchanged and is not restated; see
`.agents/spec-docs/done/ARCH-100-contract-family-owner-map-and-acyclic-target-graph.md` §
GATE-APPROVAL.

**1 — The delegation.** As recorded in ARCH-100, corroborated in-repo by
`.agents/tasks/RULE-012-…md` § Evidence.

**2 — The evidence condition is satisfied**, and by measurement rather than argument. Three candidate
designs were built and run against the actual incident before one was chosen; two were rejected
because they stayed green through the deletion that motivated the task. The chosen design's key
claim — `INTERFACE-DEPS` is stated in exactly one normative document — is a measurement of the real
tree, and TC-03 keeps it checkable.

**3 — The item is inside the delegated class.** It adds one repository verification scan, its test
file and its baseline, plus a registration line. It edits **no** rule document — `.agents/rules/`,
`.agents/project-structure.md`, `AGENTS.md` and `ARCHITECTURE.md` are read, never written — so it
touches no repository policy. No production package, no published surface.

The adjacent finding it surfaced (12 enforced rule identifiers with no statement anywhere) is
explicitly NOT taken under this delegation: fixing it means writing new normative rule text, which is
policy authorship. It is filed instead, and recorded in this scan's baseline so the count is visible.
