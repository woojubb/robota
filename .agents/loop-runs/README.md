# Loop runs

One append-only ledger per loop-driving skill: `<skill>.jsonl`, one JSON object per line, one line per
run of that loop. Written by `scripts/harness/loop-run.mjs`, judged by
`scripts/harness/scan-loop-run-records.mjs`.

## Why these are committed

`.agents/local-reviews/` is gitignored and per-clone, and it holds one mutable object per branch — round
N's record is destroyed by round N+1. That is right for its purpose and wrong for this one. These
ledgers are read on a fresh checkout by two consumers that need the same answer everywhere:
`scan-loop-proof` (HARNESS-113) treats a closed entry as a skill's proof-of-execution, and
`loop-economics` (HARNESS-114) aggregates across them. A per-clone corpus would make both mean
different things in different checkouts. `.agents/release-runs/` is the precedent.

## An entry

```json
{
  "runId": "r20260819T0100",
  "opened": "…",
  "closed": "…",
  "roundFindings": [3, 1, 0],
  "terminal": "converged",
  "ref": "#1880"
}
```

**There is no round count field.** `roundFindings.length` is the round count, everywhere. A stored count
would be a second source for one quantity, and two sources agree until the day they do not — which is
`.agents/rules/measurement-provenance.md` clause 1. Not storing it makes the divergence impossible
rather than merely checked.

An entry with `terminal: null` is OPEN. Not-closed is a state, not an absence — a run left open past
seven days is a finding, and the fix is to close it as `abandoned`.

## Terminal reasons

| Reason            | Meaning                                           | Reachable only when the skill declares |
| ----------------- | ------------------------------------------------- | -------------------------------------- |
| `converged`       | the finding set emptied, or the goal held         | any                                    |
| `no-progress`     | a round returned what the previous round returned | `escape=no-progress`                   |
| `bound-reached`   | the declared numeric bound was hit                | a numeric `bound=`                     |
| `halted-for-user` | escalated to a person                             | any                                    |
| `abandoned`       | stopped without reaching any of the above         | any                                    |

## What a ledger cannot tell you

A run that was never opened leaves no line, and nothing that reads this tree can see it. These ledgers
judge the records that exist.
