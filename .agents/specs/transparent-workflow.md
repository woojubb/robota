# Transparent Workflow Contract

## Status

Design contract.

This specification defines the cross-cutting transparency contract for baseline Robota workflow
features. Implementation is incremental, but package-level work must follow this contract before
adding new TUI surfaces.

## Scope

This contract covers user-impacting workflow state that a client displays or acts on:

- action provenance;
- shell/process/agent task state vocabulary;
- memory and preference inspection;
- UI disclosure;
- boundaries between user-directed execution and advisory analysis;
- repository independence.

It applies to `agent-cli`, SDK clients, command modules, runtime task projections, and future
transport clients that render the same workflow state.

## Non-Goals

- Defining repository-owned harness files, manifests, scripts, hooks, package dependencies, or CI.
- Inferring, ranking, or auto-selecting repository commands.
- Replacing the provider/tool permission system.
- Making `agent-cli` own durable workflow semantics.
- Migrating existing project-local persistence. Storage migration and classification belong to the
  user-local storage foundation backlog.

## Ownership

| Concern                                                                | Owner             | Rule                                                                                            |
| ---------------------------------------------------------------------- | ----------------- | ----------------------------------------------------------------------------------------------- |
| Runtime lifecycle states and transition validation                     | `agent-runtime`   | Own pure task state transitions, terminal detection, cancellation, and close/dismiss mechanics. |
| Action provenance, projections, memory/preference inspection contracts | `agent-sdk`       | Own typed contracts and read models consumed by command modules, transports, and CLIs.          |
| User-visible command behavior                                          | `agent-command-*` | Expose inspection/control commands through SDK common APIs.                                     |
| Terminal presentation                                                  | `agent-cli`       | Render SDK/runtime projections and keep only ephemeral view selection state.                    |

`agent-cli` must not define action provenance, lifecycle state names, memory storage shape,
retention policy, or command execution eligibility.

## Action Provenance

Every user-impacting action or displayed workflow item must have visible provenance. The SDK-owned
provenance contract must distinguish these sources:

| Source                             | May execute commands? | Intended use                                                                                            |
| ---------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------- |
| `user-input`                       | yes                   | Direct prompt, slash command, selected command, pasted command, or explicit user operation.             |
| `accepted-assistant-suggestion`    | yes                   | Assistant-proposed action accepted by explicit approval or the current user-selected permission policy. |
| `active-session-state`             | no                    | Current foreground/background state used for display, navigation, and continuation.                     |
| `user-local-preference`            | no                    | User-local UI preference or remembered view choice used only for display/navigation.                    |
| `explicit-repo-document-reference` | no                    | A repo-owned document explicitly referenced by the user for advisory context.                           |

Execution eligibility is intentionally narrower than display eligibility:

- Shell/process/harness command execution must originate from `user-input` or
  `accepted-assistant-suggestion`.
- User-local preferences and remembered values may affect UI defaults, sorting, view selection, or
  display, but must not execute commands.
- Remembered commands are not a baseline command source. They must not be replayed or suggested as
  executable defaults unless a later explicit feature adds a separate user-confirmed contract.
- Advisory repo analysis may inspect documents or commands only when the user asks for that
  analysis. Baseline CLI operation must not convert advisory findings into hidden automation.

The existing SDK `IExecutionOrigin` is a task/workspace origin projection. It is not sufficient by
itself as command authorization provenance. New transparent workflow APIs must either extend it or
pair it with a typed action provenance record before UI surfaces depend on it.

## State Vocabulary

Workflow clients must use one user-facing state vocabulary:

| State               | Meaning                                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------ |
| `queued`            | Work is registered but not started.                                                                          |
| `running`           | Work is actively executing.                                                                                  |
| `waiting-for-input` | Work is blocked on user input, permission, or a runner-supported send channel.                               |
| `completed`         | Work reached a successful terminal result.                                                                   |
| `failed`            | Work reached an error terminal result.                                                                       |
| `cancelled`         | Work ended by user or policy cancellation.                                                                   |
| `archived`          | Terminal work is no longer default-visible but remains inspectable until deleted or expired by owner policy. |

