---
name: track-work-run
description: Record repository work from claim through first PR and authorized rework. Use for every non-protected topic branch, including docs/settings/Git-only work, and whenever work pauses, resumes, becomes PR-ready, or reopens after PR findings, a red check, or rebase.
---

# Track a work run

Follow [work-run-measurement.md](../../rules/work-run-measurement.md). This skill routes the lifecycle;
the rule and `work-run-contract.mjs` own its vocabulary.

Use the work-unit boundaries in [execution-cadence.md](../../rules/execution-cadence.md).
Do not create a new claim, phase, ready receipt, or reopen event for each small correction while
implementation is still active. Preserve required events when a real lifecycle transition occurs.

1. Claim immediately: `pnpm harness:work-run -- claim`. The post-checkout hook is the fallback, not a
   reason to delay an explicit request-gate claim.
2. Bind before implementation:
   `pnpm harness:work-run -- bind --work-id <ID> --lane <L0|L1|L2> --kind <kind>`.
3. Start and bracket named phases with `start`, `phase-start --phase <name>`, and
   `phase-complete --phase <name>`. Use `pause --reason <reason>` and `resume`; do not erase wait time.
4. After final local verification and a clean tree, run
   `pnpm harness:work-run -- ready --base <base-ref>`. Commit only the emitted receipt next; the
   prepare-commit-msg hook adds the exact correlation pair.
5. Push the latest pre-PR `g0-rN` receipt closure, then before creating the PR run
   `pnpm harness:work-run:attest`. This creates an idempotent GitHub commit comment whose server
   timestamp seals the opening head and returns only after GitHub's server timestamp has advanced to
   a later tick. Put `Work-Run: <run-id>` in the PR body. Do not use local `readyAt` as first-PR time,
   and never attest after any open, closed, or merged PR has existed for the branch.
6. Before the first PR, use `reopen --ground local-fix` and ready again; this advances revision only.
   After a PR exists, pass `--generation <n> --ground <finding|red-check|rebase>` and a matching
   `--authorization-file <path>` containing the approved shared action projection. For `rebase`, the
   order is mandatory: obtain approval and retain the pre-rebase head; perform the actual rebase; run
   `reopen --ground rebase --head <pre-rebase-head>` so it records the proof; create one tree-identical
   correlated commit with `git commit --allow-empty -m "chore: bind rebased generation"`; run `ready`
   and commit its receipt-only closure; then force-push. A rebase generation may not add file changes,
   and the server edge must land on the proven rebased head or that exact empty-bind + closure suffix.
7. If raw state is truly lost, use `recover --state-lost --run-id <id> --base <base-ref>`. Never create
   a late synthetic claim. The resulting receipt remains in the invalid denominator.

Before push, run `pnpm harness:scan:work-run -- --base <base-ref>`. Missing, mixed, stale, malformed,
or identity-mismatched measurement is a defect to fix, not a bypass condition.
