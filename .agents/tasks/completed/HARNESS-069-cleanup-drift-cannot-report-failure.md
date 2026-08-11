---
title: 'HARNESS-069: `cleanup-drift` has no non-zero exit path at all — it cannot report a failure to anything that runs it'
status: done
completed: 2026-08-03
created: 2026-08-02
priority: low
urgency: later
area: scripts/harness
depends_on: []
---

# HARNESS-069: a script that can only succeed

## Problem

`scripts/harness/cleanup-drift.mjs` contains **neither `process.exit` nor `process.exitCode`** —
verified, zero matches. Whatever it finds, it exits 0. It has no way to tell a caller that something
was wrong.

## Evidence

Raised by an external read-only investigation (2026-08-02) and re-verified here:

```
$ grep -c "process.exit\|exitCode" scripts/harness/cleanup-drift.mjs
0
```

**One correction to the report, made after checking.** The investigation wrote that this is vacuous
_"if it is registered as a gate"_. It is **not** registered as a gate: it appears only as the
`harness:cleanup` script in `package.json`, and is absent from `run-all-scans.mjs` and from every
workflow in `.github/`. So the severity is lower than the finding reads — this is a utility that
cannot signal failure, not a green gate over unchecked ground.

That distinction is why this is filed separately at low priority rather than inside HARNESS-064.
Recording it matters both ways: the finding is real, and it is smaller than stated.

## Why this is foundational (or not)

**LOCAL, and mild.** A cleanup utility run by hand may legitimately be advisory. The question is
whether it is _intended_ to be — and nothing says so, which is the actual defect. A reader cannot
distinguish "advisory by design" from "nobody added the exit path".

## Direction

Decide which it is and make the file say so.

- If it should fail on drift it cannot clean: set `process.exitCode` and give it a test.
- If it is advisory by design: say that in its header, and make sure nothing registers it as a gate
  later without revisiting.

Note the interaction with HARNESS-065: that Task converts `process.exit()` callers to
`process.exitCode`. This script is in neither group, so a sweep over "scripts that call exit" will
not reach it. A script with **no** exit path is invisible to a check that looks at how scripts exit.

## Test Plan

- If the outcome is a non-zero exit: **required red-first regression** — a drifted tree must produce
  a non-zero exit, proven failing first.
- If the outcome is "advisory by design": no code change, and no test to fabricate. Say so rather
  than adding an assertion that pins nothing.
- `pnpm harness:verify-like-ci` green.

## User Execution Test Scenarios

**Does not apply.** Repo tooling only.

## Implementation

The decision the task asks for: **it should fail**, and the evidence for that is inside the script.
Its JSON report already carries `passed: driftCount === 0` — the verdict existed and was simply never
published. This was the one script in the harness that could not break "silence is not success".

A RATCHET rather than a flat gate, for the reason every other one in this session used: there are 71
findings today, and a check that is red on arrival is suppressed rather than obeyed. Per-type counts
are frozen in `cleanup-drift-baseline.json`; they may fall and must never rise, and a fall demands a
re-freeze in the same change.

Red-proved both directions and at the CLI: lowering a frozen count exits 1 with `drift GREW`, raising
one exits 1 with `drift FELL`, and removing the single `publishVerdict` call makes both cases fail
while the pass case still passes.

**Where the ratchet is enforced — and the claim I got wrong about it.** The task recorded that this
is not registered as a gate, and the first version of the fix repeated that in a docstring and pinned
it with a case asserting `run-all-scans.mjs` does not mention the script. Review measured the actual
path: `scripts/harness/__tests__/cleanup-drift.test.mjs` asserts the script's exit code **against the
live tree**, `pnpm harness:test` runs that whole directory, and CI reaches it on both sides: the
`scans` job (`if: github.base_ref != 'main'`) runs it as a step, and a promotion to `main` runs it
inside `harness:verify:release`. So it IS a required check on every PR — through the test suite
rather than the scan registry. A comment asserting the opposite, in a change about a script that
could not report failure, is this repository's most-measured defect class; one grep of `ci.yml`
disproved it. The docstring, the test file's header and `scripts/harness/README.md` now say where the
enforcement actually is.

That sentence took three passes to get right, and the third correction is the instructive one: the
second version said "unconditionally in the `scans` job" and was corrected in the code and the README
— but not here, so this record contradicted itself in a single paragraph while claiming the
correction had been applied everywhere. Round 3 caught it. The claim "I fixed it in all N places" is
the same defect as the original claim, one level up.

**Three further defects review found in the fix itself:**

