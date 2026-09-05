# Recurrence Ledger

**What this is.** One row per recurring mistake CLASS, with a count that only goes up. Between
harness cycles a mistake is recorded here rather than mechanized (`learning-loop.md` § "Mechanisms
Land on a Cycle"); the counts are what the next cycle prioritises by.

**The count is never reset, and never deleted — including after a mechanism lands.** That is the
point of keeping it: `Mechanism` records what was built and at what count, so a later increment is
evidence the mechanism did not work. A class whose count moves after its mechanism landed goes back
to the top of the next cycle, and the row says how many times that has now happened.

**How to record.** On meeting a mistake, find the class here first. If it exists, increment `Count`,
update `Last seen`, and add a dated line naming the instance. Only add a row when no existing class
fits — a new row for something already listed hides the recurrence, which is the one thing this file
exists to prevent.

**A class ages out; it does not get cleared.** A row whose `Last seen` is more than **90 days** old
is RETIRED at the next cycle: moved to `## Retired` at the foot of this file with its count and dates
intact. Retirement says the class stopped happening, which is a different claim from a mechanism
having shipped — and the two must not be confused, because a mechanism that shipped and did not work
is exactly what the count is for.

If a retired class recurs, it comes back with its **old count carried forward**, not from zero. The
history is the evidence: a class on its third return has told you three times that whatever was done
about it was not enough, and starting the count again would erase the only part of that worth
knowing.

**Counts below are measured**, from review findings and CI failures on PRs #1647–#1658 unless a row
says otherwise. They are a floor: only what was written down is counted.

**Every date here is UTC**, because the evidence is UTC: a GitHub commit, review comment or check run
carries a UTC timestamp, and a reader comparing a row against the PR it cites is reading UTC. Saying
so is not pedantry — it was a review finding. Rows were first written in the recording session's
local time (KST, UTC+9), which put four of them a calendar day AHEAD of the evidence they named, and
they read as future-dated. They are restated in UTC below. Nothing about the 90-day retirement rule
turns on a day either way; what it turns on is the file saying which clock it keeps.

---

## L1 — A claim that does not match the code

**Count: 28** · First seen 2026-08-06 · Last seen 2026-08-07 · Mechanism: none — undecidable by a machine · Rule: `verification.md` § "Prose Is
Written Last, Against the Diff"

A comment, SPEC line, PR body, changeset or commit message asserting something the diff does not do.

- 2026-08-06 — comment claimed the model still saw the same payload; the throw path changed it (#1651)
- 2026-08-06 — SPEC said `CommandExecutor`/`HttpExecutor` are exported from `hooks/index.ts`; the same diff moved them (#1652)
- 2026-08-06 — SPEC listed `isPathInside`/`canonicalizePath` under the main barrel after they moved to `/node` (#1652)
- 2026-08-07 — route comment declared a TOCTOU absent; it is real (#1656)
- 2026-08-07 — PR body claimed fifteen cases never ran; they all did (#1651)
- 2026-08-07 — changeset advertised a `TTurnNotRunReason` member no code path produces (#1653)
- 2026-08-07 — hook comment said "reported at session start" while the code also ran on stop (#1657)
- 2026-08-07 — helper claimed it ended a duplication while both copies remained (#1653)
- 2026-08-07 — comment said a length check leaks nothing because the length is "fixed and public"; true only of a minted token (#1655)
- 2026-08-07 — a test comment said a substitution case was newly caught; RAN against the pre-fix hook, it was already exit 2 (#1654)
- 2026-08-07 — the PR body's summary table lagged the ledger it summarised: four counts lower than the file's own, on the change that ADDS the rule "Prose Is Written Last, Against the Diff" (#1659)
- 2026-08-07 — and again, twice more, on the same table in the same PR. THIRD instance: the fix is no longer a corrected number but a removed OWNER — the table carries no counts at all now, and the file is the only place they live (#1659)
- 2026-08-07 — two scan headers said `main`'s required jobs "declare `needs: []`"; they declare no `needs:` key at all. Functionally identical, and still a claim the code does not make (#1659)
- (15 further instances of the same shape across #1647–#1658, not itemised)

## L2 — A measurement made against my own fixture

**Count: 4** · First seen 2026-08-07 · Last seen 2026-08-07 · Mechanism: none — undecidable by a machine · Rule: `verification.md` § "A Fixture
Decides Nothing Until It Reproduces Reality"

A probe, stub or fixture that did not behave like the thing it stood in for, and whose answer was
then reported as a property of the code.

- 2026-08-07 — a `submit` stub with no suspension point "proved" the HTTP race did not exist (#1656)
- 2026-08-07 — a `gh` stub ignoring `--limit` passed a truncation check that had lost the property (#1657)
- 2026-08-07 — a test run from the repo root "proved" fifteen cases were unreached (#1651)
- 2026-08-07 — a positional-argument grammar assumed for `perl`, which reads that argument as a filename (#1658)

## L3 — A new mechanism whose first version has the defect it guards

**Count: 22** · First seen 2026-08-07 · Last seen 2026-08-07 · Mechanism: the cycle itself — `learning-loop.md` § "Mechanisms Land on a Cycle"

Findings raised against mechanisms added to prevent mistakes, in their first version.

- 2026-08-07 — worktree gate + hook: 5 (newline separator, `git -C`, variable-list drift, restore exemption scoped to the whole command, gate/hook thresholds differing silently)
- 2026-08-07 — `scan-transport-admission`: 3 (no test, hardcoded scope, not fail-closed)
- 2026-08-07 — open-issue notice: 7 (ran on stop, no deadline, silent on a failing `gh`, gated on a task directory, silent truncation, floor not listed, re-implemented an owned helper)
- 2026-08-07 — `scan-browser-package-node-subpath`: 1 (read one level of a two-level workspace)
- 2026-08-07 — interpreter classification: 4 (positional bypass, sibling pattern untouched, `deno` subcommand form, `perl`/`php` misgrouped)
- 2026-08-07 — the worktree guard's own deferral was a bypass: inside a correctly assigned worktree, `GIT_DIR=/elsewhere/.git git reset --hard` was permitted, because the block it deferred to resolves through the scrub and cannot see a redirect (#1654)
- 2026-08-07 — the REPLACEMENT checkout reader judged the `--` restore exemption in-line, so it returned the ref of `git checkout <ref> -- <path>` and blocked correct work; the existing case caught it before it left the branch (#1654)

## L4 — Re-deriving something the repository already owns

**Count: 6** · First seen 2026-08-07 · Last seen 2026-08-07 · Mechanism: none yet — candidate for the next cycle

Writing a second answer to a question a file already owns, usually a worse one.

- 2026-08-07 — hand-rolled `timeout 5s` beside `bounded-gh.sh`, which exists because `timeout` is absent on macOS (#1657)
- 2026-08-07 — a bare `git` call where `hook_git_in` owns the scrubbed form (#1654)
- 2026-08-07 — a hand-rolled workspace walk where `listWorkspacePackageDirs` owns the layout (#1652)
- 2026-08-07 — the ambient-variable list spelled out in three files, already drifted 7 vs 9 (#1654)
- 2026-08-07 — `TTurnNotRunReason` respelt as literals beside the contract that owns it (#1653)
- 2026-08-07 — two blocks of one hook split statements with their own `tr` and `sed` while `hook_statement_ranges` owns the split — in the file whose stated subject is that there must be ONE reading (#1654)

## L5 — A check that does not look at its whole subject

**Count: 6** · First seen 2026-08-07 · Last seen 2026-08-07 · Mechanism: partial — `scan-guard-scope-fail-closed` covers the missing-tree case only

A guard reporting clean over something it never read.

- 2026-08-07 — `scan-browser-package-node-subpath` read `packages/*` one level deep, missing the nested family and every app; the wider read found three real violations (#1652)
- 2026-08-07 — the restore exemption matched the whole command, so one harmless checkout erased detection of a real one (#1654)
- 2026-08-07 — `scan-required-check-needs` tests exercised two helpers and never the finder (harness audit)
- 2026-08-07 — the worktree guard read the `-C` from the WHOLE command and spelled its four destructive rules twice with different windows; a harness audit RAN five commands past it and got exit 0 for every one (#1654)
- 2026-08-07 — `pre-push-check` judged five worktree pushes against the MAIN checkout's branch record, which named a sixth, already-merged branch. Refused correct work; the mirror case waves an unreviewed push through (#1662). Third instance this week of a guard answering about the wrong repository
- 2026-08-07 — the HTTP busy check saw only turns this route claimed, so a turn started by another surface was invisible (#1656)

## L6 — Dead code left by a change

**Count: 12** · First seen 2026-08-07 · Last seen 2026-08-07 · Mechanism: partial — lint reports unused imports as WARNINGS, which do not fail

Imports, comments and checks left behind by the change that removed their subject.

- 2026-08-07 — seven dead imports in `permission-enforcer.ts` after the wrapper moved (#1651)
- 2026-08-07 — two comments describing methods the same change deleted (#1651)
- 2026-08-07 — `mintToken` orphaned once WS moved to the shared seam (#1655)
- 2026-08-07 — an unreachable form check `PATHISH` already guaranteed (#1647)
- 2026-08-07 — removing a scan rule left its one-line wrapper `jobExcludesMain` with no production caller and a docstring still naming the caller (#1659). Found by review ON the change that added this ledger — a lint rule that only WARNS is why

---

## L7 — Fragmenting one approved outcome into repeated process gates

**Count: 2** · First seen 2026-09-05 · Last seen 2026-09-05 · Mechanism: open — next consolidated
harness cycle, tracked by this open entry after the PROC-034 cadence amendment · Rule: `execution-cadence.md`

- 2026-09-05 — a second continuation checkpoint was added to the same S2 branch after a local
  clarification, then required recovery despite the existing valid entry checkpoint.
- 2026-09-05 — per-supplement scope questions and validation handoffs continued after repeated owner
  requests to batch work. Owner explicitly approved the permanent rule/skill amendment and made it
  the highest priority. These two concrete instances are the counted floor, not an estimate of prior days.

## Retired

Classes whose `Last seen` passed 90 days. Counts and dates are kept: a return carries the old count
forward.

_(none yet)_
