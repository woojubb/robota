---
title: 'INFRA-126: the harness test suite leaks a temp directory per test, and exhausting /tmp inodes stops every push on the host'
status: done
created: 2026-08-22
completed: 2026-08-22
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
It also fixes the denominator — the 158 creators under `__tests__` are 157 governed direct-calling
modules plus the single sanctioned owner itself. The burn-down is all 157 governed callers, not only
the 85 that currently leak.

## Prior Art Research

The common pattern is lifecycle ownership rather than a raw creator plus independently remembered
teardown:

- [Node.js `mkdtempSync`](https://nodejs.org/download/release/v22.14.0/docs/api/fs.html#fsmkdtempsyncprefix-options)
  returns only a path and leaves cleanup to the caller. Node 24.4 adds a disposable temp-directory
  owner, but this repository runs Node 22.14 and cannot use that API without a separate runtime
  migration.
- [Vitest file-scoped fixtures and test context](https://v3.vitest.dev/guide/test-context#test-extend)
  and [`afterAll`](https://v3.vitest.dev/api/#afterall) colocate setup and teardown at a declared
  lifetime. [Playwright fixtures](https://playwright.dev/docs/test-fixtures) use the same ownership
  model.
- [JUnit `@TempDir`](https://docs.junit.org/5.10.1/api/org.junit.jupiter.api/org/junit/jupiter/api/io/TempDir.html)
  recursively cleans a directory at the owning test/class boundary, while
  [pytest `tmp_path`](https://docs.pytest.org/en/stable/how-to/tmp_path.html) provides unique
  per-test paths and limits retained history explicitly.
- [GitHub Actions `runner.temp`](https://docs.github.com/en/actions/reference/workflows-and-actions/contexts#runner-context)
  is likewise owned by the job lifecycle and cleared at its boundary.

The constraint shared by those references is that bulk deletion is safe only inside a root owned by
the current lifecycle. It does not justify age-based reaping from shared `/tmp`, where another session's
in-flight directory is indistinguishable from abandoned state. For the current Node and Vitest versions,
the compatible design is two-level ownership: `makeTemp()` performs eager file-level cleanup, while
`harness-test-tiers.mjs` points every platform temp variable at one exclusive child root and removes that
whole root in the parent after the child exits. Keep the direct-call floor for both spellings, burn the ledger down to zero,
then remove the empty ledger while leaving the floor in place.

## Three distinct states

| State                          | Current evidence                                                                                                                                                                                                                                                                   |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ownership mechanism            | On `develop`: `scripts/harness/__tests__/make-temp.mjs` is the sanctioned creator, and the registered `temp-dir-owner` floor refuses either direct spelling. On this branch, `harness-test-tiers.mjs` additionally owns and removes one exclusive suite root per child invocation. |
| Frozen source debt             | Complete governed debt: 157 → 0 direct-calling modules. The original ledger tracked 155 top-level tests; review found two previously unenumerated nested helpers. The ledger and its loading path are removed, and the recursive floor passes with no exception mechanism.         |
| Already accumulated disk state | 9,559 top-level `/tmp/robota-*` directories observed at `2026-08-22T08:24:16Z`. This population can include both abandoned and another session's in-flight directories, so it was recorded and left untouched rather than indiscriminately reaped.                                 |

The accumulated population is a third state, not a hidden completion criterion. This change prevents
new leakage; it cannot retroactively prove ownership or lifetime for directories already on disk.
Deleting that population would reintroduce the race the owner design exists to remove.

**Corrected done condition:** the task completes when (1) the governed direct-call set and its ledger
are both gone, (2) the permanent floor passes without an exception ledger, (3) the complete harness
suite passes, and (4) a before/after run observes no surviving runner-owned suite root.
Removing historical shared-`/tmp` state is deliberately not part of completion because its ownership
cannot be established safely from outside the creating process.

Five files were migrated as the first burn-down step and measured at ZERO leaked directories across a
real run. That measurement is what establishes migration works, rather than that it compiles: the
first cut of the helper registered its teardown lazily, passed every unit assertion, and removed
nothing.

## Test Plan

- Count the invocation-owned `robota-harness-suite-*` roots at `/tmp` top level before and after one
  full contracts-tier run; the surviving-name delta must be **0**. The global `robota-*` count is
  recorded separately but is not a valid verdict while another clone's test run is concurrent.
- Per-file check on the five worst offenders: run each alone, assert no new directory survives.
- The new scan goes RED on any `__tests__` file calling `mkdtemp` or `mkdtempSync` directly —
  **including one that cleans up correctly**, since the rule is "use `makeTemp()`", not "clean up
  somehow". Fixtures for both spellings, because a scan catching only the sync form reproduces the
  defect it was written for, and one fixture that creates AND removes its directory, to pin that the
  verdict does not depend on teardown.
- `pnpm harness:scan` green.

## Result

- Governed direct-call debt: **157 → 0** — the ledger's 155 top-level tests plus two nested helpers
  that its original flat reader did not enumerate. `temp-dir-owner-baseline.json` and its loading
  path were removed. The floor now walks the complete tree without following symlinks;
  `node scripts/harness/scan-temp-dir-owner.mjs` examined 239 governed modules and exited 0.
- The live-debt-dependent floor test first reproduced RED (`1 failed | 4,670 passed`) after the debt
  reached zero. It now assembles isolated top-level and nested direct-call fixtures; its targeted run
  passes 18/18.
- Four transformed files contained a local `function makeTemp` shadowing the imported owner. Vitest's
  transform accepted them, but `node --check` exposed invalid ESM. The redundant wrappers were removed;
  all 156 changed test files now pass `node --check`, and the four-file targeted run passes 273/273
  while leaving no new `robota-*` path.
- A full run proved file-level `afterAll` alone was insufficient under the 236-file worker schedule:
  373 directories survived. The parent runner now supplies and removes one exclusive suite temp root;
  the regression fixture deliberately leaves a child directory behind and verifies the parent removes
  both it and the suite root.
- Local review found that `TMPDIR` alone does not control Node's `os.tmpdir()` on Windows, which reads
  `TEMP` and then `TMP`. RED reproduced both that escape and the flat-reader blind spot (2 failed,
  19 passed). The runner now points all three platform spellings at its owned root, the child fixture
  selects its path through `os.tmpdir()`, and the final related 10-file GREEN run passed 389/389 tests.
- Final `pnpm harness:test`: 236/236 files and 4,675/4,675 tests passed; stripped-hermetic verification:
  73/73 files and 1,142/1,142 tests passed. Runner-owned roots were **0 before, 0 after**, with no new
  surviving name. The shared global count changed 10,088 → 10,114 during a concurrent pre-push in
  another clone and was not misreported as this invocation's leak.
- Final `pnpm harness:scan`: 135 scans passed, 2 intentionally skipped.

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
