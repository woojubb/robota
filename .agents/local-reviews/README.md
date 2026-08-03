# Local review records — a LOCAL NOTE CACHE, not gate evidence

**Demoted 2026-08-03 (HARNESS-066).** This directory is gitignored and keyed on the local branch and
HEAD, so the clone that performs a merge cannot see it. It is a convenience for the machine that ran
the review, and nothing more.

It once fed a blocking decision, and that was a measured defect rather than a theory.
`.github/workflows/review-gate.yml` records what happened:

> the merging clone held a record for a DIFFERENT branch and would have answered one PR's merge with
> another PR's disposition.

The blocking decision moved to a PR label, which the merging clone CAN see. The directory and its
records stayed, with nothing saying they had been demoted — so a reader could still mistake them for
the evidence a gate runs on. This file is that missing sentence.

`pnpm harness:review:record` still writes here, and `pre-push-check.sh` still reads it to catch an
unreviewed push locally. Both are useful; neither is authoritative for anyone but this machine.
