# Run the gate before you reach it — the third invariant axis

## STATUS: owner feedback 2026-07-27, after a session with heavy rework

In-repo mirror (memory-mirroring rule). Host mirror: `run-the-gate-before-you-reach-it`.

## The feedback

> 너무 시행착오가 많고, 많은 작업을 한 후 과했다면서 되돌리는게 너무 많아서 비효율적이다.
> 처음부터 제대로 사전에 헛수고 하지 않게 해야 한다.

and, on the shape of the fix:

> 어떤 문제를 사전에 방지하려면 보편적이고 중립적인 규칙이나 스킬이나 하네스가 필요합니다.

## The pattern, measured

One shape repeated: **act → a guard objects → undo**. Each round cost a 5–10 minute CI trip.

| Rework                                                                | Knowable in advance                                                                                  |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Two promotions failed on `release-grade verification`                 | `pnpm harness:verify:release` is what that job runs                                                  |
| A spec doc moved to `active/`, moved back, then given an exception    | `active/` is a LIVE folder; `done/` is exempt from rules it enforces                                 |
| A comment written at 17 lines, trimmed to 5, then the file refactored | the file was in `file-size-baseline.json`, which has no bump path                                    |
| An anti-rot broke 7 fixtures                                          | it fired over a subject it did not govern — **already fixed once that same session** in another scan |
| `#1503` merged before its review was read                             | the review carried a MUST; `#1507` was needed to fix it                                              |

The anti-rot row is the important one: the lesson was already written down and still not applied at
authoring time. That is why the answer has to be a mechanism, not a resolution to be careful.

## The third axis

Two invariants existed and neither covered this:

- `ci-mirror-map` (INFRA-056) — local stages vs **`protect-develop`'s** required jobs.
- `scan-main-required-checks` (INFRA-055) — a required check **can fail**.

Missing: **local reachability.** Every required status check should be runnable locally _before_ you
reach it, or declared not-runnable with a reason. `protect-main`'s `release-grade verification` runs
on no other branch, so its verdict was unknowable until a promotion PR was already open — while the
command that reproduces it sat in `package.json` and was even named in `verify-like-ci.mjs`'s own
header. **Writing it down was not enough.**

Closed for that gate: `promote.mjs` runs it and discards the branch when it fails, with
`promotion-preflight-parity` pinning the CONNECTION — whatever entry point the required job runs,
promote must run the same one. Red-proved both ways.

## How to apply

Before acting, ask what will judge this, and run that first:

- **promoting** → the branch-specific gate (now enforced).
- **editing a file** → is it under a ratchet or baseline?
- **moving a document between governed folders** → which scans key on the DESTINATION?
- **writing an allowlist or anti-rot** → scope it to the real tree; over a fixture no entry can be
  exercised, so an unscoped anti-rot reports every entry stale.
- **merging** → read the review first.

Relates to [[check-validity-two-axes]], which covers the other two axes: can it fail, and does it
check the right thing.
