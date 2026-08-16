# The Recommendation Gate is bounded at 2 revisions — I ran 11 and never invoked the bound

## STATUS: observed 2026-08-16 on RULE-013 WU-B; no rule change needed — the rule already said this

In-repo mirror (memory-mirroring rule). The rule is not new; the failure was not reading it.

## The bound

[`backlog-execution-orchestrator/SKILL.md`](../../.claude/skills/backlog-execution-orchestrator/SKILL.md)
states it twice — once in frontmatter, once in the phase-1 routing table:

> `loop: over=finding-set; escape=no-progress; bound=2 rounds`

> `REVIEW VERDICT: REVISE` → Revise the recommendation against the reviewer's findings and **repeat
> phase 1**. Stop when the same findings recur unchanged and escalate (no-progress escape); **bounded
> additionally at 2 revisions; on the third, terminate and hand the reviewer's findings to the user.**

## What happened

RULE-013 WU-B ran the gate **eleven times** before ENDORSE. Rounds 1–3 were design and execution
defects; rounds 4–11 were record-integrity defects, each genuinely new. Because every round produced
new findings, the `no-progress` escape correctly never fired — and that is exactly why the **separate,
unconditional** `bound=2` exists. It was passed at round 3 and never applied.

The reviewer, not the orchestrator, is what surfaced it, at round 11.

## Why the bound exists, read from what the eight extra rounds actually cost

The findings after round 3 were real and worth fixing — stale counts, a criterion whose command exited
1, a frozen section edited while the record said otherwise. But **every one of them was a record
correction the owner could have accepted or deferred.** The bound's intent is that at that point the
decision belongs to the owner: is this record good enough to land, or is the residual worth more
rounds? Continuing to iterate silently answered a question that was not the agent's to answer, and
spent the owner's budget doing it.

Note the asymmetry the bound encodes: `no-progress` protects against a loop that is stuck; `bound=2`
protects against a loop that is _productive but unbounded_. The second is harder to notice from inside,
because each round feels justified.

## What to do instead

1. **Count the rounds.** On the third REVISE, stop. Do not evaluate whether the findings are worth one
   more pass — that evaluation is the thing the bound removes from the agent.
2. **Hand over what the reviewer said**, not a summary of how close it is: the verdict, the specific
   findings, what is already folded, and what would remain if it landed as-is.
3. **A `loop:` declaration in a skill's frontmatter is a hard limit, not documentation.** Read it before
   entering the loop and track the counter explicitly; eleven rounds happened partly because nothing was
   counting.

Related: [[bound-every-wait-and-solve-it-yourself]] — same family. A wait with no stated end and a loop
with no counted bound are the same failure, one in time and one in iterations.
