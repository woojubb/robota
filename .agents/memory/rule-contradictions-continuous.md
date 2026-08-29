# Rule contradictions are improved continuously

**Owner: [`../rules/learning-loop.md`](../rules/learning-loop.md)**, "Contradiction Between Rules".
The standing mechanism gap is
[HARNESS-072](../tasks/completed/HARNESS-072-nothing-detects-a-contradiction-between-two-rules.md) (issue
#1617). This file is a pointer.

Owner directive, 2026-08-03: **"규칙의 모순은 지속적으로 개선해 나가야 합니다"** — given after PR #1615
round 13 found a MANDATORY rule contradicting the MANDATORY rule the same PR had just landed.

Why it was needed: that PR produced FIVE contradictions in one change — memory vs skill, the
orchestration map vs skill, a draft spec vs skill in three separate places, and rule vs rule — every
one found by a review round and none by a machine. All five existed because a fact was written twice.
