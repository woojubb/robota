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

- [ ] TC-01: `git-branch.md` states, next to the three named grounds, that the ground is recorded on
      the pull request at the moment of acting.
- [ ] TC-02: `enforcement-architecture.md` states that an incident closes on a demonstrated prevention,
      and names the control that distinguishes demonstrated from never-exercised.
- [ ] TC-03: a pull request whose head moved after a zero-findings verdict with no ground recorded is
      REFUSED; one carrying the ground PASSES. Both directions.
- [ ] TC-04: an incident record carrying a cause and a prevention but no demonstration is REFUSED; one
      carrying the demonstration and its control PASSES. Both directions.
- [ ] TC-05: the enforcement runs from a source a stale working tree cannot carry an old copy of —
      the defect in issue #2384 — or states plainly why it cannot.
- [ ] TC-06: harness scans and the affected suites exit 0.

## Test Plan

| TC-ID | Test Type | Tool / Approach                                 | Notes                                                                                  |
| ----- | --------- | ----------------------------------------------- | -------------------------------------------------------------------------------------- |
| TC-01 | Unit      | assert on the rule file's contents              | Pins the statement, not a paraphrase                                                   |
| TC-02 | Unit      | same, for the other rule file                   |                                                                                        |
| TC-03 | Unit      | fixture pull-request records, compliant and not | The FAIL half is the red proof                                                         |
| TC-04 | Unit      | fixture incident records, compliant and not     | Same                                                                                   |
| TC-05 | Contract  | assert where the check runs from                | Issue #2384's defect is that a guard in the working tree misses the trees that lack it |
| TC-06 | Suite     | `pnpm harness:scan` and the affected suites     | Regression                                                                             |

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
