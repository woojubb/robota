---
status: draft
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

## Solution (draft direction)

Add a **date class** to the engine's suppressions, beside the five already there (identifier lists,
step/round references, decimal scores, line references, completed results).

The decidable form: an `N/M` whose components fall in date ranges (`N ≤ 12`, `M ≤ 31`) and which sits
in a date-shaped context — parenthesised, or adjacent to a date token. **Range alone is not enough**:
`3/7 done` is a genuine violation with both components in range, and a suppression keyed only on
magnitude would retire the scan's most common true positive.

This cannot be configuration. `.agents/harness.config.json` → `progressReportQuantification` carries
`transcriptRoot`, `enforceSinceIso`, `completionKeywordPattern`, `identifierNounPattern`,
`identifierNounSuffixPattern` — no date class. The near-miss fails: `완료` is a completion keyword,
not an identifier noun, so listing it there would suppress genuine `완료 8/14` violations.

**No `pre-push` hatch is proposed.** A general "this scan is wrong" override becomes the answer to
every red scan the moment it exists. If one is ever right it needs its own decision and its own
evidence, not a slot in this change.

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
- 2026-08-25 — Implemented: a parenthesised-date suppression in the engine, requiring all three of a
  parenthesis holding the ratio and nothing else, a first component ≤ 12, and a second component
  above 12 and ≤ 31. Range alone was rejected as useless — `3/7 done` is the scan's commonest true
  positive and both components are in range.
- 2026-08-25 — Verified by mutation. With the guard disabled (`if (false && …)`) exactly one of the
  five new cases fails — the suppression case — and all four positive controls still pass. So the
  suppression case measures the guard, and the controls measure that the guard does not over-reach.
  `pnpm exec vitest run` on the file: 54 passed. `pnpm harness:scan`: 144 passed, 0 failures.
- 2026-08-25 — Residual, stated rather than hidden: a date whose day is also ≤ 12 (`완료(8/9)`) still
  reports. Left firing rather than guessed at, because that errs toward reporting, which is the safe
  side for a guard.