- **A failed measurement read as progress.** Every `grep` call site tested `status !== 0` and
  continued. grep has three outcomes — 0 matched, 1 did not, **2+ grep failed** — and conflating the
  third with the second turned an unreadable tree into a clean bill of health. Demonstrated with a
  stub exiting 2: findings 71 → 32, nothing printed, and the ratchet said `drift FELL` and told the
  operator to re-freeze, which would have baked zeros in and disabled three of its four rows
  permanently. Now a hard error carrying grep's own stderr, red-proved (pre-fix: exit 0).
- **Nothing required the tree it judges.** Over a root with no `packages/`, three of four rows count
  zero and the verdict is "drift FELL" — a scan reporting on ground it never examined. Now fail-closed
  and red-proved against a seeded bare root (pre-fix: exit 0; the first version of that case was a
  weak red, passing only because the unfixed script died on a missing `pnpm-workspace.yaml`).
- **Two verdicts for one run.** The JSON report's `passed` field read `driftCount === 0` while the
  exit code read the ratchet, so a run at baseline wrote `passed: false` and exited 0. One verdict now
  feeds both.

**Round 2 found the fix incomplete in the way the fix was about.** Three of the four grep call sites
were converted; `checkForbiddenTerms` was not — and with a stub failing only for `<package>/src`,
every forbidden-term measurement failed, nothing was printed, and the script exited 0. Meanwhile the
docstring, the task file and `scripts/harness/README.md` all said "every grep call site". A claim of
completeness that was three-quarters true, in a change whose subject is a script that could not report
failure. Converted and red-proved against the previous commit, with a stub scoped to that one site —
a stub that broke every grep could not have caught it, because the first thrown error would have come
from an already-converted site.

Two more from the same round: the local `requireGovernedTree` was a private twin of the shared
HARNESS-052 helper, which breaks the property that helper exists for ("`requireGovernedTree` greps to
which scans have been through the sweep") — the one-owner violation HARNESS-068 is about, in the same
PR; and the `CLEANUP_DRIFT_BASELINE` override was silent, so a run against an untracked baseline
printed a verdict indistinguishable from a real one. Both fixed; the override now announces itself the
way `GUARD_LEDGER_CEILINGS` does.

Also from round 2: `stale-tmp-doc` is excluded from the ratchet because it is derived from mtime
rather than from the tree — a fresh CI checkout resets every mtime and can never reach the 14-day
threshold, while a working copy whose `.design/tmp/` files have sat past it would turn `harness:test`
red with no code change, and a ratchet is a claim about a COMMIT. It is still reported and still
counted. (Round 6 corrected an "over a weekend" phrasing of this in three places and its commit
message said three; there were FOUR, and the survivor was in this file five lines above round 6's own
edit. Round 2's "three of four call sites under a claim of _every_" recurring inside the record that
documents it — round 7's finding.) And a `--write-baseline` run now writes `verdict: "baseline-frozen"`
instead of `passed: true`: a freeze measures, it does not judge, and claiming a pass nothing checked
is the same defect one field over.

**Round 4 replaced a docstring promise with a case.** Round 2 excluded `stale-tmp-doc` from the
ratchet, round 3 from the freeze as well, and each said so in a docstring with nothing exercising
either. (The first version of this paragraph credited both halves to round 3, contradicting a
sentence eight lines above it in this same file — the "record contradicts itself in one paragraph"
defect that this file records as round 3's own finding, committed again by the paragraph recording
round 4. Round 6 caught it.) There is now a case that seeds an aged `.design/tmp` document and asserts
the finding IS reported and is NOT frozen. Its first version aged that fixture inside the repository's own tree and restored it in a
`finally`, which is the pattern the same file's header rejects three paragraphs above ("a restore that
a timeout or a SIGKILL never runs") — round 5 caught the file contradicting itself, and it now runs
against a seeded temp root.

One correction to the record rather than the code: the round-4 commit message says that case was
"red-proved against the previous commit". It was not — the previous commit already carried round 3's
freeze filter, and the case passes there. The genuine pre-fix state is `38b41cc84`, two commits back,
where it fails on the exact assertion. The red-proof is real; the commit named the wrong state, which
would have sent the next reader to a green and left them concluding the case guards nothing.

Also: the test file was named `cleanup-drift-verdict.test.mjs`, and the harness's own untested-script
ratchet matches a test to its subject by the `<base>.` prefix — so it went on counting
`cleanup-drift.mjs` as untested. Renamed and the baseline re-frozen 27 → 26, which is the same
discipline this change applies to its own baseline. The fixture cases now point at a temp baseline via
`CLEANUP_DRIFT_BASELINE` instead of editing the tracked file and restoring it in `afterEach` — a
restore a timeout never runs.

One measurement error worth recording: my first check read `node … | tail -2; echo $?` and reported
exit 0. `$?` after a pipe is the LAST command's status, so I was reading `tail`. Measured again
without the pipe: exit 1, correct all along.
