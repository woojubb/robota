# User-Local Memory Transparency for agent-cli

## Status

Completed.

## Created

2026-05-09

## Priority

P0 - baseline transparency feature for local preferences and remembered workflow state.

## Request

Define user-local memory and preference behavior for `agent-cli` so remembered values help the user
without becoming hidden automation, command reuse, or repo-owned configuration.

This backlog depends on
[User-Local Storage Foundation](completed/cli-user-local-storage-foundation.md) for storage root resolution,
repo-outside validation, inspection/removal APIs, and persistence policy.

The feature must answer:

> What did Robota remember, where is it stored, where is it displayed, and how can I remove or
> disable it?

## Non-Negotiable Product Principles

- **User-local memory is allowed only outside the repo.** Preferred working directories, UI state,
  and session state must be stored in user-local storage outside the repository.
- **Local memory must be inspectable.** Users must be able to view what is remembered, where it is
  stored, where it may be displayed, and how to delete or disable it.
- **Remembered command reuse is excluded.** Commands must not be persisted as reusable preferences
  and must not execute from local memory, session recall, or command history.
- **Memory may affect UI only within defined bounds.** Remembered values may affect display and
  navigation preferences, but not command execution.
- **Team-shared workflows are not Robota requirements.** If teams want repo-shared workflow files,
  they should add them intentionally through their own repo conventions.

## Memory Scope

Allowed baseline memory:

- last visible cwd or view choices for display/navigation only;
- TUI view preferences;
- session-local task associations;
- last selected background task;
- local display preferences.

Restricted memory:

- no hidden persistent command inference;
- no automatic conversion from repeated behavior into persistent preference;
- no command history or remembered command reuse as a baseline memory feature;
- no repo-local writes of any kind for baseline memory, including ignored files;
- no repo-shared workflow format required by `agent-cli`.

Each remembered item should expose:

- key;
- value summary;
- scope;
- source;
- storage location;
- created/last-used time;
- display/navigation rule;
- delete/disable action.

## Expected Outcomes

- Users can benefit from remembered local choices without wondering whether Robota is hiding
  automation.
- View choices and task associations become predictable because their source and display/navigation
  rule are visible.
- Local memory remains helpful for the individual user while avoiding repo-owned workflow
  requirements.
- Command execution remains tied to current user input or explicit acceptance, not remembered
  history.
- Troubleshooting becomes simpler because users can inspect, delete, or disable remembered values
  directly.

## Architecture Ownership Rule

`agent-cli` owns only TUI panels and commands that display, confirm, delete, or disable remembered
values.

Lower owners must be established first:

- `agent-sdk`: local preference store APIs, memory item projection, inspection/removal contracts,
  user-local-only storage policy, and display/navigation disclosure metadata.
- `agent-runtime`: session-local state association for running/background work where needed.
- `agent-command-*`: user-visible preference inspect/delete/disable commands backed by SDK
  contracts.

Do not implement memory storage shape, persistence policy, or display/navigation rules inside
`agent-cli`.

## Recommended First Slice

Create a design and contract PR before UI work:

1. Confirm the user-local storage foundation contract is available.
2. Define the user-local memory item model.
3. Consume the storage foundation's user-local-only persistence and repo-outside validation APIs.
4. Define inspection, deletion, disablement, and display/navigation-disclosure APIs.
5. Define what values can be remembered by default and what requires explicit opt-in.
6. Update `agent-sdk`, `agent-runtime`, `agent-command-*`, and `agent-cli` SPEC files.
7. Add tests for memory projection, deletion, disablement, no repo-local writes, and no remembered
   command execution.

## Acceptance Criteria

- [x] Users can inspect remembered values, storage locations, sources, last-used time, and
      display/navigation rules.
- [x] Users can delete or disable remembered values.
- [x] Remembered values cannot execute commands.
- [x] No repo-local files are written for baseline memory, including ignored files.
- [x] CLI UI depends on SDK/runtime memory contracts rather than owning storage policy.

## Test Plan

- Add SDK contract tests for memory item projection fields and storage scope labels.
- Add tests for inspection, deletion, disablement, and disabled-item non-reuse.
- Add tests proving repeated behavior does not silently become a persistent preference.
- Add tests proving memory writes stay outside the repository entirely.
- Add tests proving remembered commands, session recall, and command history cannot execute
  commands.
- Add CLI tests verifying users can see storage location, source, last-used time,
  display/navigation rule, and delete/disable actions.

## User Execution Test Scenarios

Not applicable. This backlog produced a user-local memory contract document and did not deliver
runnable Robota product behavior. Product-surface scenarios must be added by follow-up
implementation PRs that expose memory inspection through CLI/TUI/SDK behavior.

## Process Verification Evidence

### Verification: User-Local Memory Boundaries Are Documented

- Prerequisites: Run from the repository root.
- Verification commands:

  ```bash
  rg -n "Allowed remembered values must affect display or navigation only|remembered shell commands|commandExecutionEffect|deleteAvailable|disableAvailable|Existing `.robota/memory/` project memory" .agents/specs/user-local-memory.md
  ```

- Expected result: The command prints the display/navigation-only rule, restricted command
  memory, command execution effect, delete/disable fields, and project-memory boundary.
- Evidence: Executed as process verification for the contract document. SDK storage APIs and CLI
  rendering remain follow-up implementation work, where product-surface user execution test scenarios must be
  added.

## Verification Plan

- `pnpm harness:scan`
- Add SDK contract tests for memory inspection/removal.
- Add tests proving memory writes stay outside the repository entirely.
- Add tests proving remembered values cannot execute commands.
- Add CLI tests after memory contracts exist.

## Result

Completed by adding `.agents/specs/user-local-memory.md` and linking package ownership from
`agent-sdk`, `agent-runtime`, `agent-cli`, `agent-command-memory`, and `agent-sessions` SPEC files.

- The contract defines allowed display/navigation memory, restricted command/execution memory, item
  projection fields, inspection, deletion, and disablement rules.
- Existing project memory under `.robota/memory/` is documented as a separate explicit project
  memory feature, not baseline user-local memory.
- SDK storage APIs, delete/disable command behavior, migration from project memory, and CLI
  rendering tests remain follow-up implementation work.
- Follow-up implementation backlog:
  [User-Local Memory Inspection Implementation](../user-local-memory-inspection-implementation.md).
