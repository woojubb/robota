# Review rounds run until a round returns zero

**Owner: [`../skills/pr-finding-resolution-loop/SKILL.md`](../skills/pr-finding-resolution-loop/SKILL.md)**,
Round B step 4 — the rule, the owner directive of 2026-08-03 behind it, and the evidence.
General form: [`../rules/enforcement-architecture.md`](../rules/enforcement-architecture.md), the
auto-re-drive bullet. Which reviewer owns a diff, and when: Rounds A and B of that same skill,
mechanically enforced by [`../../.claude/hooks/pre-push-check.sh`](../../.claude/hooks/pre-push-check.sh)
(HARNESS-074).

This file exists only so a reader arriving at `.agents/memory/` is sent there. Beyond the heading —
which has to say what it points at to be findable — it states none of the rule's operative clauses,
because two earlier versions did: the first duplicated it in full and contradicted the
skill by dropping the escalation the skill requires; the second shrank the copy and kept the operative
clauses under a sentence claiming to be a pointer. Rounds 7 and 8 caught them in turn. Recorded rather
than quietly rewritten a third time — the one-owner rule is easiest to break while writing down how
carefully you intend to work, and it took two rounds to stop breaking it here.

Related: [`comment-asserted-invariants.md`](comment-asserted-invariants.md).
