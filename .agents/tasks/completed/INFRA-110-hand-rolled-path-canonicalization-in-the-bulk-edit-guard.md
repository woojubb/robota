---
title: 'INFRA-110: the bulk-edit guard hand-rolls path canonicalization, and it fails open'
status: done
completed: 2026-08-21
created: 2026-08-19
priority: high
urgency: next
area: .claude/hooks
issue: 'https://github.com/woojubb/robota/issues/1899'
depends_on: []
---

# INFRA-110: canonicalize a write path with a canonicalizer, not with a dirname climb

## Objective

`bulk-edit-guard.sh` must answer one question about a write: **where does this path actually land?**
It answers it with `resolved_through_existing_ancestor`, twelve lines of bash that climb with
`dirname` to the deepest existing directory, resolve that with `cd` + `pwd -P`, and re-attach the
segments that do not exist yet.

The function has no stated domain, so its correctness is defined by whichever input shapes a reviewer
happened to try. Three review rounds of pull request #1886 have each found a new shape.

## The measurement

In a sandbox where `app/vendored -> ../node_modules/pkg` and
`app/filelink.ts -> ../node_modules/pkg/src/index.ts`:

| write target                            | exit | should be |
| --------------------------------------- | ---- | --------- |
| `app/vendored/src/new.ts`               | 2    | 2         |
| `app/filelink.ts`                       | 0    | 2         |
| `app/nonexistent/../vendored/src/x.ts`  | 0    | 2         |
| `app/../app/vendored/src/x.ts`          | 2    | 2         |
| `app/vendored/src/new.ts`, `CDPATH` set | 0    | 2         |

Three holes, each an input class a canonicalizer handles without being told:

- **`CDPATH` is honoured by `cd`**, so an exported `CDPATH` makes the resolution silently select a
  different directory — and `cd` then prints the selected path to stdout, so `RESOLVED` comes back as
  two newline-separated paths. This is a fail-OPEN, against the refuse direction the file declares in
  its own header.
- **A `..` after a missing segment is re-attached verbatim** and never normalised, so the write walks
  back out of the missing directory and into the store unseen.
- **The final component is never resolved**, only its ancestors, so a symlinked FILE into the store
  is permitted while the sibling symlinked directory is refused.

## Why it is here and not fixed in place

Each hole is a one-line patch, and patching all three produces a hand-rolled `realpath` with four
special cases and still no stated domain — the next class (`~`, a trailing slash, a `.` segment, a
relative path resolved against a cwd that is not the project directory) found by the next reviewer
rather than by the code. The three rounds already spent are the evidence that this converges slowly
or not at all:

- round 1: `-e "$FILE_PATH"` is false for the file being created.
- round 2: the parent may not exist either — add the ancestor climb.
- round 3: `CDPATH` fails open, `..` is not normalised, the leaf is not resolved.

`scripts/harness/scan-shell-portability.mjs` already names the portable replacement for the
GNU-only `readlink -f` that this file correctly avoided, and `node` is already invoked from this hook
directory by `pre-push-check.sh` and `task-tracking.sh` — so the dependency is one this directory
already carries.

## Direction — decided

Replaced the climb with the ordinary segment-walk canonicalizer, in pure shell. The open question was
cost: whether a resolution with a stated domain would have to be a `node` invocation per write.

**It does not, and the question turned out to point the other way.** The pure-shell walk is CHEAPER
than what it replaces on a deep path — 19.3 ms against 136.4 ms on a 40-segment path — because the old
climb forked `dirname` and `basename` once per level. The full measurement is recorded under Progress.

## Completion criteria

- [x] TC-1: every row of the table above returns its "should be" exit code. All seven, plus the
      relative/absolute correction below.
- [x] TC-2: the resolution has a stated domain, and the input classes outside it are named in the
      file header's `STATED LIMIT`. `.claude/hooks/lib/canonical-path.sh`.
