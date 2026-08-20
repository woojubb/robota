---
title: 'INFRA-110: the bulk-edit guard hand-rolls path canonicalization, and it fails open'
status: todo
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

## Direction (not yet decided)

Replace the climb with a canonicalizer that has a stated domain and handles a non-existent tail. The
open question is cost: this hook runs `PreToolUse` on every `Write`/`Edit`, and a node invocation per
write is a latency the hook currently does not pay. Whether that is acceptable, or whether the
resolution should be reached another way, is what this item decides.

## Completion criteria

- [ ] TC-1: every row of the table above returns its "should be" exit code.
- [ ] TC-2: the resolution has a stated domain, and the input classes outside it are named in the
      file header's `STATED LIMIT`.
- [ ] TC-3: a case per row, red-proofed one at a time.
- [ ] TC-4: the measured `PreToolUse` latency of a write is recorded, so the cost of the choice is a
      number rather than an assumption.

## Contained by

The follow-up to pull request #1886 labels the three holes at the resolution site
(`Contained — INFRA-110.`), under [finding-depth.md](../rules/finding-depth.md). Pull request #1886
itself merged before the label was written.
