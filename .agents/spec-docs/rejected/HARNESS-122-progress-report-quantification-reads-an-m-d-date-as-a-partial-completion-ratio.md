---
status: rejected
type: INFRA
tags: [infra, harness, scan]
---

# HARNESS-122: an M/D date is read as a partial completion ratio

## Problem

`scan-progress-report-quantification` reports a violation on a **date**:

```
ratio 8/14 reported without a percentage:
  "ARCH-011은 완료(8/14)입니다."
```

`8/14` is 14 August, `ARCH-011`'s `completed:` date. No countable work set appears in the sentence.

The scan fires correctly by its own rule — it deliberately does not judge whether a sentence _is_ a
mid-work update, only that `N/M` with `N < M` in a completion context and no percentage is a
violation. `8 < 14` holds and `완료` is adjacent to the parenthesis.

**The consequence is a total block on one lane.** `pre-push.mjs` refuses on any red scan; the finding
is in an append-only transcript, so every push from the affected host fails on every branch until the
class is handled. `pre-push.mjs` has no override for a scan the author believes is wrong.

## Prior Art Research

Waived: the subject is a false-positive class in a scan this repository wrote, over transcripts
this repository produces, against a rule this repository states (`agent-conduct.md`, HARNESS-026).
No external product documents a Korean-adjacent completion-word/date-parenthesis interaction with a
progress-quantification rule, because no external product has that rule. The evidence that decides
the design is in this repository — the scan's five existing suppression classes and their fixtures —
and it is read directly in the Solution below rather than approximated from an external source.

## Solution

**An engine pattern rule was implemented first, reviewed, and withdrawn.** It suppressed a
parenthesised `N/M` with a month-range first component and a second component in `(12, 31]`. Review
of PR #2341 found it silently dropped genuine progress statements — `감사 완료(3/20)입니다.` matches
every condition and is a real three-of-twenty report. Reproduced before accepting:

```
0 findings  ←  ARCH-011은 완료(8/14)입니다.      the intended suppression
0 findings  ←  감사 완료(3/20)입니다.             a genuine ratio, dropped
1 finding   ←  감사 완료(3/7)입니다.
```

**The class is not separable by pattern at all.** `완료(8/14)` and `완료(3/20)` are the same shape,
and what distinguishes a date from a ratio is the author's intent — which is not in the text. Any
numeric narrowing repeats this bug with a smaller footprint, trading a false positive for a false
negative in the class the scan exists to catch. That is the outcome this document's own Problem
section named as unacceptable.

**So the author states which it is, and the ledger carries both.** An acknowledgment entry gains a
`kind`:

- `violation` — the default, and what every entry written before this meant: the rule was broken, the
  transcript is append-only, it is recorded rather than fixed.
- `false-positive` — the finding is not a violation, with a reason saying how the scan read it wrong.

Both are true statements, which is the property the old single-meaning ledger could not offer: clearing
a false positive through the `violation` shape asserted something that never happened.

The advisory line reports the two counts separately. A single total reads as "violations happened" and
hides "the scan is wrong and may need fixing" — opposite responses from the same number.

**No `pre-push` hatch.** A general "this scan is wrong" override would become the answer to every red
scan the moment it existed. `kind: false-positive` is not that: it is per-finding, it carries a
reason, and it is anti-rotted — an entry whose finding stops appearing fails the scan.

## Completion Criteria (draft)

- A fixture with `완료(8/14)` produces no finding.
- **Positive control**: `완료 8/14` — same numbers, no parenthesis — still produces one.
- **Second control**: `3/7 done` still fires; `3/7 done = 43%` does not.
- No acknowledgment entry is added. The ledger's contract is real violations; clearing a false
  positive through it would make an entry mean nothing.
- `pnpm harness:scan` green on the affected host — which is this item's own unblock condition, so the
  push carrying the fix is the first push that can pass.

## Evidence Log

- 2026-08-25 — Measured at `e5551e9b6`. `pnpm harness:scan`: `1 of 143 scans failed`, sole finding the
  `8/14` line above. `pre-push` refused the push carrying `TRANS-009`/`TRANS-010`.
- 2026-08-25 — Config inspected: five fields under `progressReportQuantification`, no date class; the
  `identifierNounPattern` alternative rejected because it would suppress genuine `완료 8/14`.
- 2026-08-25 — `pre-push.mjs` environment reads enumerated: remote name, remote URL, base ref, mode.
  No override for a disputed scan. Recorded on issue #2339 as the reason the fix must be the fix.
- 2026-08-25 — Filed as issue #2339; task record `HARNESS-122`.
- 2026-08-25 — **GATE-APPROVAL: owner sign-off obtained.** Asked which of three paths to take
  (fix the scan / write an acknowledgment / `--no-verify` and fix later); the owner selected
  **"HARNESS-122 승인, 스캔 수정"** — approve HARNESS-122, fix the scan. A peer session's instruction
  to take this path set the ORDER of the work and was explicitly not treated as this approval.
- 2026-08-25 — First implementation: a parenthesised-date suppression in the engine. Mutation-verified
  at the time — one of five new cases died with the guard disabled — and that check could not see the
  defect, because none of its four positive controls exercised a denominator inside the band the guard
  changed. **A mutation test proves a case measures the guard; it says nothing about whether the cases
  cover the guard's reach.**
- 2026-08-25 — **Withdrawn on review of PR #2341** (MUST). `감사 완료(3/20)입니다.` — a genuine
  three-of-twenty report — was silently dropped. Reproduced against the exported predicate before
  accepting the finding. The review's sharpest point: this document already stated that a suppression
  keyed on magnitude would retire the scan's commonest true positive, and the implementation was
  magnitude-plus-parenthesis.
- 2026-08-25 — **Owner decision on the replacement**, asked as three options (ledger kind / year-only
  date form / withdraw the PR): **"원장에 '오탐' 종류를 추가"** — add a false-positive kind to the
  ledger.
- 2026-08-25 — Implemented: `ACKNOWLEDGMENT_KINDS`, per-entry validation, kind-split reporting, the
  ledger's own `why` contract updated, and one `false-positive` entry for the 8/14 finding.
- 2026-08-25 — Verified by mutation, twice. Ignoring an entry's kind kills two cases; disabling the
  kind validation kills one — the typo case (`false-postive`), which would otherwise fall through the
  `?? 'violation'` default and clear a finding while counted as a violation. Baseline 55 passed;
  `pnpm harness:scan` 144 passed, 0 failures.

### [REJECTION] — 2026-08-29

PR #2341 delivered the owner-selected ledger-kind correction at merge commit
`8c8cde208c9510805a82b9e9d7ecec22fb6c07cd`; issue #2339's definitive correction records why that
solution superseded this draft's refuted pattern-based proposal, and the focused suite passes 55/55.
No implementation remains. Because this draft never entered an approved GATE-IMPLEMENT through
GATE-COMPLETE history, it is rejected as stale rather than promoted to done, with its historical
proposal and withdrawal evidence preserved.
