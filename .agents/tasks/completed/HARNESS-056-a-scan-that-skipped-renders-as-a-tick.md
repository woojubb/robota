---
id: HARNESS-056
title: 'HARNESS-056: a scan that skipped renders as ✓, so the suite total overstates what ran'
status: done
completed: 2026-08-04
priority: medium
urgency: soon
type: INFRA
area: scripts/harness
created: 2026-07-27
depends_on: [HARNESS-052]
---

## Problem

INFRA-060's audit recorded this as **D6** and marked it FILED. Nothing was filed — this item is that
filing, written after the audit's follow-ups were reconciled and D6 turned out to have no target.

`run-all-scans` decides a scan's mark from its exit code. A scan that ran nothing and exited 0
because it had no subject is indistinguishable from one that examined its whole subject and found it
clean: both print `✓`, and both are counted in `all N scans passed`.

Measured on this host: `scan-progress-report-quantification` prints

```
progress-report quantification scan skipped: no session transcript for this workspace …
```

and exits 0, so the suite shows `✓ progress-report-quantification` and counts it toward the total.
On a CI runner that is EVERY run — the scan has no subject there and can never fail. The output is
honest; the summary line above it is not.

`"all 80 scans passed"` is therefore weaker than it reads, and it is the line people actually read.

## What changed since the audit, and what did not

HARNESS-053 (#1491) gave the runner a third output channel: a scan may mark a line
`::advisory::` and it is surfaced even on exit 0, without touching the verdict. That is the
mechanism this needs — a skip is exactly an advisory — but no scan uses it to declare a skip, and
the `✓` mark and the count are unchanged. The channel exists; the skip is not routed through it.

## Proposed direction

- A scan that skipped says so through the advisory channel, and the runner renders it distinctly
  (`↩` rather than `✓`).
- The summary counts what RAN, and states skips separately: `78 passed, 2 skipped` rather than
  `all 80 scans passed`.
- Deliberately NOT a failure. Skipping is legitimate — a transcript-reading scan has nothing to read
  in CI, and failing there would fire on correct configuration on every run, which is how a guard
  gets disabled. The defect is the misreporting, not the skip.

## Done when

- A skipped scan is visually distinct from a passing one in `pnpm harness:scan` output.
- The suite summary separates ran from skipped, proven by a run containing at least one of each.
- A scan that exits 0 having examined nothing cannot report `✓` — proven RED by executing one
  against an empty subject, not by reading the runner.

## Implementation (2026-08-04)

Both halves of the proposed direction, and the mechanism came from the sibling item rather than being
invented here.

**A skip is now a machine-readable fact, not a sentence.** HARNESS-057 gave the runner an
`::examined:: <n> <subject>` declaration and made a zero WITHOUT a reason a hard failure. A zero WITH
a reason is exactly what a skip is: the scan ran, found no subject, and said which and why. The runner
reads that, so no scan had to learn a second convention.

**Three marks, not two.** `✗` failed, `↩` skipped, `✓` examined its subject and found it clean.

**The count states what RAN.** `all 97 scans passed` became `97 scans passed`, and on a host without
the subject:

```
↩ progress-report-quantification
96 scans passed, 1 skipped (20 declared what they examined)
```

That is the same suite on the same commit — the difference is the host, which is the whole point: on
every CI runner this scan has no subject, and the old summary counted it as evidence.

**Two existing cases asserted the old wording** and were updated rather than worked around. They
asserted `all N scans passed`, which is the sentence this item filed as weaker than it reads; leaving
them would have pinned the defect.

**An undeclared zero is NOT a skip.** A scan that reports zero without saying why still fails, and a
case pins that — otherwise the skip mark would have become a way to launder the very state
HARNESS-057 refuses.
