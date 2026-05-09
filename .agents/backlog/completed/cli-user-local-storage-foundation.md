# User-Local Storage Foundation for agent-cli

## Status

Completed.

## Created

2026-05-09

## Priority

P0 - prerequisite storage policy work for transparent workflow memory, preferences, and local task
state.

## Request

Define the user-local storage foundation that `agent-cli`, `agent-sdk`, and related command modules
must use for baseline workflow state.

The feature must answer:

> Where does Robota store user-local state, how can users inspect it, and how do we prove no
> baseline workflow state is written into the user's repository?

## Non-Negotiable Product Principles

- **User-local only for baseline workflow state.** Baseline workflow memory, preferences, display
  state, task associations, and transparent workflow metadata must be stored outside the repository.
- **No repo-local fallback.** No tracked repo file, ignored repo file, project `.robota/` cache, or
  workspace-local state path is allowed for baseline workflow storage.
- **Storage must be inspectable.** Users must be able to see the effective user-local root, stored
  categories, item summaries, and deletion/disable actions.
- **Commands are not remembered for execution.** User-local storage must not persist commands as
  reusable execution preferences.
- **Repo independence remains mandatory.** User repositories must remain usable without Robota and
  must not need Robota-created files to support baseline workflow features.

## Storage Scope

This backlog covers baseline workflow storage for:

- UI/view preferences;
- display/navigation choices;
- local memory item projections;
- background task associations;
- transparent workflow metadata;
- inspection and deletion indexes.

This backlog must explicitly exclude:

- command history as an execution source;
- project-local `.robota/` workflow state for baseline features;
- repo-shared workflow definitions;
- repo-side manifests, hooks, scripts, or package dependencies.

The implementation plan must audit existing `.robota/` usage before changing behavior. Existing
project-local storage decisions may require separate migration backlogs if they conflict with this
policy.

## Expected Outcomes

- `agent-cli` can provide transparent local memory without introducing repository dependency.
- Users can predict and inspect where Robota stores local state.
- Later memory and background-work features have one storage policy instead of choosing paths
  independently.
- Architecture reviews can reject baseline features that write workflow state inside the repo.
- Existing project-local storage usage becomes visible as either legacy behavior, explicit
  project-owned behavior, or migration work.

## Architecture Ownership Rule

`agent-cli` owns only UI and commands that display the effective storage root, category summaries,
and deletion/disable actions.

Lower owners must be established first:

- `agent-sdk`: user-local storage root resolution, category contracts, item projection APIs,
  inspection/removal APIs, and repo-outside validation.
- `agent-runtime`: session-local associations that need to be persisted through SDK storage
  contracts.
- `agent-command-*`: user-visible storage/memory/preference inspection commands backed by SDK
  contracts.

Do not implement storage path resolution, persistence policy, migration policy, or repo-outside
validation inside `agent-cli`.

## Recommended First Slice

Create a design and contract PR before UI work:

1. Audit current user-level and project-level `.robota` storage usage in `agent-cli`, `agent-sdk`,
   `agent-runtime`, and command modules.
2. Define the canonical user-local storage root policy and category layout for baseline workflow
   state.
3. Define a repo-outside validation rule that rejects paths inside the active repository.
4. Define inspection/removal APIs for user-local categories and items.
5. Define migration/backlog recommendations for any existing project-local storage that conflicts
   with baseline user-local-only policy.
6. Update the cross-cutting specs and package `SPEC.md` files before any TUI work.
7. Add follow-up implementation slices for storage root resolution, storage inspection command, and
   memory feature integration.

## Acceptance Criteria

- [x] The policy defines exactly one allowed persistent storage class for baseline workflow state:
      user-local storage outside the repository.
- [x] The policy forbids repo-local baseline storage, including ignored files and project `.robota`
      caches.
- [x] The policy states that remembered commands cannot be stored as reusable execution preferences.
- [x] The policy defines inspect/delete/disable requirements for stored user-local items.
- [x] Existing `.robota` storage usage is audited and classified before implementation.
- [x] CLI UI depends on SDK storage contracts rather than owning path resolution or persistence
      policy.

## Test Plan

- Add SDK tests for user-local root resolution and category layout.
- Add tests proving the resolved storage root is outside the active repository.
- Add negative tests proving repo-local, ignored-file, and project `.robota` storage paths are
  rejected for baseline workflow state.
- Add contract tests for category inspection, item deletion, and disablement.
- Add tests proving commands cannot be stored or loaded as reusable execution preferences.
- Add CLI tests only after SDK contracts exist, verifying the effective storage root and stored item
  summaries are visible.

## User Execution Test Scenarios

Not applicable. This backlog produced a user-local storage contract document and did not deliver
runnable Robota product behavior. Product-surface scenarios must be added by follow-up
implementation PRs that expose storage inspection or behavior through CLI/TUI/SDK usage.

## Process Verification Evidence

### Verification: Baseline Storage Is User-Local Only

- Prerequisites: Run from the repository root.
- Verification commands:

  ```bash
  rg -n "~/.robota|No workspace-local fallback|No project `.robota/` cache|Command strings must not be stored|Repo-Outside Validation" .agents/specs/user-local-storage.md
  ```

- Expected result: The command prints the canonical user-local root, no fallback rule,
  project `.robota/` prohibition, command-string storage prohibition, and repo-outside validation
  section.
- Evidence: Executed as process verification for the contract document; no product-surface scenario
  applies until implementation exposes the behavior.

## Verification Plan

- `pnpm harness:scan`
- Document authority scan must pass when this backlog is later promoted.
- Implementation PRs must add SDK storage contract tests before TUI screens.
- Tests must include fixture repositories with no Robota files and must prove no baseline storage is
  written inside the repo.

## Result

Completed by adding `.agents/specs/user-local-storage.md` and linking package ownership from
`agent-sdk` and `agent-cli` SPEC files.

- The policy defines user-local storage outside the active repository as the only allowed persistent
  storage class for baseline workflow state.
- Existing `.robota` uses are audited and classified so later implementation PRs can migrate or
  avoid them deliberately.
- The policy forbids remembered commands from becoming executable preferences.
- SDK storage root/category/inspection contracts and tests are deferred to implementation PRs.
- Follow-up implementation backlog:
  [User-Local Storage Inspection Implementation](../user-local-storage-inspection-implementation.md).
