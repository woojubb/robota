---
id: HARNESS-054
title: 'HARNESS-054: the progress-quantification scan skips in CI and its local red can never be cleared'
status: done
completed: 2026-08-04
priority: medium
urgency: soon
type: INFRA
area: scripts/harness
created: 2026-07-26
depends_on: [HARNESS-052]
---

## Problem

`scan-progress-report-quantification` is registered in `run-all-scans.mjs`, so it is nominally part
of the CI scan suite. It is not. Its subject is the agent session transcript under
`~/.claude/projects`, which no CI runner has, so on every CI run it prints an explicit SKIP and
exits 0. Measured 2026-07-26:

```
$ HOME=/tmp/nohome node scripts/harness/scan-progress-report-quantification.mjs
progress-report quantification scan skipped: no session transcript for this workspace …
exit=0
```

The SKIP is honest and deliberate — it is not a silent pass. The defect is structural: **the only
environment where this scan can ever fail is a developer's own machine**, and there its red state is
**permanent**. A transcript is append-only history; a finding cannot be edited away. Once the scan
fires, `pnpm harness:scan` is red on that host forever, for every unrelated change.

That is the shape lesson 3 of `.agents/memory/check-validity-two-axes.md` names directly: a guard
that fires and cannot be cleared gets suppressed, and a suppressed guard costs more than what it
catches. The only existing escape is `enforceSinceIso` in `.agents/harness.config.json`, which is
global — moving it to clear one finding disables enforcement for every session before that date.

Observed live: the line `**5 → 6/7 병행 전환 완료.**` (TypeScript 5 → 6/7 side-by-side) was flagged
as `ratio 6/7 reported without a percentage`. The operands are version numbers. The policy already
declares versions a non-count class (`v|version` appear in `identifierNounPattern`), but the noun
must sit inside the 24-character window before the match; here the subject was named earlier in the
sentence. Whether that specific line is judged a false positive or genuinely ambiguous prose is
secondary — either verdict leaves the scan red with no path back to green.

## Proposed direction

Two separable pieces; the first is the one with teeth.

1. **A per-finding acknowledgment path.** A finding is identified by its transcript file + line +
   ratio; record acknowledged findings in a checked-in ledger with a reason, the way other scans
   carry allowlists with anti-rot. Anti-rot must apply: an entry whose finding no longer appears is
   itself a failure, so the ledger cannot silently accumulate. This gives the scan a way back to
   green without disarming it, and makes each waiver a reviewable artifact rather than a config
   ratchet nudge.
2. **Widen the version-reference suppression to sentence scope** for the nouns already declared in
   `identifierNounPattern`, instead of the fixed 24-character lookbehind — and add fixtures for the
   `X → Y/Z` migration form.

Do not treat this as a reason to weaken the completion-keyword vocabulary. The rule it enforces is
sound; what is missing is a clearing mechanism.

## Done when

- A finding can be acknowledged with a recorded reason, and the scan then exits 0.
- An acknowledgment whose finding no longer exists fails the scan (anti-rot proven RED).
- The `X → Y/Z` version-migration form is covered by a fixture, with the verdict — suppressed or
  flagged — stated deliberately rather than falling out of a lookbehind width.
- The CI-vacuity is stated in the scan's own header, so a reader of `run-all-scans` output is not
  led to believe this scan gates anything in CI.

## Implementation (2026-08-04)

**The suite is green for the first time in this session.** `pnpm harness:scan` reported
`1 of 97 scans failed` on every run for days, and this was the one — a guard that fires and cannot be
cleared, which the memory file it cites names as the shape that gets suppressed.

**A per-finding acknowledgment ledger**, `scripts/harness/progress-report-acknowledgments.json`. A
finding is identified by transcript basename + timestamp + ratio — deliberately NOT the excerpt, which
is prose a later reader may requote, and an identity that changes when the quotation is reformatted
goes stale for the wrong reason. An entry with no reason is refused: a waiver nobody had to justify is
the shape this repository rejects wherever it allows one at all.

**Anti-rot, scoped to what was actually read.** An entry whose finding no longer appears FAILS — but
only when this run read the transcript the entry names. On a host without it (CI, a fresh checkout,
another developer's machine) the entry is not judged, because an anti-rot firing over ground it never
covered is the vacuity this harness spends its time removing. That trap has been sprung twice before
in this repository and is pinned by a case here.

**One defect on the first run, and it was the identity.** A finding calls the field `file` and a ledger
entry calls it `transcript`, so every entry read as STALE — two keys for one thing. The key reads both
now, with a case pinning that they agree.

**Four findings acknowledged, all of them mine.** Three from 2026-08-01/02, and a FOURTH committed
while building this very path — a report of the migration progress written as a bare ratio. It is
recorded rather than argued away: that it happened during the fix is the clearest possible evidence
that the rule needs a mechanism rather than an intention.

**The version-migration verdict, stated rather than inherited.** `X → Y/Z` with a NUMBER before the
arrow is already suppressed as a version transition, and that suppression is deliberate and
documented; a WORD before the arrow stays a violation. The prose form `from v5 to 6/7` remains
FLAGGED, and the item's proposal to widen the version-noun suppression to sentence scope is REFUSED on
evidence: a case here shows it would drop a genuine finding from `작업 4/6 완료. 버전 5도 확인했습니다.`
A false positive with two cheap escapes — the arrow form, or the percentage the rule asks for — is a
better trade than a class of false negatives with none.

**The declaration must not depend on the host — review found it did.** The SKIP branch printed no
`::examined::` line, so this was the one scan in the suite whose declaration appeared on a machine that
had run agent sessions and vanished on a fresh checkout. The adoption ratchet counts that line, and
the promotion-to-`main` gate runs the suite UNSKIPPED on a fresh runner, so a baseline that was correct
on this laptop would have turned that required check red. The local `all 97 scans passed` could not
have shown it. Verified by recomputing the count with no transcript directory: 20, the same number.

That is also the invariant working as intended one level up — a skip reporting nothing is exactly the
shape the declaration exists to make visible.

**The CI vacuity is in the scan's own header**, so a reader of the suite summary is not led to believe
this scan gates anything on a pull request. It also declares `::examined::` now, which brought the
adoption ratchet from 19 to 20.
