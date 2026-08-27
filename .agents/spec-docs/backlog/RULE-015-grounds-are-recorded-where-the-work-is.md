---
status: review-ready
type: RULE
tags: [harness, enforcement]
---

# RULE-015: a ground is recorded where the work is, and an incident closes on demonstrated prevention

Paired with `.agents/tasks/RULE-015-grounds-are-recorded-where-the-work-is.md`.
Arising from [issue #2384](https://github.com/woojubb/robota/issues/2384).

## Problem

Two principles the owner stated on 2026-08-27 currently exist nowhere a future session can read them:

1. **A ground is recorded on the artifact it justifies, at the moment of acting** — a push into an open
   pull request, a rebase, a status change, a gate entry. Written on that pull request when the action
   is taken, not reconstructed afterwards.
2. **An incident closes on a DEMONSTRATED prevention, not a written one** — an after-action record
   showing the recurrence is blocked, with the control that distinguishes "blocked" from
   "never exercised".

The concrete symptom that produced them, on pull request #2374:

```
09:03  review -> a7e56fd4b   ACTIONABLE FINDINGS: 0   mergeable (verdict names head, base == develop)
09:28  30ec0d4d8 pushed instead — no published finding, no red check, no rebase
09:41  review -> 30ec0d4d8   ACTIONABLE FINDINGS: 0   mergeable again
09:53  3e70bdabc pushed instead
10:04  review -> 3e70bdabc   ACTIONABLE FINDINGS: 0   base moved at 09:52; window shut
```

Nothing recorded why either push happened. The reasons had to be reconstructed a day later from
timestamps and reflogs — which is how this document exists at all.

The reproduction condition for the rule's absence is simpler and is the reason it is filed: **both
principles were transmitted to three sessions as messages.** A rule delivered as a message binds one
session for one day. The owner's correction was exact — it belongs in the repository, and everyone
reads it from there.

### The three events, with their facts fixed

Measured 2026-08-27, so the fixtures in Completion Criteria replay facts rather than recollections.

```
FIXTURE A — PR #2374 (a session now dead)
  a7e56fd4b..30ec0d4d8   1 commit    new work, not a rebase
  30ec0d4d8..3e70bdabc   1 commit    new work, not a rebase
  grounds published before either push:  0

FIXTURE B — PR #2385 (robota-20)
  rebase conflicts                       0
  range-diff, commits identical          2 of 2   ( = )
  files this branch touches              2
  files the moving change touched       15
  FILE OVERLAP                           0        <- a conflict was impossible

FIXTURE C — PR #2382 (robota-3-fc)
  files that branch touched             15
  files the moving change touched        2
  FILE OVERLAP                           0        <- a conflict was impossible
```

**The overlap is the finding.** Neither rebase could have hit a conflict; there was no shared file to
conflict on. Both were unnecessary as a matter of measurement, not of judgement.

**And the cheapest remedy existed in all three**, unread by anyone:

```
.github/workflows/claude-code-review.yml
  types: [opened, synchronize, reopened, edited]
```

A PR body edit re-triggers the reviewer against the recomputed merge revision — no commit, no push, no
force-update, no override. A stale verdict on an unchanged branch needs a re-review, not a rewrite.

**The self-incriminating part, recorded because it is the reason this document exists.** Fixture B is
mine, and I took it _while drafting this rule_, having published the finding against fixture A hours
earlier. Fixture C's author wrote a longer and more careful ground than mine for the same unwarranted
action — which is worse, not better: the care went into describing the action accurately rather than
into asking whether it was warranted. **A rule that requires a record is satisfied by a careful record
of a wrong decision.**

## Prior Art Research

Waived: both principles are already half-present in this repository's own rules, and the work is to
state and enforce them rather than to import a practice. `git-branch.md` already defines the three
named grounds for a push into an open pull request but does not say **where** the ground is written.
`enforcement-architecture.md` already owns "silence is not success" but stops short of requiring an
incident's prevention to be exercised. No external product decides either question for this
repository; the in-repo precedent used instead is issue #2188, which measured nine dependency rules
enforced by a scan and stated in no document — this is that defect reversed.

## Architecture Review

### Affected Scope

- `.agents/rules/git-branch.md` — principle 1, next to the three named grounds it already defines.
- `.agents/rules/enforcement-architecture.md` — principle 2, next to "silence is not success".
- `AGENTS.md` — only if the routing table does not already reach both files. It does; no change expected.
- `scripts/harness/` — the enforcement, plus fixtures in both directions.
- No package, no public API, no dependency direction, no module boundary.

### Alternatives Considered

1. **State each principle in the rule file that already owns its subject, and enforce each mechanically.**
   - Pro: neither principle needs a new home, so nothing is duplicated and `AGENTS.md` stays
     domain-free; and the enforcement is what makes the rule survive a session that has not read it.
   - Con: two files change and each needs its own fixture pair, so the work is wider than a single
     rule paragraph.

2. **State both principles in prose only, in one new rule file.**
   - Pro: smallest change; one file, one review.
   - Con: **it reproduces the defect it documents.** Issue #2188 measured 10 rule identifiers emitted
     by a scan of which 1 was stated anywhere; the mirror — stated and unenforced — is what let pull
     request #2374's two pushes happen while `git-branch.md` already forbade them. A rule whose only
     reader is a human who has already decided to act is not a rule.

3. **Enforce mechanically without stating the principles.**
   - Pro: closes the behaviour immediately.
   - Con: exactly issue #2188 — a check that refuses and names no readable statement teaches nobody
     why, and the next author works around it. The repository has already filed this as a defect once.

### Decision

**Alternative 1.**

The trade-off that drove it: this Task exists because a rule was delivered in a form that does not
persist, so the fix cannot itself be delivered in a form that does not bind. Alternative 2 is the same
failure one level up — prose that any session can pass without noticing. Alternative 3 fails the
opposite way and is already on the record as issue #2188. Only alternative 1 gives the rule both a
statement someone can read and a mechanism that does not depend on their having read it.

Its named con is real and is accepted: two rule files and two fixture pairs. The alternative to paying
it is a rule that binds one session for one day, which is the thing being fixed.

### Decomposition — one skill, one rule; the pipeline only sequences

Owner directive, 2026-08-27: _"모든걸 다 스킬로 만들어서 상위 스킬이 파이프라인을 진행하기만 하고
하위 스킬들은 각자 자기의 규칙만 처리하는걸로"_.

This is not a new architecture for this repository — it is the one already here, applied to the gap
that produced the three fixtures. Measured: **24 rules, 59 skills, and 8 rules no skill names at all**
(`api-boundary`, `frontend`, `helper-limits`, `measurement-provenance`, `memory-mirroring`,
`naming-style`, `process`, `release-operations`). Every fixture happened where one actor held several
rules and applied them by judgement.

Applied to the push decision, the sequence a top-level skill runs, each step owned by a skill that
knows only its own rule:

```
1. is a push necessary at all?   <- refuses fixtures B and C. Inputs: conflicts, file overlap,
                                    whether content changed, whether a cheaper remedy exists.
                                    Never sees the ground list.
2. which of the three grounds?   <- refuses fixture A (no ground). Only reached if 1 permits.
3. is the ground recorded on the artifact, before the action?
```

**The ordering is the whole prevention.** Both earlier drafts of this document put step 3 first and
called it done; fixtures B and C pass step 3 and fail step 1. A step-1 skill that cannot see the ground
list cannot be talked into accepting "rebase" as an answer to "the base moved".

**`measurement-provenance.md` being unowned is not incidental to this.** It governs exactly what the
three fixtures needed and nobody applied: state the control, state what was measured, do not let a
correlate stand in for the cause. My own sweep on issue #2384 sorted by commits-behind and read as if
lag were the mechanism; the correction — coverage is a property of the tree at the instant the hook
fires — came from another lane, not from the rule that owns it.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — `git-branch.md` already owns the three named grounds and
      `enforcement-architecture.md` already owns "silence is not success", so neither principle needs a
      new rule file; `.agents/rules/index.md` already routes both. No sibling owns the enforcement side,
      and no existing scan reads either principle.
- [x] 대안 최소 2개 검토 완료 (3개)
- [x] 결정 근거 문서화 완료
- [x] New-surface placement: **N/A** — no new package, app, presentation or interface surface, and no
      layer or product-family reclassification. Two existing rule documents gain a statement and the
      harness gains a check.

## Fallback & Degradation Declaration

None. A refusal is the point; there is nothing to fall back to.

## Completion Criteria

**The bar: every criterion is judged against the three real events of 2026-08-27, whose facts are fixed
in the Problem section. A draft that passes any of them has not met it.** Two earlier drafts of this
document passed all three — that is why this section is written against events rather than principles.

- [ ] TC-01: `git-branch.md` states the ORDER — cheapest remedy first, and the three named grounds are
      what is named **after** establishing a push is necessary at all. It records that a PR body edit
      re-triggers review against the recomputed merge revision (`types: […, edited]`), which is the
      remedy for a stale verdict on an unchanged branch.
- [ ] TC-02: `enforcement-architecture.md` states that an incident closes on a DEMONSTRATED prevention,
      and names the control separating "blocked" from "never exercised".
- [ ] TC-03: **FIXTURE A — PR #2374.** Two pushes after zero-findings verdicts, one commit each, new
      work not a rebase, **zero grounds published before either**. Must be REFUSED.
- [ ] TC-04: **FIXTURE B — PR #2385, robota-20.** Base moved; rebased with **0 conflicts**, `range-diff`
      2 of 2 commits `=`, branch touches 2 files against the moving change's 15, **file overlap 0**.
      A ground WAS recorded before acting and it was wrong. Must be REFUSED — and refused for the right
      reason: a remedy cheaper than a push existed.
- [ ] TC-05: **FIXTURE C — PR #2382, robota-3-fc.** Same shape: base moved, rebase with **file overlap
      0** between the branch's 15 files and the moving change's 2. A careful, accurate ground was
      recorded. Must be REFUSED. **The care in the record must not affect the verdict** — a
      well-documented unwarranted action is a better-camouflaged one.
- [ ] TC-06: a push that IS warranted PASSES — a real conflict, or a published finding, or a red
      required check. Without this half the enforcement is unfalsifiable in the direction that matters.
- [ ] TC-07: the judgement is decomposed so no single actor applies more than one rule. A skill that
      only answers "is a push necessary" must be able to refuse before any ground is considered; the
      ground-naming skill must never be reached when the first refuses.
- [ ] TC-08: harness scans and the affected suites exit 0.

## Test Plan

| TC-ID | Test Type | Tool / Approach                             | Notes                                                               |
| ----- | --------- | ------------------------------------------- | ------------------------------------------------------------------- |
| TC-01 | Unit      | assert on `git-branch.md` contents          | Pins the ORDER, not a paraphrase                                    |
| TC-02 | Unit      | assert on `enforcement-architecture.md`     |                                                                     |
| TC-03 | Unit      | fixture A replayed                          | Zero grounds recorded — the easy case                               |
| TC-04 | Unit      | fixture B replayed                          | **Ground recorded and wrong** — the case both earlier drafts passed |
| TC-05 | Unit      | fixture C replayed                          | **Ground recorded, accurate, still unwarranted**                    |
| TC-06 | Unit      | a warranted push                            | The control; without it TC-03..05 prove nothing                     |
| TC-07 | Contract  | assert the decomposition                    | Each skill sees one rule                                            |
| TC-08 | Suite     | `pnpm harness:scan` and the affected suites | Regression                                                          |

**Why fixtures rather than principles.** Draft v1 required a ground to be recorded; fixture B recorded
one. Draft v2 required the ground to say why it applies; fixture B and C can both write a true
paragraph explaining why a rebase reconciles a moved base. **Both drafts pass all three fixtures.** The
missing question is the one before them — is a push required at all — and it is missing because the
three named grounds are all push-shaped, so accepting that framing routes to the least-bad push instead
of to a bar.

## User Execution Test Scenarios

Not applicable — this states two rules and adds a harness check. No command, flag, output, config key
or exported symbol observable by an end user of the product changes. The nearest executable surfaces
are a harness scan and a git hook, both developer gates, and both are covered by TC-03 through TC-06.

Recorded as the rule's required choice rather than skipped.

## Tasks

- [ ] `.agents/tasks/RULE-015-grounds-are-recorded-where-the-work-is.md` — todo

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-08-27

**Status upgrade:** draft → review-ready

**Judged by:** self-assessment against `.agents/specs/gate-catalogue.md` § GATE-WRITE. **Not a
`backlog-gate-guard` verdict — no guardian agent was dispatched**, because agent dispatch is not
available in the session that wrote this. Disclosed rather than left implicit; issue #2266 records
that a self-issued gate entry is what nothing in this repository currently reads.

Criteria, measured:

```
status: draft in frontmatter             1
type: RULE (one of the 11)               yes
tags: present                             1
Prior Art — explicit `Waived:` line       1
Architecture Review Checklist [x]         5   (incl. the conditional new-surface item, N/A)
Alternatives Considered entries           3   (minimum 2)
Completion Criteria with TC-N             6
TBD / TODO occurrences                    0
```

- **Problem** carries a concrete symptom (the PR #2374 timeline with SHAs and verdict times) and the
  reproduction condition for the rule's absence: both principles were transmitted as messages.
- **Decision** names the trade-off and rejects alternative 2 on the ground that it reproduces the
  defect it documents, citing issue #2188's measurement rather than asserting it.
- **New-surface placement** is N/A and says so.

**What this gate does not establish:** that the enforcement design is correct — that is GATE-VERIFY's
— or that the owner wants it, which is GATE-APPROVAL's and is a fact about the user.
