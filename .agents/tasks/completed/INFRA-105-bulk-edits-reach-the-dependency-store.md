---
title: 'INFRA-105: a bulk edit can reach the shared pnpm store, where git cannot see it'
status: done
completed: 2026-08-21
created: 2026-08-19
priority: high
urgency: now
area: .claude/hooks, scripts/harness, .agents/rules
depends_on: []
---

# INFRA-105: refuse a write that lands in `node_modules`, and the enumerations that get there

## Objective

Close the failure class reported in issue #1884: a bulk edit that enumerates files by filesystem pattern
follows pnpm's workspace symlinks into `node_modules`, and from there into `node_modules/.pnpm` —
whose contents are **hard links shared with every other project on the machine**. A write that lands
there is invisible to `git status`, invisible to every harness scan (they read `git ls-files`, which
cannot list `node_modules`), and survives `pnpm install`, because the store believes the content is
already correct.

The incident that produced issue #1884 was caught because the edit script happened to print the paths it
touched. That is luck. This item installs the mechanical control that does not depend on anyone
looking.

## What was measured, and where the report was wrong

Issue #1884 named `find`, `grep -r`, `rg` without `--no-follow`, shell `**` under `globstar`, and Node's
`fs.glob` as carrying "the same exposure". That list was asserted, not measured. Measured here, on a
directory containing one symlink to a tree holding one matching file:

| enumerator                                        | reaches through the symlink |
| ------------------------------------------------- | --------------------------- |
| `find top -name '*.ts'`                           | **no**                      |
| `find -L top -name '*.ts'`                        | **yes**                     |
| `grep -rl … top`                                  | **no**                      |
| `grep -Rl … top`                                  | **yes**                     |
| `rg -l … top`                                     | **no**                      |
| `rg -l --follow … top`                            | **yes**                     |
| bash `**/*.ts` with `globstar`                    | **no**                      |
| zsh `**/*.ts`                                     | **no**                      |
| `node -e "globSync('top/**/*.ts')"`               | **no**                      |
| python `Path('top').rglob('*.ts')`                | **no**                      |
| python `glob.glob('top/**/*.ts', recursive=True)` | **yes**                     |

So the exposure is **four spellings**, not "any glob", and each has a safe sibling one flag away.
That matters for the design: a guard aimed at the measured four is a guard that can be left on,
where one aimed at every recursive enumeration would fire on correct commands until someone
disabled it. `git ls-files` remains the preferred source — it cannot return a `node_modules` path at
all — but a `find` without `-L` is not the hazard the report claimed it was.

## Plan

- [x] TC-01: `bulk-edit-guard.sh` refuses a `Write`/`Edit`/`MultiEdit` whose `file_path` contains a
      `node_modules` segment, and one whose path reaches the store only after symlink resolution.
- [x] TC-02: it permits an ordinary `packages/**/src` path.
- [x] TC-03: it refuses each of the four measured enumerator spellings in a `Bash` command.
- [x] TC-04: it permits each spelling's safe sibling (`find` without `-L`, `grep -r`, `rg` without
      `--follow`, `Path.rglob`), so the guard is proven to discriminate rather than to fire on the
      shape.
- [x] TC-05: it refuses a content write whose target path names `node_modules`, and does NOT refuse
      `rm -rf node_modules` or `mv node_modules …` — the reinstall idioms.
- [x] TC-06: a mention inside a quoted argument or a heredoc body does not trip it, so this task file
      and the rule text can be written without the ack.
- [x] TC-07: an unreadable payload is refused, not permitted (fail-direction, matching the other
      refusing guards).
- [x] TC-08: `BULK_EDIT_ACK=1` inline in the same command is the documented escape, and is read off
      the masked text so a mention cannot switch the guard off.
- [x] TC-09: `scan-symlink-following-enumeration.mjs` fails a committed script carrying one of the
      four spellings and passes the repository as it stands (measured: zero occurrences today).
- [x] TC-10: the scan is registered in `harness.config.json` and runs under `pnpm harness:scan`.
- [x] TC-11: `pnpm harness:scan` and the harness unit tier are green.
- [x] TC-12: a redirect is judged on its TARGET — reading from the store and writing outside it is
      permitted, writing into it is refused.
- [x] TC-13: a leading environment assignment does not take the command-name slot.
- [x] TC-14: a NEW file inside a symlinked directory is refused, and a new file inside an ordinary
      directory is not.
- [x] TC-15: a flag is attributed past a wrapper that took its own argument (`sudo -u deploy find -L`)
      while a pipeline is still separated.
- [x] TC-16: an in-place editor and a store path must stand in ONE segment.

## Test Plan

Unit tests under `scripts/harness/__tests__/` drive the hook through its real stdin protocol with
synthesised payloads, and assert BOTH directions for every rule: the hazardous spelling is refused
AND its safe sibling is permitted. A guard that only ever gets hazardous input is a guard nobody has
shown can say yes, and that is the shape that gets switched off. The scan is red-proofed against a
temporary fixture carrying each spelling, so "it passes" is a measurement and not the absence of
input.

