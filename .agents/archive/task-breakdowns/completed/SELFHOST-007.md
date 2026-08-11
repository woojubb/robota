# SELFHOST-007 — branching time-travel — DONE

Spec: [`.agents/spec-docs/done/SELFHOST-007-branching-time-travel.md`](../../spec-docs/done/SELFHOST-007-branching-time-travel.md)
GATE-APPROVAL: PASSED (ENDORSE). GATE-IMPLEMENT + VERIFY + COMPLETE: done.

## Slices (all DONE)

- [x] **agent-session neutral CheckpointTree (TC-01/02).** Pure, I/O-free `{id,parentId}` tree —
      add/fork/switch/listBranches/ancestors/activeLeaf + `fromNodes` reconstruction. No persistence,
      no retention policy.
- [x] **EditCheckpointStore branch-aware + non-destructive (TC-03).** `version:2` manifest
      (`parentId`/`branchId`); restore/rollback fork the active HEAD and keep the abandoned future as a
      sibling branch (no `rm`); v1 → linear migration; navigation delegates to the neutral tree.
- [x] **transport contracts (TC-05).** `IBranchEvent` `branch_event` + `IActiveBranchPointer`
      `IInteractiveSessionRecord.activeBranch`.
- [x] **/rewind fork/switch/branches (TC-05).** command-api + ICommandHostContext + agent-command
      routing; InteractiveSession implements the branch methods.
- [x] **--resume persistence (TC-05).** active-branch pointer persisted on save + restored on true
      resume; graceful degradation on cross-store drift (missing checkpoint → linear HEAD, no crash).
- [x] **TC-04 dependency direction** — `check-dependency-direction` scan (no cycle, no
      agent-core→session-facing-contract, no new @robota production dep on agent-core).

## Verification (AGENT-RUN)

workspace build:deps + typecheck + agent-framework 1161 + agent-command 237 + agent-session + lint
(0 errors) + `harness:scan` 54/54, all green.

## Deferred (follow-ups, per spec neutrality note)

- A **mechanical neutrality floor** for the checkpoint modules (a no-retention-policy / dependency
  allowlist scan) so branch-prune policy cannot creep into the neutral mechanism — mirrors SELFHOST-003
  TC-04's filed follow-up. Neutrality currently rests on the tree's purity + review.
