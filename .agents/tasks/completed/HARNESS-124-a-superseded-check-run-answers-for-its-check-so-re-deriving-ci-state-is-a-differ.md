---
title: 'HARNESS-124: re-deriving CI state and delegating it are different prescriptions, and one shared helper would merge them'
issue: https://github.com/woojubb/robota/issues/2237
status: skipped
created: 2026-08-26
priority: medium
urgency: soon
area: scripts/harness, .claude/hooks
depends_on: []
completed: 2026-08-29
returned_to_issue: https://github.com/woojubb/robota/issues/2237#issuecomment-5461135731
---

# HARNESS-124: two questions about CI, and only one of them may be re-derived

## Problem

A commit's check-run endpoint returns **every** run for that commit, including superseded ones. Each
carries `status: completed` and a non-null `conclusion`, so a per-run "has everything finished?"
predicate answers **yes** about checks that never executed against the tree in question.

Measured at **PR #2235's superseded head**, `b43e87ae0e596df52139241f246b10f2686f82c1`. That commit
is reachable through the GitHub API and through the pull request, but **not in a default clone** — its
branch is deleted, so a reader must `git fetch origin <sha>` before `git` will resolve it. The pull
request is the followable handle; the hash alone is not.

```
REST  /commits/{sha}/check-runs        94 rows · 25 unique names · 25 cancelled
GraphQL statusCheckRollup              totalCount 94 · 25 unique names · state = FAILURE
distinct check_suite ids on that ONE commit                                   18
rows named `quality` on that one commit                                        4
```

**Neither API deduplicates**, so `gh pr checks` — built on the rollup — reads the same set, and every
waiting script in this repository reads it through one of those two.

`state = FAILURE` is the second half: the repository's standing advice is _"read each run's
`conclusion`, not the rendered bucket"_, and here **the rollup's own top-level state is the wrong
one** while the latest run per name is uniformly successful. The advice is correct and still produces
the wrong answer, because the defect is one level above the thing it warns about.

## The exposure condition is a re-trigger, not a push

Duplicates accumulate on the **superseded head**, not on a new one. Three pull requests pushed to
twice, at their final heads:

```
#2341 fd9371f2e   25 rows / 25 unique
#2357 83486d555   25 / 25
#2366 f1e1f7dac   24 / 24
```

No duplicates anywhere — a push creates a new SHA and the superseded runs stay behind on the old one.
PR #2235's superseded head differs because the workflows were re-triggered **against the same
commit** eighteen times.

**So the condition is a re-trigger on the current head — a pull-request body edit, a label change, a
manual re-run — and not a push.** That decides who is at risk: a session that pushes fixes never
meets it; a session that edits a pull-request body does. Issue #2250 records that a body edit
cancelled seven in-flight checks, which is exactly this trigger.

## Why the issue's suggested fix is the wrong shape

Issue #2237 proposes one shared helper that every gate and script uses. **That merges two questions
which take opposite prescriptions.**

```
"May this merge?"                 GitHub already computes it.   Re-deriving it IS the defect.
"Which checks are still pending?" mergeStateStatus is one enum. Re-deriving is unavoidable.
```

`merge-gate.sh` is immune, and **not because it deduplicates**:

```
:171   STATE=$(gh pr view --json mergeStateStatus)   ← the verdict
:182   FAILING=$(gh pr checks …)                     ← inside the refusal branch, naming ≤3 failures
```

It does read check-runs — **after** it has already decided to refuse, to fill in a diagnostic. The
read cannot reach the decision. **The immunity is that it never computes the answer.**

A helper offered to "every gate and script" makes re-deriving a verdict easier and more
legitimate-looking, in a codebase where the correct verdict is already available for free. **That is
this defect one level up.** The helper should exist for the enumeration question, and `merge-gate.sh`
should never call it.

`scripts/harness/github-api.mjs` is the natural home and is currently empty of this concern: it owns
**complete fetching** — pagination, backoff, `assertComplete` — and names check-runs only as an
example of an envelope endpoint. It owns how to fetch completely, not how to interpret.

## Direction

1. **Delegate the verdict.** Any gate answering "may this merge" reads `mergeStateStatus`. This is
   already true of `merge-gate.sh`; the record exists so the next change does not "improve" it into
   re-deriving.
2. **Deduplicate the enumeration**, latest run per check `name`, owned once in `github-api.mjs`, for
   the callers that genuinely need per-check granularity.
3. **The two must not share a call site.** A gate that imports the helper has re-derived something it
   could have delegated.

## Not measurable with the tool in question

Whether `gh pr checks` folds duplicates in the CLI **cannot be asked of `gh pr checks`**: it accepts a
pull-request number, URL or branch, never a SHA, so that superseded head is unreachable through it, and no
current head in this repository carries duplicates. This is not "expensive to measure" — the tool
cannot express the question. Deciding it needs a live superseded wave.

## Test Plan

- A fixture of check-run rows with a superseded duplicate: the deduplicating predicate answers on the
  latest run per name, and the naive one answers on all rows. **Both directions asserted**, so the
  fixture proves the difference rather than the presence of a function.
- **The `quality` case from PR #2235's superseded head as a literal fixture** — four rows, one name, latest
  successful — because a synthetic pair does not carry the shape that produced it.
- **A guard that `merge-gate.sh` does not import the helper**, asserted mechanically rather than by
  convention. Without it, direction 3 is a sentence in a record.
- **Positive control:** the helper still reports a genuinely failing latest run as failing, so a suite
  proving supersession is ignored cannot pass against one that ignores failures.
- `pnpm harness:scan` green.

## User Execution Test Scenarios

Not authorable, and left unwritten with the reason recorded rather than filled with a placeholder.
This item changes how developer tooling reads GitHub's check API; `robota`'s behaviour, output and
exit codes are identical before and after. The verification that matters is the fixture pair above,
which is not a product scenario a user can run.

**This reason does not expire** — it is a property of what the item delivers, not of an undecided
disposition.
