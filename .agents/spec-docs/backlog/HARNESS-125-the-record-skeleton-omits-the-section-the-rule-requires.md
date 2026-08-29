---
status: review-ready
type: INFRA
tags: [harness, templates]
---

# HARNESS-125: the record skeleton omits the section the rule requires

Paired with `.agents/tasks/completed/HARNESS-125-the-record-skeleton-omits-the-section-the-rule-requires.md`.
Arising from [issue #2308](https://github.com/woojubb/robota/issues/2308).

## Problem

`.agents/rules/backlog-execution.md` § User Execution Test Scenario Rule requires every record to
carry a `## User Execution Test Scenarios` section — a real scenario, or `Not applicable` with the
reason written. **Neither producer of a record emits it.**

Reproduction, on `ccdb5e65a`, with controls:

```
CONTROL  loadHarnessConfig in scripts/harness   35 files   (the search finds things)
CONTROL  zzzNoSuchToken                          0 files   (and discriminates)

.agents/templates/spec-template.md          grep -c 'User Execution'  ->  0
                                            `## ` headings in it      ->  10
scripts/harness/allocate-work-item-id.mjs   :219  ## Objective
                                            :223  ## Plan
                                            (nothing else emitted)
```

The condition under which it occurs is the ordinary one: an author opens the template or runs the
allocator, fills in the sections they were given, and produces a record that the rule does not accept.
Issue #2308 states the mechanism in the words of an author who hit it — _"The template was the shape of
my work and the rule was the shape of the obligation, and I took the template as the specification."_

**Half of the issue's title is already false and must not be rebuilt.** It reads "Nothing emits or
checks". The checking side was closed by `c4bb51a62` (PR #1815, 2026-08-17) — a week before the issue was
filed — as `scripts/harness/scan-spec-user-execution-section.mjs`, which today reports
`::examined:: 287 governed spec document(s), 220 frozen exemption(s)`. A reader taking the title at
face value would build a scan that exists and then have to reconcile it with a 220-entry baseline.

## Prior Art Research

Waived: this emits an existing, already-specified section from two existing producers. The section's
required form is defined by `backlog-execution.md` and already enforced by
`scan-spec-user-execution-section.mjs`; no external product or protocol decides what a skeleton should
contain here. The in-repo precedent used instead is that scan's own definition of an acceptable
section, which this work must emit something that satisfies **for the right reason**.

## Architecture Review

### Affected Scope

- `.agents/templates/spec-template.md` — add the section.
- `scripts/harness/allocate-work-item-id.mjs` — add it to the emitted skeleton (currently `## Objective`
  and `## Plan` only).
- `scripts/harness/__tests__/` — assertions that both producers emit it, and that a heading-only
  record does NOT satisfy the scan.
- No package, no public API, no dependency direction, no module boundary.

### Alternatives Considered

1. **Emit the heading plus the rule's required choice, in both producers.**
   - Pro: the author is asked the question at the moment they are writing, which is the only moment the
     answer is cheap; the record is compliant by construction rather than by later correction.
   - Con: a skeleton line an author deletes without answering leaves a record that is worse than
     absent — it looks answered. Mitigated by the heading-only test case below.

2. **Emit a bare `## User Execution Test Scenarios` heading.**
   - Pro: one line per producer; trivially satisfies the existing scan.
   - Con: **it manufactures issue #2261's defect by a new route.** That scan checks a heading exists and
     not what is under it, so every generated record would pass while saying nothing, and the passing
     population would grow by one per new record. Rejected on that ground, not on effort.

3. **Leave the producers alone and widen the scan to fail records lacking the section.**
   - Pro: no producer change; the guard already exists and has the population.
   - Con: it moves the cost to the end — an author learns at a done gate that the shape they were given
     was wrong. It also does nothing about the 220 frozen exemptions, and it punishes the author for
     the template's omission, which is the mechanism the issue names.

### Decision

**Alternative 1.**

The trade-off that drove it: the defect is that the shape an author is given disagrees with the shape
the rule demands, and only alternative 1 closes that gap where it opens. Alternative 3 is the same
information delivered later and to the wrong person. Alternative 2 is cheaper and is rejected because
its failure mode is invisible — a record that passes the guard while answering nothing is worse than
one that fails it, and the guard cannot tell them apart.

