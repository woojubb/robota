# Work-run measurement

Every non-protected topic branch MUST be represented by exactly one validated work-run receipt,
an explicit exclusion receipt, or an exact identity-bound `state-lost` invalid receipt before push.
This rule owns the lifecycle and denominator vocabulary; skills only route commands to it.

## Lifecycle

- Claim at the earliest repository-observable boundary. `user-request-gate` claims before its first
  recommendation; `post-checkout` covers all other topic work. Claim must not postdate the first topic commit.
- Bind the run to work ID, lane, and work kind before `work.started`. Keep at most one active phase and
  one open pause. Close both before `work.ready`.
- Events use the v1 closed union and a contiguous sequence/previous-hash chain. Unknown versions, event
  types, broken chains, oversize state, or invalid transitions fail closed.
- Raw nonterminal state is local and retained. Durable receipts are immutable by generation/revision.

## Git and pull-request identity

- Commits carry one exact `Work-Run` plus `Work-Receipt` trailer pair. Partial, duplicate, or conflicting
  pairs are refused. Amend, merge, and squash sources preserve an exact pair and never invent one.
- Ready binds repository, branch, base/head commit, head tree, correlated commits/trailer digest, schema,
  and owner fingerprint. Only one receipt-only closure commit may follow the bound ready head.
- The pushed g0 closure is sealed before PR creation by one unedited GitHub commit comment binding its
  run ID and head OID to a server timestamp. Attestation refuses any prior open, closed, or merged PR
  for the branch and returns only after confirming a later GitHub server timestamp tick. The PR body
  carries `Work-Run: <id>`. First-PR time comes only from GitHub `createdAt` after that pre-PR seal and
  a unique repository + marker + trailer join.
- Before first PR, retries advance receipt revision over the same root interval. After first PR,
  maintainer-approved finding/red-check/rebase work advances generation and consumes the shared
  `POST_FINDINGS_ACTION_REQUEST` projection. Rebase generations preserve the proven topic tree: only
  one tree-identical correlated bind commit and its exact receipt-only closure may follow the proven
  rebased head before the force push.

## Population and reporting

Reports always state `included`, `superseded`, `excluded`, `invalid`, and `unavailable`. They report
wall, active, paused, and phase p50/p90 by lane/work-kind cohort; they do not average percentiles or rank
individuals. `state-lost` is invalid, never excluded, and permits push only when bound to exact surviving
Git identity with timestamps unavailable. Never-pushed/deleted local branches are outside the server
denominator and remain visible only to local reporting.

## Enforcement

`post-checkout` claims, `prepare-commit-msg` correlates, pre-push validates before verification-receipt
reuse, and the always-run `work-run-measurement` scan applies the same validator in CI. The versioned
`cutover-v1.json` marker and its complete open-PR registry are the only pre-cutover authority.
