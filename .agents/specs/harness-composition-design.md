# Harness composition design — rules, skills, agents

> **Living document.** This is the current snapshot of how the harness is meant to be composed, not a
> record of one decision. Update it whenever the shape changes; date each revision in the log at the
> bottom so the reasoning stays traceable. Work items that apply it (e.g. `HARNESS-049`) come and go —
> this document stays.

## The three artifact kinds

| Artifact                                              | Owns                                                                         | Must NOT contain                                       |
| ----------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------ |
| **Rule** (`.agents/rules/*.md`)                       | Invariants — "X must hold", "never Y" — and **who owns each fact**           | Step-by-step procedure; role definitions               |
| **Orchestration skill** (`.agents/skills/*/SKILL.md`) | A pipeline: phases, gates, what to dispatch, and **how each outcome routes** | A role's judgement criteria; restated rule text        |
| **Agent definition** (`.claude/agents/*.md`)          | One role: charter, judgement criteria, tool scope, terminal signal           | Pipeline control flow; knowledge of what runs after it |

**The boundary test.** If a skill explains _how to judge_, that content belongs in an agent file. If an
agent file explains _what runs next_, that belongs in the skill above it. If a rule explains _how_
rather than _what must hold_, it belongs in a skill.

## Orchestration nests

A phase of a high-level pipeline is frequently a pipeline in its own right. So an orchestration skill
may dispatch **other orchestration skills** as well as agents:

```
router skill            → routes to the right pipeline for the request
  └─ orchestration      → sequences phases; a phase may be another orchestration skill
       └─ orchestration → sequences that phase's own steps
            └─ agent    → does the actual role work (the leaf)
```

Nesting is **expected, not an exception**. Depth is whatever the work actually has. The invariant holds
at every level: each level carries **only its own control flow** — a parent never restates a child's steps,
and a child never knows what follows its parent's phase. Only leaves are agents.

## Why this shape

- **A rule that reads like a runbook cannot be enforced.** It can only be followed by whoever happens to
  read it — the "prose without a mechanism" failure this harness has hit repeatedly.
- **A role inlined in a skill cannot be reused.** Extracted into its own file, the same reviewer or
  auditor serves every pipeline that needs it. This is already proven here: every agent definition in
  `.claude/agents/` is dispatched by at least two skills, and the judge roles are the most reused.
- **A skill that carries judgement criteria drifts from the skills that copy it.** One role, one file,
  one owner — the same single-source discipline `AGENTS.md` applies to facts.

## Neutrality

A skill is **universal procedure**. Repo-specific facts — script names, branch names, item IDs,
baseline names, tool names — belong to the rule (or doc) that owns them and are **pointed at**, never
restated. `worktree-parallel-orchestration/SKILL.md` is the reference implementation of this after its
neutrality pass: it says "the project's CI-equivalent verification entry point", not a command name.

The line to hold: abstract enough to port, concrete enough to execute. Naming the _mechanism of the
procedure itself_ (the isolation primitive, the agent-dispatch call) is fine; naming _this repo's
plumbing_ is not. When a fact must stay concrete for the procedure to be runnable, say so explicitly
rather than leaving it implicit.

## Working agreements

- **Move, never duplicate.** When content relocates, the source loses it. Each fact keeps exactly one
  owner document.
- **No behavioral loss.** A mandatory constraint that becomes procedure must not lose force. Diff the
  invariants before/after and show each one's new home. Then **re-check the ledger against the diff**: the
  statement a ledger is most likely to omit is the one the change is about to move, because attention goes
  to the destination rather than the source. Measured three times now, a deliberate self-re-derivation
  still misses statements an independent reviewer finds — so the review round is part of the method, not a
  formality.
- **A precondition of a gate is an invariant, not a step.** Relocating one into a skill weakens it: a rule
  binds every actor, a skill binds only whoever invokes it. If a sentence states what must be true before a
  gate may run, it stays in the rule even when the waiting or looping around it becomes procedure.
- **Incremental.** One rule, one skill, or one role at a time — each merged and verified.
- **Mechanically checked.** Anything a harness scan references must keep resolving: registered skills,
  agent-definition conventions, anchors. The scans are the floor, not the review.

## A pipeline is a state machine, not a queue

"Driving the pipeline" is **not** walking a list front to back. Managing it means **reacting to each
step's result**: on a step's outcome an orchestrator may advance, **re-run a step**, **go back to an
earlier step**, jump to a different step, or stop. Loops and backward edges are normal control flow,
not error handling bolted on.

That is why an orchestrator legitimately reads results — and why doing so is **not** the judgement that
belongs to agents. The split:

