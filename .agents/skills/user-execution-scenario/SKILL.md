---
name: user-execution-scenario
description: Sub-orchestration for the user-execution verification scenarios of one work unit. Runs in two modes at two moments — PLAN (before implementation: decide applicability, dispatch user-execution-scenario-author, gate that every scenario is written) and GATE (after implementation: execute each scenario, record the evidence, gate that it was executed and matched). Dispatches user-execution-scenario-author and backlog-gate-guard and routes on their outcomes. Holds no scenario criteria and forms no gate verdict. Dispatched by backlog-execution-orchestrator.
loop: over=finding-set; escape=no-progress; bound=2 rounds
---

# User-Execution Scenario — pipeline only

The scenario is written before the work and executed after it, so this is one pipeline entered twice.
It owns **ordering and routing** for both entries and nothing else: what a valid scenario is, what a stage
must contain, and when a gate may be waived are invariants owned by the rule below and are pointed at,
never restated.

Two roles do the actual work. `user-execution-scenario-author` **produces** scenarios;
`backlog-gate-guard` **judges** whether a stage passes. This pipeline does neither — if you find yourself
deciding whether a scenario is good enough, stop and dispatch the guardian.

## Rule Anchor

- [backlog-execution.md](../../rules/backlog-execution.md) — "User Execution Test Scenario Rule" (what a
  valid scenario is, and what is banned as evidence), "Capability Reachability", "Agent Executability
  Requirement", "Done Gate Stage 1 / Stage 2" (the mandate and the authoritative
  engineering-verification-is-never-evidence statement), "Stop Conditions".
- [enforcement-architecture.md](../../rules/enforcement-architecture.md) — worker / guardian / orchestrator.

## Mode PLAN — before implementation starts

**1. Decide applicability.** Dispatch `user-execution-scenario-author` to answer whether this work unit
delivers runnable user-facing behavior at all.

| `SCENARIO DRAFTED` outcome                                           | Route                                                                                                                                                                                                                                      |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `not-applicable`                                                     | Record the subject-bound `SCENARIO DRAFTED: not-applicable \| 0` verdict and the author's reason in the exact work item, then return `NOT-APPLICABLE`. The caller records engineering evidence instead; it does **not** invent a scenario. |
| `automatable` with ≥1 scenario                                       | Advance to step 3.                                                                                                                                                                                                                         |
| `manual` with ≥1 scenario                                            | Advance to step 2 — a manual label is not accepted on first return.                                                                                                                                                                        |
| The author reports an unreachable capability behind an internal seam | **Return `HALT`.** The rule forbids treating this as N/A. The caller must plan the surface wiring, or take it to the user; this pipeline cannot resolve it.                                                                                |

**2. Bound the redesign search.** A manual label means no automatable surface was found. Re-dispatch the
author to attempt an equivalent accessible path, at most **2 redesign attempts** in total.

| Outcome                                                                           | Route                                                                                                                         |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| A later attempt returns `automatable`                                             | Advance to step 3.                                                                                                            |
| `manual` again, **with a specific technical reason** for why no equivalent exists | Accept the manual label, carry the reason verbatim into the work item, and advance to step 3.                                 |
| `manual` again with a reason that names no technical barrier                      | **Return `HALT`.** "It is a UI" is not a reason; an unlabelled-or-vaguely-labelled unexecutable scenario is a rule violation. |
| The redesign cap is reached with no decision                                      | **Return `HALT`** and name the surface that blocked it. Looping further cannot discover what two attempts did not.            |

**3. Establish the environment the scenario needs.** If the scenario requires a fixture, sample project,
local service, or seed data that does not exist, that gap must close before implementation, not at gate
time.

| Outcome                             | Route                                                                                                    |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------- |
| The environment exists              | Advance to step 4.                                                                                       |
| The work unit can build it          | Fold it into the work unit's own scope and advance to step 4.                                            |
| It cannot be built inside this unit | **Return `HALT`** — the rule requires it be built, proposed, or decided with the user before proceeding. |

**4. Gate that every scenario is written.** Dispatch `backlog-gate-guard` for the written-scenario stage
against the work item.

