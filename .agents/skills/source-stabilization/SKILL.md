---
name: source-stabilization
loop: over=attempt; bound=2 triages; escape=halt-for-user
description: Sub-orchestration for phase 1 of a release — getting the source branch green and landed on the release target. Sequences three steps (stabilize the source branch, open/refresh the source-to-target PR and wait for release-grade CI on the exact SHA, merge after green plus explicit approval), dispatching ci-gate-watch, ci-failure-triager, and merge-verifier, and routing on each outcome. Holds no gate definitions and no failure-classification criteria. Dispatched by release-orchestration.
---

# Source Stabilization — pipeline only

Phase 1 of a release. Its job is narrow: **the source branch is green, and it has demonstrably landed on
the release target.** Nothing about versions, changesets, or publishing belongs here.

This skill owns ordering and routing. Every constraint it invokes — which branches may open a PR against
which target, when a release-level merge is allowed, what a triage note must contain — is owned by the
rules below and is pointed at, not restated.

## Rule Anchor

- [publish.md](../../rules/publish.md) — "Release State Machine" (this phase's per-step constraints),
  "CI Failure Triage" (the triage-note contract), "Long-Running Gates", "Stop Conditions".
- [git-branch.md](../../rules/git-branch.md) — protected branches, allowed PR sources, release-level merge
  approval, "Merge Landing Verification".

## Steps and routing

**1. Stabilize the source branch.** Identify every CI blocker on the task branches feeding the source
branch, resolve them there, and merge them back into the source branch.

| Outcome                                        | Route                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No blockers remain                             | Advance to step 2.                                                                                                                                                                                                                                                                                                                                                                                      |
| A blocker exists                               | Dispatch `ci-failure-triager` on it **before changing any code** (the rule's ordering invariant). Then take the triage routing table below. Bounded: **at most 2 triages of one failure signature per release** — a third identical red is not a triage question, terminate and hand the note to the user. (This number lived only in the orchestration map before HARNESS-072; the skill owns it now.) |
| A blocker needs a decision only the user makes | Return `HALT` to the caller.                                                                                                                                                                                                                                                                                                                                                                            |

**2. Open or refresh the source-to-target PR, and wait for release-grade CI on the exact SHA.** The SHA
matters: a check that passed on an earlier SHA has not verified this one.

| Outcome                                          | Route                                                                                |
| ------------------------------------------------ | ------------------------------------------------------------------------------------ |
| Checks not yet conclusive                        | Dispatch [ci-gate-watch](../ci-gate-watch/SKILL.md) and route on **its** outcome.    |
| All required checks green **on the exact SHA**   | Advance to step 3.                                                                   |
| A required check red                             | Dispatch `ci-failure-triager`; take the triage routing table below.                  |
| New commits landed on the source branch mid-wait | **Return to step 2** against the new SHA — never carry an older SHA's green forward. |

**3. Merge the source branch into the release target, then verify it landed.** The merge requires the
explicit approval [git-branch.md](../../rules/git-branch.md) mandates; this pipeline never substitutes its
own judgement for it.

| Outcome                                                     | Route                                                                                                                                                                                                                                                                            |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Approval not given                                          | Return `HALT` — the phase is complete only when the merge has landed.                                                                                                                                                                                                            |
| Merged → dispatch `merge-verifier` → `MERGE VERIFIED: PASS` | Return `COMPLETE`.                                                                                                                                                                                                                                                               |
| `merge-verifier` reports `MERGE VERIFIED: FAIL`             | Do **not** re-merge blindly. Take the verifier's finding: if the merge is absent on the target's remote head, **return to step 3**; if a claimed change is missing or unrelated drift landed, return `HALT` — a bad merge on a protected target is a user decision, not a retry. |

## Triage routing (steps 1 and 2)

`ci-failure-triager` returns a class and a validation path; this pipeline routes on them and does not
re-judge. Track `triage_attempts` per distinct failure signature, cap **2**.

| Class returned                                                                 | Route                                                                                                                               |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `product defect` / `CI harness infrastructure` / `dependency or lockfile sync` | Apply the minimal fix on a task branch, run the triager's stated validation path, then **return to step 1**.                        |
| `test race or flake`                                                           | Re-run the failing check once. Green → return to the step that dispatched the triage. Red again → treat as `product defect`.        |
| `external environment or service`                                              | Re-run after the interval the triage note recommends, at most twice, then return `HALT`. Never patch code for an environment class. |
| The validation path does **not** pass after the fix                            | Re-triage with the new signature and increment `triage_attempts`.                                                                   |
| `triage_attempts` exceeds the cap for one signature                            | Return `HALT` — repeated failed validation means the classification is wrong, and looping cannot discover that.                     |

## Outcome contract

Return exactly one to the caller, with the evidence behind it:

- `COMPLETE` — the source branch is merged and independently verified as landed on the release target.
- `RETRY` — a transient condition cleared and the whole phase should re-run from step 1.
- `HALT` — a stop condition fired, approval is missing, or a cap was exceeded. Name which.

This phase never returns `REGRESSED`: it _is_ the phase a regression returns to.

## Record the run

Open a ledger entry before the first round, record each round's finding count, and close it with the
terminal reason it actually reached — `converged`, `no-progress`, `bound-reached`, `halted-for-user`, or
`abandoned` if it stopped without reaching any of them. A run that leaves no record cannot be told from a
run that never happened ([a loop run is recorded](../../rules/enforcement-architecture.md), which owns
what each terminal reason means).

```bash
node scripts/harness/loop-run.mjs open  --loop source-stabilization
node scripts/harness/loop-run.mjs round --loop source-stabilization --run <id> --findings <n>
node scripts/harness/loop-run.mjs close --loop source-stabilization --run <id> --terminal <reason>
```
