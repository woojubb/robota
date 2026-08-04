---
id: INFRA-064
title: 'INFRA-064: the windows-shell job pays for the most expensive runner to re-run a pure function'
status: done
completed: 2026-08-05
priority: low
urgency: later
type: INFRA
area: .github/workflows
created: 2026-07-27
depends_on: [INFRA-060]
---

## Problem

INFRA-060's audit recorded this as **D2** and marked it FILED. Nothing was filed — this item is that
filing, written when the audit's follow-ups were reconciled and D2 turned out to have no target.

`windows-shell` step 1 runs `packages/agent-core/src/utils/platform-shell.test.ts` on
`windows-latest`. That test is a pure function test: `resolvePlatformShell(env, platform)` takes the
platform as an ARGUMENT. It never reads `process.platform` and spawns nothing, so its verdict on
Windows is identical to its verdict on Linux — proven by running it on Linux (8 passed).

The job's stated reason — "these tests exercise the win32 path that the macOS/Linux jobs cannot" —
is false for this half. It buys the matrix's most expensive runner to re-run something `quality`
already covers.

Step 2 (`agent-tools`) **does** spawn a real shell and is genuinely win32-only. It stays.

## Why it was not changed in the audit

`windows-shell` is a required check. Removing a step from it changes what gates a merge, which is
the owner's call rather than an auditor's — the same reason the audit filed rather than executed
several of its findings.

## Proposed direction

Drop step 1 and keep step 2, so the Windows runner is paid for only where the platform is actually
the variable under test. State in the job that step 2 is the win32-specific half, so the next reader
does not re-add a platform-independent test on the assumption that everything here needs Windows.

Worth checking while there: whether any OTHER matrix step is platform-independent in the same way.
One instance found by reading is unlikely to be the only one, and the cheap check is the same —
does the test take the platform as an argument, or read it from the process?

## Done when

- The Windows job runs only tests whose behaviour actually depends on running on Windows, with each
  remaining step's platform-dependence stated.
- The saved runner time is measured and recorded, so the change is justified by a number rather than
  by the argument above.
- No coverage is lost: the removed test still runs somewhere on every PR, proven by pointing at the
  job that runs it.

## Resolution — and the item's own cost argument does not survive its measurement

The `platform-shell` step is gone from `windows-shell`. `resolvePlatformShell(env, platform)` takes
the platform as an ARGUMENT, reads no `process.platform` and spawns nothing, so its verdict on
`windows-latest` is identical to its verdict anywhere else.

**The number the done-gate demanded refutes the reason the item gave.** Measured on a real run of the
job:

| Step                                  | Time       |
| ------------------------------------- | ---------- |
| Set up job, checkout                  | 9 s        |
| Install pnpm, Node                    | 9 s        |
| `pnpm install --frozen-lockfile`      | **42 s**   |
| Build agent-core + agent-process      | 7 s        |
| **`platform-shell` (removed)**        | **2 s**    |
| `shell-tool` (kept — genuinely win32) | 3 s        |
| Teardown                              | 20 s       |
| **Total**                             | **~103 s** |

The item said it "buys the matrix's most expensive runner to re-run something `quality` already
covers". The runner is bought by the step that stays; this one was **2 % of one job**, about two
seconds, on a public repository where standard runners are not billed by the minute. As a cost
argument it is worth nothing, and the done-gate asking for the number is what surfaced that.

**Removed for what it CLAIMED, not for what it cost.** A step on a Windows runner asserts, by being
there, that something about it needs Windows — and the job's own stated reason said so in those
words. It did not. A job whose stated coverage is wider than its real coverage is the defect,
independent of runtime; the same comment-asserted-invariant class this session kept finding
elsewhere.

**No coverage lost, and the argument is stronger than "it runs somewhere else too."** A pure
function's verdict cannot change unless its subject or its test changes; both live in `agent-core`,
and a change to `agent-core` is exactly what puts it in scope. Measured, not assumed: a content
change to `platform-shell.ts` makes `plan-change` select
`packages/agent-core: build, test, lint, typecheck`, which the REQUIRED `quality` job runs. When
`agent-core` is untouched, the test could not have changed its answer — so running it bought nothing
on those PRs either.

Both remaining halves of the job now state their platform-dependence in the workflow, which is the
first done-gate criterion: the `shell-tool` step spawns a real shell and asserts PowerShell answers,
which no Linux or macOS runner can execute.
