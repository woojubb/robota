---
name: backlog-execution-orchestrator
description: The state machine for executing ONE backlog item or named work unit end to end. Sequences five phases — recommendation gate, scenario planning, implementation, done gate, completion — dispatching proposal-reviewer and the user-execution-scenario sub-pipeline, and routing on each outcome (advance / repeat / return to an earlier phase / terminate). It holds NO backlog policy: every gate definition, PR contract, status invariant, and stop condition is owned by the project's backlog-execution rule and is pointed at, never restated. Use when working a backlog item; for an initiative spanning several items, multi-backlog-initiative is the entry point and dispatches this once per item.
loop: over=finding-set; escape=no-progress; bound=2 rounds
invocable: true
---

# Backlog Execution Orchestrator — pipeline only

The state machine for one backlog item or one explicitly named work unit. This skill owns **ordering and
routing between phases** and nothing else. It does not define what a recommendation must contain, what a
valid scenario is, when status may be set, or when to stop — those are invariants owned by the rule below,
and restating them here would create a second copy that drifts.

**Entry.** One item enters here. An initiative spanning several items enters
[multi-backlog-initiative](../multi-backlog-initiative/SKILL.md), which dispatches this pipeline once per
item against the initiative's base branch. Do not run several items through this pipeline concurrently —
the rule's one-item-at-a-time constraint is not a preference.

## Rule Anchor

- [backlog-execution.md](../../rules/backlog-execution.md) — the policy SSOT for everything this skill
  sequences: "Agent Decision Authority", "Recommendation Gate" (required contents), "One-Backlog-At-A-Time
  Rule", "PR Unit Rule" (including the PR-description contract), "User Execution Test Scenario Rule",
  "Done Gate" (the mandate), "Completion Steps", "Status Invariants", "Stop Conditions".
- [git-branch.md](../../rules/git-branch.md) — branch safety, clean-tree requirement, commit cadence,
  merge approval.
- [enforcement-architecture.md](../../rules/enforcement-architecture.md) — worker / guardian / orchestrator.

## Preconditions (refuse to start otherwise)

1. Exactly one target item or named work unit is identified.
2. No previous item from this session is unmerged (a Stop Condition in the rule).
3. The working tree is clean of anything unrelated to this item.

If any precondition fails → **terminate** and report which one.

## Phases and routing

### Phase 1 — Recommendation gate

Form the recommendation the rule requires, then **hand it to `proposal-reviewer`** rather than judging it
here. See "The recommendation is not self-judged" below — this is a deliberate behavioural change from the
rule's previous self-assessment wording, made because an orchestrator forming a verdict on its own output
is exactly what [enforcement-architecture.md](../../rules/enforcement-architecture.md) forbids.

The rule owns what is attested; this skill owns the sequence that makes it causal:

1. Commit the planning-only Task/spec revision to be reviewed. Compute its canonical projection digest with
   `recommendation-review-record.mjs`.
2. Before dispatch, write `recommendation-expect` to the open `backlog-execution-orchestrator` run with the
   exact basename, full commit, and digest.
3. Dispatch `proposal-reviewer` with those exact three values. After return, write
   `recommendation-observe` with its verdict and unresolved-finding count, then record the round finding count.
4. On `ENDORSE | 0`, make one planning-only endorsement checkpoint containing the exact Task/spec pair (the
   Task references this run ID) and canonical loop ledger. Run `scan-recommendation-endorsement.mjs --staged`
   before committing and topic mode afterwards. No implementation path belongs in this checkpoint.
5. A revised projection starts a new expectation/observation round and checkpoint. Never amend an earlier
   observation or let a stale digest authorize the revision.

**Also dispatch `finding-depth-triager` on the item's problem statement, before the recommendation is
formed.** Two different questions, and both have to hold: `proposal-reviewer` asks whether the chosen
decision is right AMONG THE ALTERNATIVES; the depth verdict asks whether the problem being solved is the
real one ([finding-depth.md](../../rules/finding-depth.md)). An item scoped to a SYMPTOM produces a plan
that cannot be right, and every gate after this one will pass it — because each of them judges the plan
against the item rather than the item against reality.

A `FOUNDATIONAL` verdict here routes to the last row of the table below: re-scoping an item is a decision
above this pipeline. Asking at this moment is what makes that a cheap answer instead of an expensive one.

