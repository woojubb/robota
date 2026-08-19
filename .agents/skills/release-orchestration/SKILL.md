---
name: release-orchestration
description: Top-level orchestrator for a release. Sequences three phases — source-stabilization → version-bump → npm-otp-publish — maintains the release control-plane state artifact across them, and routes on each phase's outcome (advance / repeat / return to an earlier phase / terminate). It holds NO release policy: every command name, gate definition, required field, and prohibition is owned by the project's publish rule and is pointed at, never restated. Use when running a release, a release-level merge, a version bump, or a publish.
loop: over=attempt; bound=2 re-runs
invocable: true
---

# Release Orchestration — pipeline only

The state machine for a release. This skill owns **ordering and routing between phases** and nothing else.
It does not define what a gate is, what the state artifact must contain, which publish command is allowed,
or when to stop — those are invariants owned by the rules below, and restating them here would create a
second copy that drifts.

Where the procedure needs a concrete command, script, artifact path, or branch name, it **points at the
rule that owns it**. The only names used literally are the pipeline's own structure: the phase skills and
the agents it dispatches.

## Rule Anchor

- `AGENTS.md` > "Rules and Skills Boundary" — skills are procedure; rules win on conflict.
- [publish.md](../../rules/publish.md) — the release runbook's invariants: "Release Control Plane"
  (required state fields), "Release-Run Artifact" (the state artifact and its entry points),
  "Release State Machine" (phase order and its per-step constraints), "CI Failure Triage" (the triage-note
  contract), "Long-Running Gates", "Dist Artifact Invariant", "Publish Boundary", "Stop Conditions".
- [git-branch.md](../../rules/git-branch.md) — branch policy, merge approval, merge landing verification.
- [enforcement-architecture.md](../../rules/enforcement-architecture.md) — orchestrator / worker / guardian.

## Preconditions (refuse to start otherwise)

1. The release target is explicit: a source branch, a target version, and the user's intent to release.
2. The working tree is clean of anything unrelated to this release (a Stop Condition in the rule).
3. The release-run state artifact exists for the target version, created through the entry point the rule
   names, and reflects the current SHA and branch.

If any precondition fails → **terminate** and report which one. Do not open the pipeline "provisionally":
the rule forbids beginning gate-sensitive work while the release state is unclear.

## State-artifact duty (runs at every transition, not as a step)

Before entering a phase, when a phase's gate status changes, and immediately after any terminate edge
fires, update the release-run artifact so it names the active gate, the next action, and the stop
condition for the phase now running. This is a continuous duty of this orchestrator, not a numbered step
any phase owns. The artifact's required fields and its update entry points belong to
[publish.md](../../rules/publish.md) — read them there.

## Phases and routing

| #   | Phase                                                    | Advance when                                                           | On failure                                            |
| --- | -------------------------------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------- |
| 1   | [source-stabilization](../source-stabilization/SKILL.md) | the source branch has landed on the release target, verified as landed | route per the phase's own edges; it escalates to here |
| 2   | [version-bump](../version-bump/SKILL.md)                 | the bump has landed on the release target, verified as landed          | route per the phase's own edges                       |
| 3   | [npm-otp-publish](../npm-otp-publish/SKILL.md)           | every in-scope package is published at the target version              | route per the phase's own edges                       |

Each phase returns one of four outcomes. This orchestrator routes on the outcome and forms no verdict of
its own:

| Phase outcome | Route                                                                                                                                                                                             |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `COMPLETE`    | Advance to the next phase. After phase 3, go to **Close-out**.                                                                                                                                    |
| `RETRY`       | Re-run the same phase. Bounded: **at most 2 re-runs of any one phase per release**. On the third, terminate and hand to the user with the phase's own report.                                     |
| `REGRESSED`   | Return to **phase 1**. A later phase discovering the source is no longer green (a new merge landed, the base diverged) invalidates stabilization; do not patch forward from inside a later phase. |
| `HALT`        | **Terminate.** Report the release state, the failing gate, and the stop condition that fired. Do not continue to a later phase, and never skip a phase to recover.                                |

Additional edges that belong to this level:

- **A Stop Condition in [publish.md](../../rules/publish.md) becomes true at any point** → `HALT`
  immediately, whichever phase is running. Each condition listed there is a terminate edge of this
  pipeline; they are not restated here.
- **The user interrupts the turn** → terminate any observation loop a phase left running (the rule's
  watcher-cleanup invariant), record the interrupted state in the artifact, and stop.
- **A process defect is discovered mid-release** → do not fold the fix into the release. Record it and
  continue, unless it directly blocks the currently active gate — in which case treat it as that phase's
  failure and take the phase's own edge.

## Close-out

After phase 3 reports `COMPLETE`:

1. Update the artifact to its terminal state and clear any watcher it recorded.
2. Generate the final release report through the entry point [publish.md](../../rules/publish.md) names.
   Its required contents are that rule's contract — do not compose an ad-hoc summary instead.
3. Report the outcome to the user. The pipeline ends here; it does not start another release.

## What This Skill Does NOT Do

| Not this skill's job                            | Owner                                                  |
| ----------------------------------------------- | ------------------------------------------------------ |
| Decide why a check is red                       | `ci-failure-triager` (agent)                           |
| Decide whether a merge truly landed             | `merge-verifier` (agent)                               |
| Sequence the steps inside a phase               | that phase's own skill                                 |
| Define gates, required fields, allowed commands | [publish.md](../../rules/publish.md)                   |
| Choose the version or author changesets         | [version-management](../version-management/SKILL.md)   |
| Merge the release target                        | the user (release-level merge needs explicit approval) |

If you find yourself judging a failure, defining a gate, or running a phase's internal steps here, stop —
route to the owner instead.

## Record the run

Open a ledger entry before the first round, record each round's finding count, and close it with the
terminal reason it actually reached — `converged`, `no-progress`, `bound-reached`, `halted-for-user`, or
`abandoned` if it stopped without reaching any of them. A run that leaves no record cannot be told from a
run that never happened ([a loop run is recorded](../../rules/enforcement-architecture.md), which owns
what each terminal reason means).

```bash
node scripts/harness/loop-run.mjs open  --loop release-orchestration
node scripts/harness/loop-run.mjs round --loop release-orchestration --run <id> --findings <n>
node scripts/harness/loop-run.mjs close --loop release-orchestration --run <id> --terminal <reason>
```
