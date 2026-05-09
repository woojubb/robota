# User-Local Storage Inspection Implementation

## Status

Completed.

## Created

2026-05-09

## Priority

P0 - implementation prerequisite for user-local memory, preferences, and transparent workflow state.

## Request

Implement the user-local storage foundation defined by
[user-local-storage.md](../specs/user-local-storage.md) so users can inspect the effective storage
root, categories, and stored item summaries through a Robota product surface.

This backlog implements the follow-up work deferred by
[User-Local Storage Foundation](cli-user-local-storage-foundation.md).

## Recommendation Gate

Recommended approach:

- Implement SDK-owned user-local root resolution, repo-outside validation, category projection, and
  item inspection contracts first.
- Add a user-visible product command routed by `agent-cli` but owned by SDK/command contracts:
  `robota user-local storage list --format json`.
- Keep this command provider-free so users can inspect local Robota state without configuring an AI
  provider or opening the TUI.
- Use the repository-local built CLI binary for user execution test scenario verification:
  `node packages/agent-cli/dist/node/bin.js ...`.

Why this matches the backlog intent:

- The feature proves Robota can disclose where baseline workflow state would be stored before any
  memory UI depends on it.
- It keeps the user's repository independent because storage is resolved under user-local home and
  validated outside the active repository.
- It keeps `agent-cli` thin: CLI routing and output formatting are allowed, while storage semantics
  belong to SDK contracts.

Affected scope:

- `packages/agent-sdk`: storage root resolver, repo-outside validation, category/item projections.
- `packages/agent-command-*` or a new command owner: product command behavior and output shape.
- `packages/agent-cli`: provider-free command routing to the command owner.
- Package `SPEC.md` files and cross-cutting specs as needed.

Open decisions:

- Exact command owner package name can be chosen during implementation. It must not put storage
  semantics inside `agent-cli`.

## Acceptance Criteria

- [x] SDK resolves the effective user-local root under the user's home directory by default.
- [x] SDK rejects a baseline workflow storage root inside the active repository.
- [x] SDK exposes stable category projections for `preferences`, `view-state`,
      `memory-projections`, `task-associations`, `workflow-metadata`, and `inspection-index`.
- [x] Product command `robota user-local storage list --format json` prints the effective root and
      category summaries without requiring provider configuration.
- [x] The product command does not create tracked, ignored, or project `.robota/` baseline workflow
      state in the active repository.
- [x] Stored command strings are not exposed as reusable execution preferences.
- [x] The backlog is updated with User Execution Test Scenario evidence after implementation.

## Test Plan

- Add SDK unit tests for default root resolution and injected test home/root behavior.
- Add SDK negative tests for roots equal to or inside the active repository, including symlink cases
  where feasible.
- Add SDK contract tests for storage category projections and item summary fields.
- Add command-package tests for JSON output and provider-free execution.
- Add CLI routing tests proving the product command reaches the command owner without opening the
  provider setup flow.
- Run `pnpm harness:scan`.

## User Execution Test Scenarios

### Scenario: Inspect User-Local Storage From A Repository With No Robota Files

- Prerequisites:
  - The implementation must build `packages/agent-cli/dist/node/bin.js`.
  - The implementation must provide the product command
    `robota user-local storage list --format json`.
  - No provider configuration should be required for this command.
- Test environment:

  ```bash
  ROBOTA_REPO="/Users/jungyoun/Documents/dev/robota"
  TMP_HOME="$(mktemp -d)"
  FIXTURE_REPO="$(mktemp -d)"
  pnpm --dir "$ROBOTA_REPO" --filter @robota-sdk/agent-cli build
  ```

- User actions:

  ```bash
  (
    cd "$FIXTURE_REPO"
    HOME="$TMP_HOME" node "$ROBOTA_REPO/packages/agent-cli/dist/node/bin.js" user-local storage list --format json
  )
  find "$FIXTURE_REPO" -maxdepth 2 -name ".robota" -o -name "robota*"
  ```

- Expected observable result:
  - The first command exits 0 and prints JSON containing a `root` under `$TMP_HOME/.robota`.
  - The JSON contains category names including `preferences`, `view-state`, `memory-projections`,
    `task-associations`, `workflow-metadata`, and `inspection-index`.
  - The JSON does not contain any reusable command execution preference.
  - The `find` command prints no project `.robota` or Robota baseline workflow state inside
    `$FIXTURE_REPO`.
- Cleanup/reset:

  ```bash
  rm -rf "$TMP_HOME" "$FIXTURE_REPO"
  ```

- Agent verification: Must be executed after implementation using the commands above.
- Evidence:
  - Executed after implementation from `/Users/jungyoun/Documents/dev/robota`.
  - Build command: `pnpm --filter @robota-sdk/agent-cli build` exited 0 after package builds for
    `@robota-sdk/agent-sdk` and `@robota-sdk/agent-command-user-local`.
  - Product command exited 0 and printed JSON with:
    - `root:
"/var/folders/78/9lnqy12x2bn8x5c17zmvrsnr0000gn/T/tmp.Kp2lGxRyLa/.robota"`
    - `activeRepositoryRoot:
"/private/var/folders/78/9lnqy12x2bn8x5c17zmvrsnr0000gn/T/tmp.CZ0kZpeuex"`
    - categories: `preferences`, `view-state`, `memory-projections`, `task-associations`,
      `workflow-metadata`, and `inspection-index`
    - every category reported `mayExecuteCommands: false`, `itemCount: 0`, and `items: []`
  - Repository-state command:

    ```bash
    find "$FIXTURE_REPO" -maxdepth 2 -name ".robota" -o -name "robota*"
    ```

    printed no output, confirming no project `.robota` or Robota baseline workflow state was
    created inside the fixture repository.

  - Cleanup executed with `rm -rf "$TMP_HOME" "$FIXTURE_REPO"`.

## Implementation Notes

- The product command may be implemented as a CLI subcommand, but storage semantics must remain in
  SDK/command-owned code.
- If implementation chooses a different final product command, update this backlog before coding and
  keep the scenario equally runnable by the user.

## Result

Implemented with SDK-owned user-local storage projection APIs, a provider-free
`@robota-sdk/agent-command-user-local` command owner, and thin `agent-cli` direct command routing.
