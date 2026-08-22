---
title: 'INFRA-126: the harness test suite leaks a temp directory per test, and exhausting /tmp inodes stops every push on the host'
status: in-progress
created: 2026-08-22
priority: high
urgency: now
area: scripts/harness/__tests__, scripts/harness
depends_on: []
---

# INFRA-126: the test suite leaks a temp directory per test

## Problem

Every push from this clone failed with `no space left on device`, raised by zsh writing its own cwd
file. It was not a space problem. `df -h /tmp` showed **4.3G free at 45%** while `df -i /tmp` showed
**1048576 of 1048576 inodes used, 100%**.

The filesystem had run out of INODES, and the error names the wrong resource — which is why the
first reading was "the disk is full" and the first instinct was to look for large files.

## Cause

Not the scans. The harness **test suite**: a test creates a temp directory per case and never
removes it, so every run of the pre-push contracts tier and every CI run adds more.

Measured on this tree:

|                                                        | count        |
| ------------------------------------------------------ | ------------ |
| harness test files that create temp directories        | 158          |
| of those, files with NO `afterAll`/`afterEach` cleanup | **85 (54%)** |

The five largest populations on disk, each from a test file with **zero** cleanup blocks:

| prefix                           | dirs on disk | test file                              |
| -------------------------------- | ------------ | -------------------------------------- |
| `robota-measurement-provenance-` | 315          | `scan-measurement-provenance.test.mjs` |
| `robota-dist-freshness-`         | 225          | `scan-dist-freshness.test.mjs`         |
| `robota-task-agreement-`         | 216          | `check-task-archival.test.mjs`         |
| `robota-sdk-public-surface-`     | 162          | `check-sdk-public-surface.test.mjs`    |
| `robota-spec-frontmatter-`       | 153          | `check-spec-doc-frontmatter.test.mjs`  |

**Rate, measured rather than estimated.** One run of `scan-measurement-provenance.test.mjs` — 42
tests — left **41 new directories** behind. Roughly one per test case. At the peak **58,856**
`robota-*` directories were sitting at the top level of `/tmp`.

The pattern that works is already in the tree, in the files that do clean up:

```js
const scratch = [];
afterAll(() => {
  while (scratch.length > 0) rmSync(scratch.pop(), { recursive: true, force: true });
});
```

## Why the obvious detector under-reports it

Worth recording, because it produced a reassuring wrong number first. A survey matching
`mkdtempSync` alone returns **26 of 96 (27%)** — and none of the five worst offenders appear in it,
because they use the **async `mkdtemp` from `node:fs/promises`**. The instrument was narrower than
the population and the shortfall read as good news. Counting both spellings gives 85 of 158 (54%).

The nearest recorded shape is `common-mistakes` entry 91 — a measurement taken with the instrument
not fully assembled reports on itself rather than on the subject. There it is a guard probed outside
its fixtures; here it is a survey regex narrower than the population it surveys.

A second instance happened while cleaning up after the rate measurement above, and it is entry 92
exactly: `find /tmp -maxdepth 1 ... -exec rm -rf {} +` with stderr suppressed reported nothing,
removed nothing, and read as done. The directory count was unchanged and only a re-count caught it.
A loop removing one directory at a time, each verified with `[ ! -d "$d" ]`, removed all 35.

## Directions

1. **Add cleanup to the 85 files.** Mechanical, large, and leaves nothing preventing the 86th.
2. **A shared `makeTemp()` helper** the tests import, owning creation and teardown together, plus a
   scan refusing a bare `mkdtemp`/`mkdtempSync` in `__tests__`. Fixes the instances and closes the
   class. The scan is the part that makes 1 stay done.
3. **Reap by age at suite start** — cheap, hides the defect, and races a concurrent session's
   in-flight directory. Rejected unless it is a stopgap under 1 or 2.

Recommendation: 2, with 1 as its burn-down. Note the scan must match BOTH spellings, which is the
whole lesson of the section above.

**The scan refuses a direct call REGARDLESS of teardown, and that is deliberate.** The tempting
alternative — flag a direct call only when the file has no teardown — puts the scan in the business
of deciding whether a given directory is cleaned up, which it cannot see: "the file contains
`rmSync` somewhere" is not "this directory is removed". It would also be wrong in the safe
direction on real code. Six test files added in one session use a bare `mkdtempSync` and DO clean up
correctly via a `scratch` array and an `afterAll`; a teardown-conditional scan passes them, and a
scan that passes correct-but-unsanctioned code teaches nothing about the rule it enforces.

Making `makeTemp()` the only sanctioned creator removes the judgement entirely: the subject becomes
the CALL SITE, which is textual and exact, rather than the teardown, which is behavioural and is not.
It also fixes the denominator — the burn-down is every direct call under `__tests__` (**158 files**),
not only the 85 that currently leak.

## What shipped, and what has not

The MECHANISM is on `main`: `scripts/harness/__tests__/make-temp.mjs` as the sanctioned creator, and
the `temp-dir-owner` floor refusing a direct call in either spelling regardless of teardown —
registered, classified in `MANDATORY_TREE_GUARDS` and in `measurement-provenance` `covered`, with its
own tests.

**The leak is capped, not closed.** 155 files still call `mkdtemp`/`mkdtempSync` directly and are
frozen in `temp-dir-owner-baseline.json`; each still leaves a directory per test case on every run.
What the floor prevents is a 156th, and what the burn-down measures is the distance to zero.

So this record stays open, and `in-progress` rather than `done`: the defect it names — the suite
exhausting `/tmp` inodes — is still reachable from those 155, only more slowly and without growing.
It becomes `done` when the frozen set is empty, at which point the baseline file is itself the
evidence and can be removed with the floor left in place.

Five files were migrated as the first burn-down step and measured at ZERO leaked directories across a
real run. That measurement is what establishes migration works, rather than that it compiles: the
first cut of the helper registered its teardown lazily, passed every unit assertion, and removed
nothing.

## Test Plan

- Count `robota-*` directories at `/tmp` top level before and after one full contracts-tier run; the
  delta must be **0**.
- Per-file check on the five worst offenders: run each alone, assert no new directory survives.
- The new scan goes RED on any `__tests__` file calling `mkdtemp` or `mkdtempSync` directly —
  **including one that cleans up correctly**, since the rule is "use `makeTemp()`", not "clean up
  somehow". Fixtures for both spellings, because a scan catching only the sync form reproduces the
  defect it was written for, and one fixture that creates AND removes its directory, to pin that the
  verdict does not depend on teardown.
- `pnpm harness:scan` green.

## Notes for whoever takes it

- **Do not reap indiscriminately.** Several sessions share this clone and a directory younger than
  the longest test run may be in use. The cleanup that recovered the host spared everything touched
  within the hour, and that is worth stating as a property rather than a courtesy: from outside the
  process there is NO way to tell an in-flight temp directory from an abandoned one. An age
  threshold is a guess at that distinction, which is why direction 3 is a stopgap and not a fix —
  and it is the same property a `makeTemp()` owner removes, because the creator is the only thing
  that knows when it is finished with the directory.
- Registering the new scan touches `run-all-scans.mjs`. Several sessions edit that file; a
  registration is one entry, so rebase onto the integration branch first and the lines will not
  overlap. The scan module and its tests are separate files nobody contends, so they can land even
  if the registration has to wait.

## User Execution Test Scenarios

Not applicable — this is repository test-hygiene and harness infrastructure; it delivers no
user-facing behavior. Verification is the before/after directory count in `## Test Plan`, per
`.agents/tasks/README.md`.
