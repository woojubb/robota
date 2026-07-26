---
id: HARNESS-054
title: 'HARNESS-054: the progress-quantification scan skips in CI and its local red can never be cleared'
status: todo
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
