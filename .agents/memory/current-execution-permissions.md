# Current execution permissions

Owner instruction, 2026-09-12 (verbatim):

> 멀티에이전트는 허용합니다. 워크트리는 여전히 불허합니다

Multiple agents are permitted; Git worktrees remain prohibited. Use the existing checkout,
partition write ownership, and keep Git operations under one owner. Historical worktree memories
do not grant current permission. This supersedes the earlier single-agent restriction, not the
prohibition on duplicate assignments or the full acceptance criteria of the current Issue.

## Rule-repair feedback

Owner instructions, 2026-09-12 (verbatim):

> 작업을 저해하거나 잘못된 규칙이나 맞지 않는 규칙이 발견된다면 레포속 규칙을 개선하면서 이슈를 처리해 주세요.

> 너가 작업하는데 방해가 되는 하네스는 제거하는 방향으로 갈겁니다.

Prefer removing or reducing demonstrated obstructive orchestration to adding another adapter or
gate. Apply the existing authorization without repeatedly requesting the same approval. Preserve
real changed-behavior tests, required remote verification and accurate coverage reporting. This
does not authorize bypassing valid checks, changing remote protection settings or unrelated work.

Current trial: LOCAL-2655 removes automatic local CI duplication and worktree side effects. The
active policy belongs to [verification.md](../rules/verification.md) and
[git-branch.md](../rules/git-branch.md); this memory records the owner feedback, not another rule set.

## Delegated merge decisions

Owner instruction, 2026-09-13 (verbatim):

> 병합 승인해. 앞으로 병합은
> 너가 확인해서 타당할 경우 셀프승인하고 병합해

The owner approved PR #2716 and delegated future justified merges into `develop` to the owning
agent. Evaluate current CI, review findings, head/base and scope, record the decision under this
delegated authority, and merge without requesting the same owner approval again. Record the
agent's decision honestly; do not claim the owner clicked a GitHub review or reviewed future code.
This original delegation does not itself authorize a red-check bypass; the subsequent narrow
control-plane delegation below is separate. It does not waive verification, permit protection
changes, or extend authority to `main`, release promotion, publication or deployment. Existing
post-verdict push constraints and the worktree prohibition remain unchanged.

Published approval provenance: [PR #2716 decision](https://github.com/woojubb/robota/pull/2716#issuecomment-5649757760).
The general next-action policy remains owned by [git-branch.md](../rules/git-branch.md).

## Delegated control-plane exception

Owner instruction, 2026-09-13 (verbatim), directly answering the owner-only workflow-provenance
bypass request after the owner completed the merge:

> 병합완료. 다음부터는 너가 직접해. 나에게 그만시켜

The owner explicitly extended standing delegation to the same control-plane provenance exception
for future `develop` landings. This is authority to make and execute the scoped per-PR decision,
not a fresh direct owner approval of future code or a claim that the agent performed the already
completed owner merge. Do not ask the owner to repeat this approval or operate that merge when
the delegation still applies and the required evidence holds. The authoritative safeguards,
truthful agent-approver record and exclusions are owned by
[Landing a control-plane change](../rules/git-branch.md#landing-a-control-plane-change).

Provenance: the current Issue #2655 conversation following PR #2718's owner merge; no public
comment URL for this instruction has been supplied. Quote this instruction and identify that
conversation provenance in each delegated decision rather than inventing a public approval link.

## Integration-branch delegation

Owner instructions in the current AGREEMENT-014 conversation, 2026-09-23 (verbatim):

> 앞으로 너가 나에게 선택하라고 할 때 타당한 근거와 함께 추천안을 제시하면 타당할 경우 승인합니다. 모든걸 나에게 물어보려고 하지마

> #2847 승인함. 내가 이렇게 명시적으로 승인해야하는 것은 잘못된 방향이다.

> 앞으로 자동화 개발을 해야하는데 이렇게 물어보면 어떻게 자동개발이 가능한가

These instructions extend the standing justified-merge and narrow control-plane provenance
delegations to an owned `integration/**` PR. When exact-head applicable CI and independent review
are satisfactory, no conflict or unresolved thread remains, and the only exception is an intentional
guarded control-plane edit or a verified default-branch provenance dispatch gap, the owning agent
makes and records the decision and merges without another per-PR question. The agent must identify
the actual exception and its evidence, never report a missing or red provenance check as green, and
never imply the owner separately reviewed that PR. Unknown check absence, other failed checks,
`main`, release/promotion, publication, deployment and protection changes are outside this
delegation. The authoritative conditions live in [git-branch.md](../rules/git-branch.md#landing-a-control-plane-change).
