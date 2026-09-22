---
name: pr-finding-resolution-loop
description: Prepare a PR, obtain one independent final review, and resolve only actionable findings or meaningful repair deltas before merge.
loop: over=actionable-repair-delta; escape=no-progress
invocable: true
---

# PR Finding Resolution

Use this route after the implementation and affected local verification are complete. It preserves one
independent final review without recreating a reviewer/triager/writer/fixer assembly line.

### Round A — final local review before first push

Before the pull request exists, read the finished diff and verification evidence and obtain one independent
review bound to the actual base and head. Resolve local findings directly. A FOUNDATIONAL finding is recorded
on the authoritative issue rather than patched as a symptom; when the local review record names it, pass
`--foundational <ID>`. Record the clean head with `pnpm harness:review:record -- --findings 0`.

This local round stops the moment one is open for the branch. Open the PR only when the requested unit is
complete.

The verdict records:

```text
REVIEWED BASE: <40-hex>
REVIEWED HEAD: <40-hex>
ACTIONABLE FINDINGS: <n>
```

### Round B — published findings and merge decision

1. After opening the PR, publish the already-completed Round A verdict once as a COMMENTED GitHub
   review. This is a remote projection of the same review, not a second clean review. Use the exact
   current head and the reviewer identity that produced Round A:

   ```bash
   gh pr review "$PR_NUMBER" --comment --body "$(printf 'INDEPENDENT_REVIEW\nREVIEWER: agent:%s\nREVIEWED HEAD: %s\nACTIONABLE FINDINGS: %s\n' "$REVIEWER_NAME" "$(git rev-parse HEAD)" "$FINDINGS")"
   ```

   `REVIEWER_NAME` is the canonical agent path without the `agent:` prefix and `FINDINGS` is the
   Round A count. Do not change the body after a new push: GitHub binds the review to its submitted
   commit, and `review-policy` requires both that immutable binding and the body SHA to equal the
   current PR head. If the count is zero, do not dispatch another reviewer. Observe required CI and
   enter the merge decision once the current head is green.

2. If actionable findings exist, the responsible author fixes the smallest coherent batch and replies to
   each published finding. Classification or specialist review is optional when a finding is ambiguous,
   foundational, security-sensitive, or outside the author's scope; it is not a mandatory handoff.
3. Review the meaningful repair delta. Do not re-review untouched work or repeat a clean review merely
   because the target branch advanced. Stop on no progress and ask for a decision instead of cycling.
4. Red checks are repaired from their diagnostics. A changed head reruns only the affected checks selected
   for that head. A conflict-free target advance causes no rebase, push, retest, or replacement review.
5. Resolve every published thread, verify the required contexts on the current head, publish the single
   merge decision required by [git-branch.md](../../rules/git-branch.md), then merge.

## Evidence ownership

The PR owns the published Round A projection, review comments, replies, CI results, and the merge
decision. Do not create a committed loop ledger, receipt-only commit, second review, or second
zero-finding comment. Runtime failure must be reported where it occurs.

The responsible author may review diagnostics, apply fixes, and reply directly. Dispatch a specialist only
when that specialist contributes a distinct decision, not to restate N/A or relay the same finding.