| Outcome                                                        | Route                                                                                                                                                                                                                                                                                                                      |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The decision is one the rule reserves for the user             | **Terminate — halt for the user** before dispatching anyone. An independent review is not a substitute for approval the rule says only the user can give.                                                                                                                                                                  |
| `REVIEW VERDICT: ENDORSE` with `UNRESOLVED FINDINGS: 0`        | Commit and verify the exact recommendation-endorsement checkpoint, then advance to phase 2 (running GATE-APPROVAL first when the spec has not passed it). The accepted recommendation is what the PR description later reflects.                                                                                           |
| `REVIEW VERDICT: REVISE`                                       | Revise the recommendation against the reviewer's findings and **repeat phase 1**. Stop when the same findings recur unchanged and escalate ([no-progress escape](../../rules/enforcement-architecture.md)); bounded additionally at **2 revisions**; on the third, terminate and hand the reviewer's findings to the user. |
| `REVIEW VERDICT: REJECT`                                       | **Terminate — halt for the user** with the reviewer's reasoning. Never proceed by overriding a REJECT; the reviewer exists precisely to be able to say no.                                                                                                                                                                 |
| The reviewer's finding is that the item's own premise is wrong | Terminate. Re-scoping an item is a decision above this pipeline.                                                                                                                                                                                                                                                           |

### Phase 2 — Scenario planning

Dispatch [user-execution-scenario](../user-execution-scenario/SKILL.md) in **PLAN** mode. It runs before
implementation, not after: the rule requires the scenario to exist first.