Its named con is the reason the Test Plan carries a heading-only case: the fix must be provably
distinguishable from alternative 2's outcome, or it has merely relocated the defect.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — the four `scripts/harness/` files naming this section were inspected
      (`scan-spec-user-execution-section.mjs`, `scan-user-execution-plan-order.mjs`, and both suites).
      The check side is owned by the first and is NOT extended here; no other producer of a record
      exists besides the template and the allocator.
- [x] 대안 최소 2개 검토 완료 (3개)
- [x] 결정 근거 문서화 완료
- [x] New-surface placement: **N/A** — no new package, app, presentation or interface surface, and no
      layer or product-family reclassification. Two existing files gain emitted text; the section they
      emit is already defined by `backlog-execution.md` and already governed by an existing scan.

## Fallback & Degradation Declaration

None. This adds emitted text to two producers; nothing falls back.

## Completion Criteria

- [ ] TC-01: `.agents/templates/spec-template.md` contains the `## User Execution Test Scenarios`
      heading and the rule's required choice prompt.
- [ ] TC-02: the skeleton emitted by `allocate-work-item-id.mjs` contains both.
- [ ] TC-03: a record shaped like the emitted skeleton satisfies
      `scan-spec-user-execution-section.mjs`.
- [ ] TC-04: a record carrying the heading with nothing under it does NOT satisfy it — the case that
      distinguishes this fix from alternative 2.
- [ ] TC-05: `scan-spec-user-execution-section.mjs` and the harness scan set exit 0.

## Test Plan

| TC-ID | Test Type | Tool / Approach                                | Notes                            |
| ----- | --------- | ---------------------------------------------- | -------------------------------- |
| TC-01 | Unit      | assert on the template file's contents         | Pins the producer, not the prose |
| TC-02 | Unit      | assert on the allocator's emitted skeleton     | Same, for the generated path     |
| TC-03 | Unit      | run the scan against a skeleton-shaped fixture | Passes for the right reason      |
| TC-04 | Unit      | run the scan against a heading-only fixture    | Must FAIL; this is the red proof |
| TC-05 | Suite     | the scan plus `pnpm harness:scan`              | Regression                       |

## User Execution Test Scenarios

Not applicable — this changes the shape of a document skeleton used by contributors and a harness
scan's inputs. No command, flag, output, config key or exported symbol that an end user of the product
can observe changes. The nearest executable surface is `allocate-work-item-id.mjs`, a developer tool,
and its behaviour is covered by TC-02 in the Test Plan.

Recorded as a decision rather than a skip: the rule requires the choice to be made and written, and
this is the "not applicable, with the reason" branch of it.

## Tasks

- [ ] `.agents/tasks/completed/HARNESS-125-the-record-skeleton-omits-the-section-the-rule-requires.md` — done

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-08-27

**Status upgrade:** draft → review-ready

**Judged by:** self-assessment against `.agents/specs/gate-catalogue.md` § GATE-WRITE. **Not a
`backlog-gate-guard` verdict — no guardian agent was dispatched**, because agent dispatch is not
available in the session that wrote this. Disclosed rather than left implicit: issue #2266 records
that a self-issued gate entry is exactly what nothing in this repository currently reads, and five
ARCH documents carry the same disclosure.

Criteria, measured rather than asserted:

```
status: draft in frontmatter            1
type: INFRA (one of the 11)             yes
tags: present                            1
Prior Art — explicit `Waived:` line      1
Architecture Review Checklist [x]        5   (incl. the conditional new-surface item, N/A)
Alternatives Considered entries          3   (minimum 2)
Completion Criteria with TC-N            5
TBD / TODO occurrences                   0
```

- **Problem** carries a concrete symptom (two grep counts and two line numbers on named files) and the
  condition under which it occurs (an author filling in the sections they were given).
- **Decision** names the trade-off that drove it and rejects alternative 2 on its failure mode rather
  than on effort.
- **New-surface placement** is N/A and says so: no package, app, presentation or interface surface, and
  no layer or product-family reclassification.

**What this gate does NOT establish, stated so the next reader does not assume it:** that the fix is
correct, or that the owner wants it. The first is GATE-VERIFY's; the second is GATE-APPROVAL's, and
its criterion 1 is a fact about the user that no self-assessment can supply.