- [x] TC-3: a case per row, red-proofed one at a time.
      `scripts/harness/__tests__/canonical-path.stated-domain.test.mjs`, 25 cases — including a
      GENERATED corpus of 120 paths checked against `realpath -m`, because a hand-written table of
      shapes is exactly what failed three rounds.
- [x] TC-4: the measured `PreToolUse` latency of a write is recorded, so the cost of the choice is a
      number rather than an assumption. See below — and it settled the open question in the
      unexpected direction.

## Contained by

The follow-up to pull request #1886 labels the three holes at the resolution site
(`Contained — INFRA-110.`), under [finding-depth.md](../rules/finding-depth.md). Pull request #1886
itself merged before the label was written.

## Progress

### 2026-08-21

Closed. `.claude/hooks/lib/canonical-path.sh` resolves segments left to right against an accumulator
that is canonical at every step; a symlink is expanded by pushing its own segments back onto the
pending list, so a target containing `..` or another link is resolved by the same loop. Because the
accumulator is always physically canonical, `..` can be applied lexically to IT — that invariant is
what the whole thing rests on, and it is what a purely lexical normaliser gets wrong.

**The measurement corrected one row of this item.** The `CDPATH` hole is narrower than filed: `cd`
consults `CDPATH` only for a RELATIVE operand, so an absolute ancestor was never affected. A relative
one was, and the hook receives whatever path the tool call carried — so the hole was real, just not
for the reason given. Two holes reproduced directly (the unresolved leaf, the `..` after a missing
segment) and the third only on a relative path.

**TC-4, and it decided the item.** Thirty runs each, this machine:

| case                  | old (`cd` + `pwd -P`) | new (segment walk) |
| --------------------- | --------------------- | ------------------ |
| an ordinary path      | 18.4 ms median        | 18.5 ms median     |
| a 40-segment path     | 136.4 ms              | 19.3 ms            |
| bare `bash -c exit 0` | —                     | 0.8 ms             |

So no `node` is needed and the cost question does not arise: the pure-shell walk is CHEAPER than what
it replaces on a deep path, because the old climb forked `dirname` and `basename` once per level
while this uses parameter expansion. Correctness and cost pointed the same way, which is not the
usual case and is why the numbers are here rather than the conclusion alone.

**Two defects this change's own tests found in this change.**

- **The first cut bounded total SEGMENTS and nothing else.** A two-link loop terminated — so the
  "refuses a symlink loop" case passed — after 12 SECONDS, on a hook that runs before every `Write`
  and `Edit`. A bound that only protects termination lets a loop become a stall, and the case that
  passed could never have caught it, because both versions refuse. Now bounded on SYMLINK
  EXPANSIONS, which is what the kernel bounds and what the hazard actually is, with a case asserting
  the refusal is fast.
- **The test built its expectation with `path.join`,** which normalises `..` LEXICALLY before
  `realpath` ever sees the string. The generated corpus reported eight disagreements and every one
  was the test being wrong — the exact error the item is about, committed one level up while
  measuring it. Settled against the kernel rather than by argument: `echo hello >
app/vendored/../probe.ts` creates the file under `node_modules`, not under `app`. One hand-written
  expectation in the guard table was wrong the same way and is corrected, with its counterpart
  beside it.

Red-proofed one at a time, each reverted before the next:

| mutation                                     | fails                                             |
| -------------------------------------------- | ------------------------------------------------- |
| stop resolving the LEAF                      | exactly 4, incl. the generated corpus             |
| collapse `..` lexically up front             | exactly 3, incl. the corpus and the guard verdict |
| bound total steps instead of link expansions | exactly 1 — the refusal takes 8.4s                |

`npx vitest run scripts/harness/__tests__/` — 225 files, 4274 tests, all passed.
`pnpm harness:scan` — 129 passed, 2 skipped.

Two tests failed on one intermediate run of the full suite (`scan-literal-cast-union`, and a
worktree lock-serialisation case) and both passed in isolation and on the next full run. Recorded as
observed rather than dismissed: they are load-related and neither touches this change.