| Orchestrator decides                                | Agent decides                                      |
| --------------------------------------------------- | -------------------------------------------------- |
| **Which step runs next**, given a step's outcome    | **What the outcome is**                            |
| Whether to retry, go back, skip ahead, or terminate | Whether the thing under review is correct/complete |
| When the pipeline has converged                     | The verdict a step reports                         |

An orchestrator consuming a verdict to route on it is control flow. An orchestrator _forming_ that
verdict itself is the violation — that work belongs in an agent file.

Concretely, an orchestration skill should state, per step: what it dispatches, and **what each outcome
routes to** (advance / repeat / return to step N / terminate). A step whose failure has no defined
routing is an incomplete pipeline. The loop-until-convergence shape — dispatch, read the result, go
back if it is not clean, terminate only when a fresh pass is clean — is the common case, not a special
one; see `automated-review-convergence` for a worked instance.

**Every level obeys the same rules.** An intermediate orchestration skill is an orchestrator in full: it
owns its own ordering _and_ its own routing decisions, dispatches skills or agents, and never forms
verdicts. It differs from the top level only in scope, never in kind.

## How to find a skill that should exist

Two signals have now each produced a real extraction, and both are cheaper to check than re-reading a rule
looking for numbered lists:

- **Two callers with divergent partial copies.** When two pipelines each carry their own paraphrase of the
  same sequence, that sequence is a skill neither of them owns. Leaving it in either one duplicates it into
  the other. (`ci-gate-watch`: two release phases waiting on a gate. `post-merge-cycle`: the PR-review merge
  path and the parallel-orchestration merge step, which had drifted to different levels of detail — one of
  them restating a rule's checklist in the same paragraph that said "do not restate it".)
- **Prose adjacency encoding the wrong order.** Sections written next to each other imply a sequence, and
  the implied one can contradict the mandated one. A pipeline makes the order explicit and checkable; prose
  cannot.

## Not every predicted extraction should happen

An inventory that predicts a skill is a hypothesis, not a commitment. **Refuting a predicted extraction is a
valid, reportable outcome** — and it has happened twice now (`spec-workflow.md` yielded no new pipeline;
`git-branch.md`'s predicted `branch-creation` skill and `branch-guard` promotion were refuted because
branch creation is invariants plus a mechanical hook, and its only ordered part already belonged to another
skill). Manufacturing a skill to match a prediction, or to hit a line-reduction ratio, is the failure mode.
**A modest reduction on an invariant-dense rule is the correct result**, not a shortfall.

## Settled

- **The router is a skill.** Routing is procedure — deciding which pipeline a request enters is the same
  kind of work as deciding which step runs next, just at the top. It is not an invariant, so it is not a
  rule.
- **Intermediate orchestrators follow the orchestrator rules unchanged** (see above).
- **Orchestrators route on results.** Reading a step's outcome to decide the next step is orchestration;
  producing that outcome is not.
- **Mechanically decidable preconditions are gate conditions, not verdicts.** A checklist an orchestrator
  can settle from observable state ("does this branch carry commits the merge did not take?") is control
  flow it evaluates itself. Only a question that requires forming a judgement from evidence needs a role.
  This is the corollary that keeps the boundary test from spawning an agent per checklist.

## Open questions

- Is there a natural depth limit for nesting, or does it stay work-shaped? (No evidence yet either way —
  revisit once several nested pipelines exist.)
- When a pipeline can loop, what bounds it? A max-iteration count, a convergence predicate, or per-step
  discretion? Unresolved — but a loop with no stated termination condition is a defect either way.

## Revision log

| Date       | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2026-07-26 | Created. Three-artifact split, boundary test, nesting, neutrality, working agreements — captured from the `HARNESS-049` framing and the `worktree-parallel-orchestration` neutrality pass.                                                                                                                                                                                                                                                                   |
| 2026-07-26 | Owner clarifications: the router IS a skill; intermediate orchestrators follow the orchestrator rules unchanged; and a pipeline is a **state machine** — an orchestrator routes on each step's outcome (advance / repeat / go back / terminate), which is control flow, not the judgement that belongs to agents. Two open questions closed, one added (what bounds a loop).                                                                                 |
| 2026-07-26 | Learned from `HARNESS-049` increments 1–3. Added two discovery signals for a missing skill (two callers with divergent partial copies; prose adjacency encoding the wrong order), the "not every predicted extraction should happen" agreement, and one settled corollary: **mechanically decidable preconditions are gate conditions an orchestrator evaluates, not verdicts needing a role** — without it the boundary test spawns an agent per checklist. |
