# The author does not write the findings count

## STATUS: measured 2026-08-23; the hook refused the next push twice

In-repo mirror (memory-mirroring rule). Host mirror: `author-must-not-write-the-findings-count`.

## The shape

In a reply to review findings, do not write the `ACTIONABLE FINDINGS: <n>` line. That string is the
**reviewer's verdict format**, and `.claude/hooks/pre-push-check.sh` reads the latest review-shaped
comment to decide whether a push is resolving a finding. An author comment carrying the count makes
the hook conclude the pull request is already merge-ready, so the NEXT push — including one fixing a
red CI gate — is refused as unreviewed new work.

The hook's rule (an open pull request's diff is frozen except to resolve a finding) is right. The
input it was reading was the author's.

## How to apply

State that each finding is addressed and what changed. Leave the count to the reviewer.

If a red CI gate must be fixed while the last review says zero findings, verify by hand with
`gh pr checks <n>` that a check is actually failing on the pushed head, then push with
`PRE_PUSH_ALLOW_UNREVIEWED=1` inline and say so on the pull request.

Related: [[gate-block-notice-is-not-the-review]]