| `GATE VERDICT`   | Route                                                                                                                                                                                                                                                                                                     |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PASS`           | Record the subject-bound `SCENARIO DRAFTED` verdict and this `DONE-GATE-STAGE-1` PASS in the exact work item, then return `PLANNED`. The caller must create the GATE-IMPLEMENT planning checkpoint before implementation may begin.                                                                       |
| `FAIL`           | **Return to step 1** with the guardian's failing criterion, so the author fills what is missing. Stop when the same criteria fail unchanged and escalate ([no-progress escape](../../rules/enforcement-architecture.md)); bounded additionally at **2 re-authoring rounds**; on the third, return `HALT`. |
| `NON-COMPLIANCE` | **Return `HALT`.** Process was bypassed — implementation started before the scenario existed, or evidence was recorded that no run produced. This is a user-facing report.                                                                                                                                |

## Mode GATE — after implementation, before completion

Entered only when PLAN returned `PLANNED`. If PLAN returned `NOT-APPLICABLE`, this mode does not run.

**5. Execute every scenario against the completed work.** The pipeline runs them; it does not delegate the
run to the user. A scenario carrying an accepted manual label is not executed here — carry its label and
reason forward instead.

| Outcome                                         | Route                                                                                                       |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Observed result matches the expected observable | Record the concrete evidence in the work item's evidence field and advance to step 6.                       |
| Observed result does **not** match              | Take the mismatch routing table below.                                                                      |
| The scenario cannot be run in this environment  | Probe for the missing capability and record the probe, per the rule's absence-claim invariant. Then `HALT`. |

**Mismatch routing.** A failed scenario is not automatically a failed implementation. Route by which side
is wrong, and never by which is easier to change:

| Cause                                                                                                               | Route                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The implementation is wrong                                                                                         | Return `IMPLEMENTATION-DEFECT` to the caller so it re-enters its implementation phase. Bounded: **2 fix-and-re-run rounds per scenario**.                   |
| The scenario is wrong — the expected observable was misstated, or the command does not drive the surface it claimed | **Return to step 1** to re-author, which the rule requires happen before a re-run, never after seeing the output. Bounded: **1 re-authoring**, then `HALT`. |
| Cause cannot be determined                                                                                          | **Return `HALT`** with both hypotheses and the evidence for each. Guessing here is how a real defect gets renamed a scenario bug.                           |
| Any bound above is exceeded                                                                                         | **Return `HALT`.** Repeated failure past the cap means the diagnosis is wrong, and looping cannot discover that.                                            |

**6. Gate that every scenario was executed and matched.** Dispatch `backlog-gate-guard` for the
executed-scenario stage.

| `GATE VERDICT`   | Route                                                                                                                                                            |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PASS`           | Return `VERIFIED`.                                                                                                                                               |
| `FAIL`           | **Return to step 5** for the scenarios the guardian named. Bounded by the same per-scenario caps; on exhaustion, `HALT`.                                         |
| `NON-COMPLIANCE` | **Return `HALT`.** Typically: the work was marked complete before this stage ran, or engineering verification was cited as the evidence. Surface it to the user. |

## Outcome contract

Return exactly one to the caller, with the evidence behind it:

- `NOT-APPLICABLE` — this work unit delivers no runnable user-facing behavior; the reason is recorded.
- `PLANNED` — every scenario is written and the written-scenario stage passed (PLAN mode only).
- `VERIFIED` — every scenario was executed against the completed work, matched, and its evidence is
  recorded in the work item (GATE mode only).
- `IMPLEMENTATION-DEFECT` — a scenario ran and the product did not do what it should. The caller owns the
  fix; re-enter this pipeline at step 5 afterwards.
- `HALT` — a bound was exceeded, an environment or capability gap is unresolved, or a process violation
  was found. Name which.

Every terminal result is subject-bound: its `SCENARIO DRAFTED` signal and reason or Stage-1 PASS are
recorded in the exact Task before return. A loop ledger record for PLAN carries that Task path or
basename in `ref`; an unbound ledger entry cannot satisfy GATE-IMPLEMENT.

Never return `VERIFIED` on a `NOT-APPLICABLE`, and never return it while any scenario carries an
unexecuted, unlabelled state. Those are the two ways this gate has historically been passed without
verifying anything.

## Record the run

Open a ledger entry before the first round, record each round's finding count, and close it with the
terminal reason it actually reached — `converged`, `no-progress`, `bound-reached`, `halted-for-user`, or
`abandoned` if it stopped without reaching any of them. A run that leaves no record cannot be told from a
run that never happened ([a loop run is recorded](../../rules/enforcement-architecture.md), which owns
what each terminal reason means).

```bash
node scripts/harness/loop-run.mjs open  --loop user-execution-scenario
node scripts/harness/loop-run.mjs round --loop user-execution-scenario --run <id> --findings <n>
node scripts/harness/loop-run.mjs close --loop user-execution-scenario --run <id> --terminal <reason>
```
