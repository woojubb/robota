# A gate's block notice is not the review

## STATUS: measured 2026-08-23 on PR #2212 round 4; cost one round

In-repo mirror (memory-mirroring rule). Host mirror: `gate-block-notice-is-not-the-review`.

## The shape

Two bot comments landed **two seconds apart**: `review-gate: BLOCKED`, and the reviewer's own comment
carrying a SHOULD finding. Reading the block notice, fixing the CodeQL finding it named, and replying
looked like a complete round. The review was never opened, and its finding had to be restated a round
later.

A gate's block notice and a code review are different artifacts from different producers. Treating
one as the round's output leaves **no signal that the other exists**, because the round still ends in
a push and a reply that look finished.

## How to apply

After a review round, enumerate every comment added since the previous round — `gh pr view <n> --json
comments`, compared by timestamp — rather than reading the last one. Answer each separately.

The two are mechanically distinguishable: **a comment whose body has no `ACTIONABLE FINDINGS:` line
is not a review, and a comment that has one is not a gate notice.** Both can appear in one round.

Related: [[author-must-not-write-the-findings-count]]