Valid baseline transitions:

| From                | Event               | To                  |
| ------------------- | ------------------- | ------------------- |
| `queued`            | start               | `running`           |
| `queued`            | cancel              | `cancelled`         |
| `running`           | wait for user input | `waiting-for-input` |
| `running`           | complete            | `completed`         |
| `running`           | fail                | `failed`            |
| `running`           | cancel              | `cancelled`         |
| `waiting-for-input` | resume              | `running`           |
| `waiting-for-input` | fail                | `failed`            |
| `waiting-for-input` | cancel              | `cancelled`         |
| `completed`         | archive             | `archived`          |
| `failed`            | archive             | `archived`          |
| `cancelled`         | archive             | `archived`          |

Terminal execution states are `completed`, `failed`, and `cancelled`. `archived` is a visibility and
retention projection over terminal work; it must not restart work. Selection is not a lifecycle
transition.

Compatibility note: the current runtime task status `waiting_permission` is the mechanical
permission-wait status. SDK/client projections must display it as `waiting-for-input` for this
contract until a future implementation changes or aliases the runtime type under normal API
compatibility rules.

## Memory Transparency

Baseline transparent workflow memory must be inspectable and user-local unless a separate
repo-owned feature explicitly says otherwise.

Inspection projections must include:

- storage root;
- category;
- item summary;
- source;
- scope;
- storage location;
- created time when available;
- last-used time when available;
- whether the item is enabled;
- delete and/or disable action availability.

Robota must not silently convert repeated behavior into a persistent preference. Any future
candidate-capture flow must show the proposed memory item, source, storage location, and effect
before it is enabled.

Existing project memory remains a separate current feature. The user-local storage foundation
backlog must audit and classify current project-local memory, settings, sessions, logs, checkpoints,
and caches before changing storage behavior.

## UI Disclosure

Before or while work is running, clients must be able to show:

- task or command label;
- provenance source;
- working directory;
- environment summary suitable for display without secrets;
- start time;
- timeout and cancellation policy;
- foreground/background mode;
- latest output summary;
- input-needed state;
- cancelability;
- terminal result.

The UI should expose the smallest complete set of facts needed to act confidently. Raw implementation
details may remain hidden, but user-impacting state, actions, and memory must be inspectable.

## Repository Independence

Baseline workflow-client features must not require any Robota file or dependency inside a user's
repository. In particular, they must not require:

- a Robota manifest;
- injected `.agents` or `.robota` files;
- package scripts or package dependencies;
- CI changes;
- repository hooks;
- ignored repository-local caches.

When the user explicitly asks for advisory analysis, Robota may inspect repo-owned files within the
normal session/tool permission model and report recommendations. That analysis must remain advisory
until the user accepts an action.

## Verification Requirements

Implementation PRs that promote this contract into code must add tests before TUI-only rendering:

- type-level or unit tests for accepted action provenance values and execution eligibility;
- runtime state-machine tests for allowed lifecycle transitions and invalid transition rejection;
- SDK projection tests for mapping runtime states into the shared vocabulary;
- memory projection tests for storage root, category, item summary, source, scope, storage location,
  last-used time, and delete/disable capability;
- CLI rendering tests only after SDK/runtime contracts exist.

At least one scenario or fixture must prove baseline behavior works in a repository with no Robota
files and no Robota local state inside the repository.

## Follow-Up Backlogs

- [User-local storage foundation](../backlog/cli-user-local-storage-foundation.md)
- [Transparent process execution](../backlog/cli-transparent-process-execution.md)
- [Background work state management](../backlog/cli-background-work-state-management.md)
- [User-local memory transparency](../backlog/cli-user-local-memory-transparency.md)
- [Repository situational awareness](../backlog/cli-repository-situational-awareness.md)
