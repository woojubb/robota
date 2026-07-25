---
name: version-bump
description: Sub-orchestration for phase 2 of a release — cutting the bump branch from the freshly-fetched release target, applying the coordinated version bump, regenerating the changelog, running local release preparation, and landing the bump PR. Sequences six steps, dispatching version-management for the bump itself plus ci-gate-watch, ci-failure-triager, and merge-verifier, and routes on each outcome including the lockfile/diff-hygiene edge. Holds no versioning policy. Dispatched by release-orchestration.
---

# Version Bump — pipeline only

Phase 2 of a release. Its job: **the target version exists on the release target, cleanly.** How versions
are chosen, how the bump tool is driven, and what a coordinated bump means are owned by
[version-management](../version-management/SKILL.md) — this skill dispatches it and routes on the result.

## Rule Anchor

- [publish.md](../../rules/publish.md) — "Release State Machine" (this phase's per-step constraints: fresh
  base, never hand-edit the lockfile, no unrelated process fixes in a bump PR), "Stop Conditions".
- [version-management](../version-management/SKILL.md) — all versioning policy and the bump mechanics.
- [git-branch.md](../../rules/git-branch.md) — branch base freshness, "Merge Landing Verification".

## Steps and routing

**1. Cut the bump branch from the freshly-fetched release target.** Fetch first; a stale local branch is
the failure this step exists to prevent.

| Outcome                                          | Route                                                                                      |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| Branch cut from the current remote head          | Advance to step 2.                                                                         |
| The remote head moved after the fetch            | **Repeat step 1** against the new head.                                                    |
| The remote head does not contain phase 1's merge | Return `REGRESSED` — stabilization did not land what it claimed; do not bump on top of it. |

**2. Apply the version bump.** Dispatch [version-management](../version-management/SKILL.md). When package
manifests change, run the project's install so the lockfile is regenerated — never hand-edit it (the
rule's invariant).

| Outcome                                              | Route                                                                                                                  |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Bump produced the expected version + changelog diffs | Advance to step 3.                                                                                                     |
| The bump produced no diff                            | **Repeat step 2** after confirming the correct bump entry point was used; if it still produces nothing, return `HALT`. |
| A changeset is missing for a changed package         | **Repeat step 2** after adding it — an incomplete changelog is a defect, not a cosmetic issue.                         |

**3. Regenerate the changelog** through the generator [publish.md](../../rules/publish.md) names. The rule
requires the bump PR to carry a generated changelog; a hand-written one does not satisfy it.

| Outcome                                    | Route                                                                                |
| ------------------------------------------ | ------------------------------------------------------------------------------------ |
| Regenerated, and the diff matches the bump | Advance to step 4.                                                                   |
| The generator produced nothing or errored  | **Repeat step 2** — an empty changelog usually means the bump itself was incomplete. |

**4. Run local release preparation.** Build, the project's publish-safety scan, and diff hygiene (the
branch contains the bump and nothing else).

| Outcome                                              | Route                                                                                                                                                                                        |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| All clean                                            | Advance to step 5.                                                                                                                                                                           |
| Build or the publish-safety scan fails               | Dispatch `ci-failure-triager`; take the triage routing table below.                                                                                                                          |
| Diff hygiene fails on **lockfile churn from step 2** | This is expected output of the bump, not contamination: confirm it is exactly the install's regeneration, keep it, advance. If it is anything more, **return to step 1** and re-cut cleanly. |
| Diff hygiene fails on **unrelated changes**          | Remove them from this branch (the rule forbids mixing process fixes into a bump PR) and **repeat step 4**. If they cannot be separated, **return to step 1**.                                |

**5. Open the bump PR against the release target and wait for CI on the exact SHA.**

| Outcome                               | Route                                                                             |
| ------------------------------------- | --------------------------------------------------------------------------------- |
| Checks not yet conclusive             | Dispatch [ci-gate-watch](../ci-gate-watch/SKILL.md) and route on **its** outcome. |
| Green on the exact SHA                | Advance to step 6.                                                                |
| Red                                   | Dispatch `ci-failure-triager`; take the triage routing table below.               |
| The release target moved under the PR | **Return to step 1** — re-cut from the new head rather than merging a stale base. |

**6. Merge the bump PR, then verify it landed.** Merge only on green, with the approval
[git-branch.md](../../rules/git-branch.md) requires.

| Outcome                                                  | Route                                                                                                     |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Merged → `merge-verifier` returns `MERGE VERIFIED: PASS` | Return `COMPLETE`.                                                                                        |
| `merge-verifier` returns `MERGE VERIFIED: FAIL`          | Merge absent on the remote head → **return to step 6**. Version files missing or drift swept in → `HALT`. |
| Approval not given                                       | Return `HALT`.                                                                                            |

## Triage routing (steps 4 and 5)

Identical shape to phase 1's, because the routing belongs to the failure class rather than the phase.
Track `triage_attempts` per distinct failure signature, cap **2**.

| Class returned                                      | Route                                                                                               |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `product defect` / `CI harness infrastructure`      | Fix it **off this branch** (the bump PR stays pure), land it, then **return to step 1**.            |
| `dependency or lockfile sync`                       | Re-run the install on this branch and **repeat step 4** — this class is in-scope for a bump branch. |
| `test race or flake`                                | Re-run once. Green → return to the dispatching step. Red again → treat as `product defect`.         |
| `external environment or service`                   | Re-run after the recommended interval, at most twice, then `HALT`.                                  |
| Validation path does not pass after the fix         | Re-triage with the new signature; increment `triage_attempts`.                                      |
| `triage_attempts` exceeds the cap for one signature | Return `HALT`.                                                                                      |

## Outcome contract

- `COMPLETE` — the target version is on the release target and independently verified as landed.
- `RETRY` — re-run the phase from step 1.
- `REGRESSED` — the release target no longer contains what phase 1 landed; the caller returns to phase 1.
- `HALT` — a stop condition fired, approval is missing, or a cap was exceeded. Name which.
