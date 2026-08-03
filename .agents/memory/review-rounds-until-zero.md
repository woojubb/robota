# Review rounds run until a round returns zero

**Owner: [`../skills/pr-review-orchestration/SKILL.md`](../skills/pr-review-orchestration/SKILL.md)**,
Round B step 4. The rule, the owner directive behind it and the evidence live there. This file is a
pointer, not a second copy.

Owner directive, 2026-08-03: **"라운드는 계속 돌려. 앞으로도"** — keep running the rounds, from now on
too. It removed the `iteration >= 3` cap; no-progress detection (the same finding set recurring
unchanged) is now the only escape, and "another round or merge?" is not a step of the loop.

The first version of this file stated that rule _here_, in full, and in a form that contradicted the
skill by deleting the escalation the skill requires — a second copy of a fact with an owner, in a file
no mechanism reads, in the same PR whose HARNESS-068 is about exactly that. Review round 7 caught it.
Recorded rather than quietly rewritten: the one-owner rule is easiest to break while writing down how
carefully you intend to work.

Related: [`comment-asserted-invariants.md`](comment-asserted-invariants.md) — on the PR that produced
this directive, nearly every round's heaviest finding was a comment, docstring or record asserting a
property the code did not have, and each was introduced by the round that fixed the previous one.
