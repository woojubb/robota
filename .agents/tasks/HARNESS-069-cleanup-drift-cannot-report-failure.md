---
title: 'HARNESS-069: `cleanup-drift` has no non-zero exit path at all — it cannot report a failure to anything that runs it'
status: todo
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
