# User-Local Memory Inspection Implementation

## Status

Completed.

## Created

2026-05-09

## Priority

P0 - implementation of inspectable user-local memory and preference transparency.

## Request

Implement the user-local memory inspection, deletion, and disablement behavior defined by
[user-local-memory.md](../../specs/user-local-memory.md), using the storage foundation from
[user-local-storage.md](../../specs/user-local-storage.md).

This backlog implements the follow-up work deferred by
[User-Local Memory Transparency](cli-user-local-memory-transparency.md).

## Recommendation Gate

Recommended approach:

- Depend on the user-local storage implementation backlog first.
- Implement SDK-owned memory item projections, explicit create/update hooks for allowed
  display/navigation preferences, delete behavior, disable behavior, and disabled-item non-use.
- Expose provider-free product commands through CLI routing and command-owned behavior:
  - `robota user-local memory set ...`
  - `robota user-local memory list --format json`
  - `robota user-local memory inspect <category> <key> --format json`
  - `robota user-local memory disable <category> <key>`
  - `robota user-local memory delete <category> <key>`
- Keep command execution effect fixed to `none` for baseline user-local memory.

Why this matches the backlog intent:

- The user can see exactly what Robota remembered, where it is stored, what it can affect, and how
  to remove or disable it.
- Remembered state remains display/navigation-only and cannot become hidden command automation.
- User repositories remain independent because storage is user-local and repo-outside validated.

Affected scope:

- `packages/agent-sdk`: memory item projection, persistence facade, delete/disable semantics,
  disabled-item non-use.
- `@robota-sdk/agent-command-user-local`: user-visible command behavior and output formatting.
- `packages/agent-cli`: provider-free command routing and terminal output only.
- `packages/agent-sessions` only if session-local ids need to be referenced in projections.

Decision:

- Use `@robota-sdk/agent-command-user-local` rather than `@robota-sdk/agent-command-memory`.
  Rationale: existing `/memory` is explicit project memory under `.robota/memory`, while this
  backlog implements baseline user-local display/navigation memory under the SDK user-local storage
  contract.
- Delete followed by inspect exits non-zero with `User-local memory item not found.`. Rationale:
  the absence is script-detectable and user-readable.

## Acceptance Criteria

- [x] Users can create or seed an allowed display/navigation memory item through an explicit product
      command for inspection/testing.
- [x] Users can list remembered user-local items with category, key, summary, scope, source,
      storage location, enabled state, last-used time, and display/navigation rule.
- [x] Users can inspect a single remembered item and see `commandExecutionEffect: "none"`.
- [x] Users can disable a remembered item without deleting it.
- [x] Disabled remembered items remain visible in inspection output and do not affect
      display/navigation.
- [x] Users can delete a remembered item.
- [x] No command strings are stored or exposed as reusable execution preferences.
- [x] No baseline user-local memory is written inside the active repository, including `.robota/`.
- [x] The backlog is updated with User Execution Test Scenario evidence after implementation.

## Test Plan

- Add SDK contract tests for memory item projection fields.
- Add SDK tests for create/list/inspect/delete/disable behavior.
- Add negative tests proving disabled items are not used for display/navigation defaults.
- Add negative tests proving command strings, command history, session recall, and remembered values
  cannot execute commands.
- Add repo-outside storage tests using a fixture repository with no Robota files.
- Add command-package tests for output shape and error messages.
- Add CLI routing tests proving the commands are provider-free.
- Run `pnpm harness:scan`.

## User Execution Test Scenarios

### Scenario: Inspect And Disable A User-Local View Preference

