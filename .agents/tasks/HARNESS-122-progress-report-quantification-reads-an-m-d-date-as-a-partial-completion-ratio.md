---
title: 'HARNESS-122: progress-report-quantification reads an M/D date as a partial completion ratio'
issue: https://github.com/woojubb/robota/issues/2339
status: todo
created: 2026-08-25
priority: high
urgency: now
area: scripts/harness
depends_on: []
---

# HARNESS-122: an M/D date is read as a partial completion ratio

## Problem

`scan-progress-report-quantification` fires on a **date** written `M/D` when a completion word sits
next to it. Measured at `e5551e9b6`:

```
ratio 8/14 reported without a percentage:
  "ARCH-011은 완료(8/14)입니다."
```

`8/14` is 14 August — the `completed:` date in `ARCH-011`'s frontmatter. There is no countable work
set in the sentence.

The scan is right to fire by its own stated rule: it does not judge whether a sentence _is_ a
mid-work update, only that `N/M` with `N < M` in a completion context without a percentage is a
violation. `8 < 14`, and `완료` sits immediately before the parenthesis.

## Why it is urgent rather than cosmetic

`pre-push.mjs` refuses on any red scan. The finding lives in an append-only transcript, so it is red
for **every** push from the affected host, on every branch, until the scan learns the class. It is a
total block on one lane, not a nuisance.

`pre-push.mjs` also has no override for it — its only environment reads are
`HARNESS_PRE_PUSH_REMOTE_NAME`, `HARNESS_PRE_PUSH_REMOTE_URL`, `HARNESS_BASE_REF` and
`HARNESS_PRE_PUSH_MODE`. **No hatch is proposed here**: a general "this scan is wrong" override would
become the answer to every red scan the moment it existed. If one is ever right it needs its own
decision, not a slot in this change.

## Why Korean makes the class reachable

English writes "completed on 8/14" — a preposition separates the completion word from the date.
Korean writes `완료(8/14)`, adjacent. The five suppression classes the scan already carries were
derived from English transcripts, and the repository's language policy has agents narrating to the
owner in Korean, so this class is reachable in normal use and was **not reachable in the sample the
classes came from.**

## Why it cannot be configuration

`.agents/harness.config.json` → `progressReportQuantification` carries five fields: `transcriptRoot`,
`enforceSinceIso`, `completionKeywordPattern`, `identifierNounPattern`,
`identifierNounSuffixPattern`. No date class exists.

The near-miss fails: `완료` is a **completion keyword**, not an identifier noun, so adding it to
`identifierNounPattern` would suppress genuine `완료 8/14` violations — trading a false positive for a
false negative in the class the scan exists to catch.

## Direction

**Not a pattern rule.** One was implemented and withdrawn on review: `완료(8/14)` (a date) and
`완료(3/20)` (three of twenty) are the same shape, and what separates them is the author's intent,
which is not in the text. Any numeric narrowing trades this false positive for a false negative in
the class the scan exists to catch.

The author states which it is. An acknowledgment entry gains a `kind` — `violation` (the default,
and what every earlier entry meant) or `false-positive`, each with its reason. Both are true
statements. The advisory reports the two counts separately, because a violation says the rule was
broken and a false positive says the scan is wrong, and a single total reads as the first.

## Test Plan

- An entry marked `false-positive` clears its finding and is counted as one.
- An entry with no `kind` is counted as a `violation` — the backward-compatibility case, without
  which adding the field silently reclassifies the ledger's whole existing contents.
- Two kinds in one ledger report as two counts, not one total.
- **A typo'd kind is REFUSED** (`false-postive`), because it would otherwise fall through the
  `?? 'violation'` default and clear a finding while counted as a violation.
- **Positive control**: both valid kinds load, so the refusal above cannot pass against a loader that
  rejects everything.
- `ACKNOWLEDGMENT_KINDS` pinned as data in both directions.
- `pnpm harness:scan` green on the affected host — this item's own unblock condition.

## Not deliberately unacknowledged

`progress-report-acknowledgments.json` states its contract: each entry _"names a real violation of the
quantified-progress rule that has already happened."_ This finding is not one. An entry clearing it
would be a reason rather than a true one, and a ledger for real violations stops meaning anything the
first time it absorbs a false positive. The scan stays red until the class is fixed — a scan wrong
visibly beats a ledger wrong invisibly.

## User Execution Test Scenarios

Not authorable, and left unwritten with the reason recorded rather than filled with a placeholder.
This item changes a developer-host scan and ships no user-facing surface: `robota`'s behaviour, output
and exit codes are identical before and after. The verification that matters is the fixture pair in
the Test Plan, which a user cannot run as a product scenario.

**This reason does not expire.** It is a property of what the item delivers, not of an undecided
disposition.
