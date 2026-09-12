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