- Prerequisites:
  - The user-local storage inspection implementation is complete.
  - The implementation must build `packages/agent-cli/dist/node/bin.js`.
  - The implementation must provide provider-free product commands for user-local memory set, list,
    inspect, disable, and delete.
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
    HOME="$TMP_HOME" node "$ROBOTA_REPO/packages/agent-cli/dist/node/bin.js" user-local memory set view-preference last-panel background --summary "Open the background panel" --source user-input
    HOME="$TMP_HOME" node "$ROBOTA_REPO/packages/agent-cli/dist/node/bin.js" user-local memory list --format json
    HOME="$TMP_HOME" node "$ROBOTA_REPO/packages/agent-cli/dist/node/bin.js" user-local memory inspect view-preference last-panel --format json
    HOME="$TMP_HOME" node "$ROBOTA_REPO/packages/agent-cli/dist/node/bin.js" user-local memory disable view-preference last-panel
    HOME="$TMP_HOME" node "$ROBOTA_REPO/packages/agent-cli/dist/node/bin.js" user-local memory inspect view-preference last-panel --format json
  )
  find "$FIXTURE_REPO" -maxdepth 2 -name ".robota" -o -name "robota*"
  ```

- Expected observable result:
  - `memory set` exits 0 and reports that `view-preference/last-panel` was stored under user-local
    storage.
  - `memory list --format json` exits 0 and includes an item with category `view-preference`, key
    `last-panel`, source `user-input`, and storage location under `$TMP_HOME/.robota`.
  - The first `memory inspect` exits 0 and shows `enabled: true`,
    `displayNavigationRule` describing panel display/navigation only, and
    `commandExecutionEffect: "none"`.
  - `memory disable` exits 0 and reports that the item was disabled.
  - The second `memory inspect` exits 0 and shows `enabled: false` while still showing the item.
  - The `find` command prints no project `.robota` or Robota baseline workflow state inside
    `$FIXTURE_REPO`.
- Cleanup/reset:

  ```bash
  rm -rf "$TMP_HOME" "$FIXTURE_REPO"
  ```

- Agent verification: Must be executed after implementation using the commands above.
- Evidence:
  - Executed after implementation from `/Users/jungyoun/Documents/dev/robota` against the built CLI.
  - Product command sequence exited 0 through `set`, `list`, first `inspect`, `disable`, and second
    `inspect`.
  - `memory set` printed:
    `Stored user-local memory item view-preference/last-panel at /var/folders/78/9lnqy12x2bn8x5c17zmvrsnr0000gn/T/tmp.yb5Ivc89JG/.robota/memory-projections/view-preference__last-panel.json`
  - `memory list --format json` printed `root:
"/var/folders/78/9lnqy12x2bn8x5c17zmvrsnr0000gn/T/tmp.yb5Ivc89JG/.robota"` and one item with
    category `view-preference`, key `last-panel`, summary `Open the background panel`, valueSummary
    `background`, source `user-input`, scope `user`, enabled `true`, displayNavigationRule
    `May affect UI panel, filter, density, or sorting display/navigation only.`, and
    `commandExecutionEffect: "none"`.
  - The first `memory inspect` printed the same item with `enabled: true`.
  - `memory disable` printed: `Disabled user-local memory item view-preference/last-panel`.
  - The second `memory inspect` printed the same item with `enabled: false` and
    `commandExecutionEffect: "none"`.
  - Repository-state command:

    ```bash
    find "$FIXTURE_REPO" -maxdepth 2 \( -name ".robota" -o -name "robota*" \) -print
    ```

    printed no output, confirming no project `.robota` or Robota baseline workflow state was
    created inside the fixture repository.

### Scenario: Delete A User-Local Memory Item

- Prerequisites: Run after the first scenario setup or recreate the same `TMP_HOME` and
  `FIXTURE_REPO` setup.
- User actions:

  ```bash
  (
    cd "$FIXTURE_REPO"
    HOME="$TMP_HOME" node "$ROBOTA_REPO/packages/agent-cli/dist/node/bin.js" user-local memory delete view-preference last-panel
    HOME="$TMP_HOME" node "$ROBOTA_REPO/packages/agent-cli/dist/node/bin.js" user-local memory inspect view-preference last-panel --format json
  )
  ```

- Expected observable result:
  - `memory delete` exits 0 and reports that `view-preference/last-panel` was deleted.
  - The follow-up `memory inspect` exits non-zero with `User-local memory item not found.`.
- Cleanup/reset:

  ```bash
  rm -rf "$TMP_HOME" "$FIXTURE_REPO"
  ```

- Agent verification: Must be executed after implementation.
- Evidence:
  - Executed after the first scenario using the same `TMP_HOME` and `FIXTURE_REPO`.
  - `memory delete` exited 0 and printed:
    `Deleted user-local memory item view-preference/last-panel`.
  - Follow-up `memory inspect view-preference last-panel --format json` exited non-zero with status
    `1` and printed: `User-local memory item not found.`
  - Cleanup executed with `rm -rf "$TMP_HOME" "$FIXTURE_REPO"`.

## Result

Implemented with SDK-owned user-local memory APIs, provider-free
`@robota-sdk/agent-command-user-local` memory subcommands, thin `agent-cli` direct routing, and
captured User Execution Test Scenario evidence.

## Implementation Notes

- The `memory set` command in this backlog is for explicit user-created display/navigation memory.
  It must not infer preferences from repeated behavior.
- If implementation chooses a different final product command, update this backlog before coding and
  keep the scenario equally runnable by the user.
