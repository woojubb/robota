---
name: pr-body-background-first-no-session-link
description: The owner rejected a PR body that opened with gate vocabulary and carried the agent's session link (2026-08-28); the PR body's contract is backlog-execution.md § PR Unit Rule, and this record only points at it
metadata:
  type: feedback
---

On 2026-08-28 the owner rejected PR #2402's body — it opened with "Accepted recommendation: A2 …"
and `REVIEW VERDICT`, and ended with the agent's `claude.ai/code/session_…` link — in these words:
"왜 pr올리는데 내 클로드 세션 링크까지 같이 올리는거야? 그리고 pr에는 왜 배경이나 목적이 제대로
설명이 안되어 있는거야?" The session link and the commit trailer came from the agent harness's default
instructions, not from anyone here, and the owner asked that the rule live in the repository
(issue #2403, RULE-016).

**Where the rule lives:** [backlog-execution.md](../rules/backlog-execution.md) § PR Unit Rule owns
the PR body (seven ordered sections, Background first; no agent-session link or "Generated with"
footer). [git-branch.md](../rules/git-branch.md) § Git Operations owns the commit half (no session
trailer; `Co-Authored-By` stays). `.github/PULL_REQUEST_TEMPLATE.md` is the human author's copy.
Enforced by the `review-gate` required check (`scripts/harness/check-pr-body.mjs`) and commitlint's
`no-session-link`.

**Why this record exists:** memory-mirroring.md — the owner's guidance was first written to session
memory; the fact is owned by the rules above, so this record points at them rather than restating
them, and keeps the owner's words and the date.