## Out of scope, and filed rather than dropped

Issue #1884's third item — that a name-based rewrite should confirm each site imports the symbol being
changed rather than merely spelling it — is a real defect and is not addressed here. It is the same
problem ARCH-037 spent six review rounds on, it needs a resolver, and folding it into a path guard
would produce neither. Filed as issue #1887.

## Progress

### 2026-08-19

Measured the exposure table above before writing anything, which corrected the reported list from
"any recursive enumeration" to four spellings.

Two defects the repository's own gates caught, both worth recording because neither was visible from
reading the code:

- **`grep -qxE "-L"` reads `-L` as grep's own flag.** The first cut of the guard permitted `find -L`,
  `grep -R` and `rg --follow` — three of its four rules — while passing every other case. `grep -qxE
-- "$1"` fixes it. A guard whose pattern is passed as an option is a guard that says yes to
  everything it was written to refuse.
- **The flag has to be attributed to the command that received it.** `find packages -name '*.ts' |
xargs grep -L createSession` carries a `-L`, but it belongs to `grep`, where it means
  files-without-match. Reading the flag without its command refused that correct pipeline, so the
  word list is walked and a flag counts only while its own command is current.

Red-proofed rather than assumed: with the symlink-resolution branch disabled exactly one case fails,
with flag attribution removed exactly two fail, with the empty-payload refusal removed exactly one
fails, and the scan was run against a temporary tracked fixture to see it go red.

`rule-case-narrative` then refused the first draft of the rule text, correctly: it retold the
incident. The invariant stays in `operational.md` and the measurements moved here, which is the form
that rule asks for. `guards-pass-silently` refused the guard for having no row saying what it must
leave ALONE, and its `*_ALLOW_*` scrub was widened to `*_ACK` in the same change — three overrides
in this directory use that spelling and were inherited from whatever session ran the suite, which
would have made a row pass because nothing was checked.

A self-review pass before the push found two more, both false-positive directions:

- **A redirect was judged on the command, not on its target.** `cat node_modules/.pnpm/p/package.json
  > /tmp/out` reads from the store and writes outside it — ordinary inspection — and was refused.
- **A leading environment assignment took the command-name slot.** `FOO=bar find -L …` set the
  current command to `FOO=bar`, so the real one was never judged: a miss, not a false positive, and
  the mirror image of the ack-read hole.

Review of the pull request then found three more, and all three were right:

- **The symlink resolution never ran for a file being created.** It tested `-e "$FILE_PATH"`, which
  is false for exactly what `Write` exists to do. A brand-new file inside a symlinked directory
  skipped the block entirely and reached the store. The sharper half of the finding is about the
  TEST: the case that was supposed to cover this pre-created its target with `writeFileSync`, so it
  proved resolution worked on a path that did not need resolving. The existence test now sits on the
  parent directory — which is what carries pnpm's symlink, and which is there whether or not the file
  is — and both directions are cases.
- **A wrapper's own flag argument took the command-name slot.** `sudo -u deploy find -L …` promoted
  `deploy` to current command, so `find` was never recognised and its `-L` sailed through. `nice -n
10 find -L` the same. Fixing the walk would mean maintaining a list of which wrapper flags take a
  value, wrong the day it falls behind; attribution is now SEGMENT MEMBERSHIP — a flag belongs to a
  command whose word stands earlier in the same run between separators — which needs no list. Stated
  limit, and the price of dropping the walk: `find … -exec grep -L {} \;` inherits `find`'s
  attribution and is refused. A pipeline, the common shape, is still separated.
- **The in-place-editor rule was two unscoped substring greps.** "An editor anywhere AND a store path
  anywhere" refused `sed -i 's/a/b/' src/a.ts && ls node_modules/.bin`, where the two have nothing to
  do with each other — a conjunction read out of a coincidence. Both must now stand in one segment.

Red-proofed one at a time: restoring the file-existence test fails exactly the new-file case,
removing the segment split fails exactly three, and removing the editor rule's segment reset fails
exactly one.

### 2026-08-21

Closed. The implementation is `420409f80` (pull request #1886, squashing issue #1884's fix), on `develop`. The
follow-up review of that pull request produced three items that are NOT this task and were filed as
their own: issue #1898 (flag attribution has two implementations), issue #1899 (the guard hand-rolls
path canonicalization and fails open) and issue #1903 (a redirect target has no owner). Each is a
shared-ownership gap the guard exposed rather than a defect in the guard's own verdicts, which is why
they are separate causes and not reopened plan items here.

Verification at close: `pnpm harness:scan` 129 scans, 0 failures (5 advisory `dist`-staleness notes,
which are not verdicts); `pnpm harness:test` 221 files / 4087 tests and 73 files / 1113 tests, all
passed, exit 0.
