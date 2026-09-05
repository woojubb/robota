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
- The latest pre-PR `g0-rN` closure is sealed before PR creation by one unedited GitHub commit comment binding its
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

## Recovery from a malformed receipt sequence

A receipt commit followed by one more commit (a fixup, a forgotten file) is not `state-lost` — raw
state is intact — but it violates three invariants at once and each failure mode reports a different
symptom depending on what was tried first:

- `exactReceiptClosure` (`work-run-git-adapter.mjs`) — HEAD must add exactly one receipt file.
- `validateCommitCorrelation` (`work-run-git-adapter.mjs`) — HEAD and the bound ready head must both
  carry the current receipt's `Work-Run`/`Work-Receipt` trailers.
- `completeReceiptCoordinates` (`work-run-repository-validation.mjs`) — every local `work.ready` event
  needs exactly one committed receipt file. `reopen` only emits `work.ready`; it never satisfies this
  on its own.

Reopening and readying again without first correcting history leaves a `work.ready` event with no
receipt (`completeReceiptCoordinates` fails), deleting the stray receipt file leaves history that
never matches a clean ready/receipt pair (`incomplete-or-foreign-receipt-history`), and committing two
receipts in one commit trips `exactReceiptClosure` the other way (`ambiguous work-run receipt closure`).
The corrected order:

1. `git reset --soft` past both the bad receipt commit and the content commit that follows it — back
   to the last commit before the receipt.
2. Recommit every receipt file uncovered by the reset, **one commit per file** — the hook derives each
   commit's trailer pair from the receipt's own filename, so a commit adding more than one receipt file
   cannot correlate.
3. `pnpm harness:work-run -- reopen --ground local-fix` once, regardless of how many commits step 2 took.
4. Make exactly one content commit with everything left to deliver. This becomes the new ready head —
   nothing may follow it before the receipt.
5. `pnpm harness:work-run -- ready --base <base-ref>`.
6. Commit the one receipt file this `ready` emits, and stop — no further commits before push.

Step 4 needs real content to commit; if nothing remains to change, closing this way has no ready head
to bind and the sequence cannot complete — resolve the outstanding change first, then start at step 1.

## Enforcement

`post-checkout` claims, `prepare-commit-msg` correlates, pre-push validates before verification-receipt
reuse, and the always-run `work-run-measurement` scan applies the same validator in CI. The versioned
`cutover-v1.json` marker and its complete open-PR registry are the only pre-cutover authority.
