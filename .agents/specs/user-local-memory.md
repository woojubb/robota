# User-Local Memory Transparency Contract

## Status

Design contract.

This specification defines inspectable user-local memory and preference behavior for baseline
Robota workflow assistance. It builds on [user-local-storage.md](user-local-storage.md), which owns
the storage root, category layout, repo-outside validation, and generic inspection projection.

## Scope

This contract covers user-local remembered state that may help display and navigation:

- last visible cwd or workspace context for display only;
- TUI view preferences;
- last selected background entry or panel;
- session-local task associations;
- local display preferences;
- user choices about whether a remembered item is enabled, disabled, or deleted.

It applies to SDK storage contracts, command modules that expose inspection/removal, `agent-cli`
surfaces that render remembered values, and future transports that present the same state.

## Non-Goals

- Persisting command strings as reusable preferences.
- Executing commands from remembered values, command history, session recall, or local memory.
- Inferring repository harness behavior from repeated user actions.
- Writing baseline memory into tracked files, ignored files, project `.robota/`, or repository
  caches.
- Defining a team-shared workflow format.
- Migrating every existing project memory or session artifact in this contract PR.

## Allowed Baseline Memory

Allowed remembered values must affect display or navigation only:

| Memory kind            | Example use                                                     | May execute commands? |
| ---------------------- | --------------------------------------------------------------- | --------------------- |
| `view-preference`      | Open the same panel, filter, density, or sorting choice.        | no                    |
| `last-visible-cwd`     | Display or preselect a workspace context already in session.    | no                    |
| `background-selection` | Restore the last selected background entry in a local session.  | no                    |
| `task-association`     | Associate a session-local task id with a user-visible grouping. | no                    |
| `display-preference`   | Remember text wrapping, compactness, or visibility preferences. | no                    |
| `inspection-choice`    | Remember disabled or hidden user-local items for inspection.    | no                    |

Remembered cwd or view state must not become the execution cwd for a new process by itself. Process
execution still requires current user input or accepted assistant suggestion provenance.

## Restricted Memory

The baseline memory contract forbids:

- remembered shell commands;
- inferred build, test, lint, release, or harness commands;
- package manager guesses;
- provider/tool permission decisions;
- approval or denial decisions for future side effects;
- hidden automatic conversion of repeated behavior into preferences;
- correctness judgments derived from command output;
- repair-loop, review-gate, or workflow readiness decisions.

If a future feature wants one of these behaviors, it needs a separate spec, explicit user consent
contract, and tests proving it does not bypass transparent workflow provenance.

## Memory Item Model

The SDK-owned memory item projection extends the user-local storage inspection projection with
display/navigation disclosure:

| Field                    | Requirement                                                                |
| ------------------------ | -------------------------------------------------------------------------- |
| `category`               | Stable user-local category such as `preferences` or `view-state`.          |
| `key`                    | Stable item key within the category.                                       |
| `summary`                | Bounded human-readable item summary.                                       |
| `valueSummary`           | Bounded non-secret value description.                                      |
| `source`                 | Provenance source that created or last changed the item.                   |
| `scope`                  | User, session, repo identity, or workspace identity scope.                 |
| `storageLocation`        | Concrete path or opaque user-local location.                               |
| `createdAt`              | Creation timestamp when available.                                         |
| `lastUsedAt`             | Last display/navigation use timestamp when available.                      |
| `enabled`                | Whether the item may currently affect display/navigation.                  |
| `displayNavigationRule`  | Plain rule describing where the remembered value may affect the UI.        |
| `commandExecutionEffect` | Always `none` for baseline user-local memory.                              |
| `deleteAvailable`        | Whether an explicit delete action is available.                            |
| `disableAvailable`       | Whether an explicit disable action is available without deleting the item. |

The projection must not include secrets or full transcript content. When a value cannot be displayed
safely, the SDK must provide a bounded summary and storage location rather than raw content.

## Inspection And Removal

SDK and command APIs must support:

- listing user-local memory categories and item summaries;
- inspecting one remembered item with storage location, source, scope, timestamps, enabled state,
  and display/navigation rule;
- deleting an item when `deleteAvailable` is true;
- disabling an item when `disableAvailable` is true;
- showing disabled items in inspection output;
- proving disabled items do not affect display/navigation until explicitly re-enabled by a future
  contract.

Delete and disable are explicit user actions. Rendering a panel, selecting a task, or starting a
new session must not silently delete, disable, or create remembered items.

## Existing Project Memory Relationship

Existing `.robota/memory/` project memory is an explicit project memory feature owned by
`agent-sdk/memory/` and exposed through `@robota-sdk/agent-command-memory`. It is not the baseline
user-local memory feature defined here.

Rules:

- Existing project memory may remain project-local until a separate migration PR changes it.
- New baseline local preferences and remembered workflow state must not write to `.robota/memory/`.
- Project memory content may be model-visible only through the existing explicit memory command and
  prompt composition contracts.
- User-local memory items must not be injected as command suggestions or hidden prompt behavior.
- Migration or mirroring between project memory and user-local memory requires explicit user action,
  storage disclosure, and tests.

## Ownership

| Concern                                                                | Owner              | Rule                                                      |
| ---------------------------------------------------------------------- | ------------------ | --------------------------------------------------------- |
| User-local memory item shapes, categories, inspection, delete, disable | `agent-sdk`        | Own reusable contracts and repo-outside storage policy.   |
| Session-local task ids and background ids used as association inputs   | `agent-runtime`    | Expose ids and state only; do not persist user memory.    |
| `/memory` and future preference/memory inspection command behavior     | `agent-command-*`  | Consume SDK APIs and format command output.               |
| TUI panels, command routing, and display of remembered values          | `agent-cli`        | Render SDK/command projections only.                      |
| Concrete storage root and path validation                              | user-local storage | Must remain user-local and outside the active repository. |

`agent-cli` must not assemble storage paths, infer remembered items from repeated behavior, execute
remembered commands, or mutate memory outside SDK/command APIs.

## Implementation Gates

Before a TUI screen or command writes baseline user-local memory, implementation PRs must add:

- SDK tests for the memory item projection fields;
- SDK tests for delete, disable, and disabled-item non-use;
- negative tests for repository-local, ignored-file, and project `.robota/` writes;
- negative tests proving remembered commands, session recall, and command history cannot execute
  commands;
- tests proving repeated behavior does not silently become a persistent preference;
- CLI rendering tests for storage location, source, last-used time, display/navigation rule, and
  delete/disable actions after SDK contracts exist.

## Relationship To Other Specs

- [transparent-workflow.md](transparent-workflow.md) owns action provenance and the rule that
  user-local preferences cannot execute commands.
- [user-local-storage.md](user-local-storage.md) owns the canonical `~/.robota` root, categories,
  inspection fields, and repo-outside validation.
- [background-work-state.md](background-work-state.md) owns switchable background entry state that
  may reference user-local view preferences without becoming lifecycle state.
- [process-execution.md](process-execution.md) owns command execution provenance and forbids
  remembered values as command sources.
- [repository-situational-awareness.md](repository-situational-awareness.md) owns passive context
  display that may use remembered view preferences only for display/navigation defaults.