| Outcome          | Route                                                                                                                                                                        |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PLANNED`        | Advance to phase 2.5 carrying the subject-bound author verdict and Stage-1 PASS. Phase 4 will run the same pipeline in GATE mode.                                            |
| `NOT-APPLICABLE` | Advance to phase 2.5 carrying the subject-bound author verdict and recorded reason. Phase 4 is **skipped**, and the PR description states the not-applicable reason instead. |
| `HALT`           | **Terminate** with the sub-pipeline's reason. Do not implement first and plan the scenario afterwards.                                                                       |

### Phase 2.5 — Planning checkpoint

Dispatch `backlog-pipeline` for GATE-IMPLEMENT. On PASS, immediately commit the guardian's PASS, the
`approved → in-progress` transition, the exact Task/spec pair, and any subject-bound PLAN ledger record
as one planning-only checkpoint. Verify that HEAD contains that checkpoint before entering Phase 3.

| Outcome                              | Route                                                                                                                     |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| PASS committed as exact checkpoint   | Advance to Phase 3.                                                                                                       |
| `FAIL`                               | Correct only the planning artifacts the guardian named, then re-run GATE-IMPLEMENT; do not implement.                     |
| `NON-COMPLIANCE`                     | **Terminate.** Report the implementation or retrospective-PLAN path that crossed the gate.                                |
| PASS exists only in the working tree | **Terminate.** A mutable PASS is not the ancestor Phase 3 requires; commit the exact planning checkpoint before resuming. |

### Phase 3 — Implementation

Route the actual work to the owner skills (table below). This pipeline sequences; it does not implement,
and it does not absorb what an owner skill defines.

| Outcome                                                              | Route                                                                                                                 |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Implementation and engineering verification complete, tree clean     | Advance to phase 4 (or phase 5 when phase 2 returned `NOT-APPLICABLE`).                                               |
| The work turns out to need a decision the rule reserves for the user | **Terminate — halt for the user.** Disclosing it in a PR body later is not approval.                                  |
| The scope grows beyond the endorsed recommendation                   | **Return to phase 1** with the enlarged scope. A recommendation endorsed for smaller work does not cover larger work. |
| The work splits into genuinely separate units                        | **Terminate** and re-enter once per named unit; each unit gets its own phase 1.                                       |

### Phase 4 — Done gate

Dispatch [user-execution-scenario](../user-execution-scenario/SKILL.md) in **GATE** mode.

| Outcome                 | Route                                                                                                                                                                                                                                                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `VERIFIED`              | Advance to phase 5.                                                                                                                                                                                                                                                                                          |
| `IMPLEMENTATION-DEFECT` | **Return to phase 3**, fix, then re-enter phase 4. Stop when the same defect set recurs unchanged and escalate ([no-progress escape](../../rules/enforcement-architecture.md)); bounded additionally at **2 rounds**; on the third, terminate — a defect that survives two targeted fixes is not understood. |
| `HALT`                  | **Terminate.** Status is not set, the item is not moved, and the PR does not claim the gate passed.                                                                                                                                                                                                          |

Never advance past this phase on anything other than `VERIFIED` or a phase-2 `NOT-APPLICABLE`. This is the
single edge the rule marks absolute.

### Phase 5 — Completion

The status change and the file move are **one commit**, in the order the rule states. They are one atomic
act, not two steps that usually happen together.

| Outcome                                           | Route                                                                                                                                                                                                     |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Both staged and committed together                | Advance to close-out.                                                                                                                                                                                     |
| The move fails or conflicts                       | **Do not commit the status change alone.** Revert the status edit, resolve the move, then redo both. A half-landed pair is the state the placement floor exists to catch — do not create it deliberately. |
| A previous commit already landed one half         | Complete the pair in the **next** commit, before any other work. Nothing else advances while status and location disagree.                                                                                |
| The item is ending unimplemented rather than done | Take the same one-commit path with the terminal status the rule defines for that case. An abandoned item still gets closed properly.                                                                      |

## Close-out

1. Open the PR — one item or one named work unit per PR, sized per the rule's PR Unit Rule. Its description
   carries every field that rule requires, including the gate result or the not-applicable reason.
2. Route the PR through the project's review and merge path; this pipeline does not merge protected
   branches on its own authority.
3. Report the outcome, and — when the gate passed — tell the user what was verified, the exact command or
   steps they can run, the expected result, and the evidence already observed.

The pipeline ends here. It does not start the next item.

## The recommendation is not self-judged

Previously the same actor formed the recommendation and then decided whether it was coherent with the
project's rules, layering, and architecture. That is a role producing and judging its own output, which
[enforcement-architecture.md](../../rules/enforcement-architecture.md) prohibits, and it is the reason
phase 1 dispatches `proposal-reviewer`.

What this changes, stated plainly: an independent review is now required at the recommendation gate, where
before there was none. What it does **not** change: the reviewer is a guardian, not an approver. Decisions
the rule reserves for the user still halt for the user, and an `ENDORSE` never converts a user decision
into an agent one.

The artifact under review is the recommendation — the approach and its fit — not the implementation,
which has not happened yet. That bounds what is handed over, not how hard the reviewer looks at it: its
charter mandates testing premises against real source and checking architecture placement, and neither
should be curtailed.

**Record the canonical pair.** The owner rule defines the expectation/observation schema and decision
projection. This pipeline must use `loop-run.mjs recommendation-expect` before dispatch and
`recommendation-observe` after return; a prose verdict copied into the Task or PR is context, not the gate.
The Task records the exact run ID so a reader can resolve the evidence without duplicating it.

## Terminate edges that belong to this level

- **Any Stop Condition in [backlog-execution.md](../../rules/backlog-execution.md) becomes true at any
  point** → terminate immediately, whichever phase is running. Each condition listed there is a terminate
  edge of this pipeline; they are owned by the rule and are not restated here.
- **The user interrupts** → record the current phase and the item's state, leave the tree in a committed or
  cleanly-stashed state, and stop.
- **A defect in the process itself is discovered mid-item** → record it as its own item; do not fold the
  fix into this one, unless it directly blocks the active phase, in which case take that phase's failure
  edge.

## Owner skill routing (phase 3)

Load only what the item needs.

| Work                                          | Owner                                               |
| --------------------------------------------- | --------------------------------------------------- |
| Branch safety and protected branches          | `branch-guard`                                      |
| Impact → verify → summarize loop              | `repo-change-loop`                                  |
| Contract boundary or package-ownership change | `spec-first-development`                            |
| SPEC authoring / drift after spec changes     | `spec-writing-standard`, `spec-code-conformance`    |
| Tests                                         | `tdd-red-green-refactor`, `vitest-testing-strategy` |
| Architecture and layering boundaries          | `architecture-patterns`                             |
| Type contracts and trust boundaries           | `type-boundary-and-ssot`                            |
| Post-implementation release/docs checklist    | `post-implementation-checklist`                     |

## What This Skill Does NOT Do

| Not this skill's job                             | Owner                                                                        |
| ------------------------------------------------ | ---------------------------------------------------------------------------- |
| Judge whether the recommendation is right        | `proposal-reviewer` (agent)                                                  |
| Author or judge a verification scenario          | [user-execution-scenario](../user-execution-scenario/SKILL.md) and its roles |
| Define gates, PR contracts, or status invariants | [backlog-execution.md](../../rules/backlog-execution.md)                     |
| Sequence several items under one initiative      | [multi-backlog-initiative](../multi-backlog-initiative/SKILL.md)             |
| Merge a protected branch                         | the user                                                                     |

If you find yourself forming a verdict, defining a gate, or doing an owner skill's work here, stop — route
to the owner instead.

## Record the run

Open a ledger entry before the first round, record each round's finding count, and close it with the
terminal reason it actually reached — `converged`, `no-progress`, `bound-reached`, `halted-for-user`, or
`abandoned` if it stopped without reaching any of them. A run that leaves no record cannot be told from a
run that never happened ([a loop run is recorded](../../rules/enforcement-architecture.md), which owns
what each terminal reason means).

```bash
node scripts/harness/loop-run.mjs open  --loop backlog-execution-orchestrator
node scripts/harness/loop-run.mjs round --loop backlog-execution-orchestrator --run <id> --findings <n>
node scripts/harness/loop-run.mjs close --loop backlog-execution-orchestrator --run <id> --terminal <reason>
```
