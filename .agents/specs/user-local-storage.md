# User-Local Storage Foundation

## Status

Design contract.

This specification defines the storage policy for baseline transparent workflow state. It does not
change existing storage behavior by itself; implementation PRs must add SDK contracts and tests
before any TUI feature depends on this policy.

## Scope

This policy applies to baseline workflow state that Robota stores for local assistance:

- UI and view preferences;
- display/navigation choices;
- local memory item projections;
- background task associations;
- transparent workflow metadata;
- inspection indexes and delete/disable projections.

It does not make user repositories depend on Robota. User repositories must remain usable with no
Robota files, package dependencies, hooks, scripts, manifests, or ignored local caches.

## Non-Goals

- Moving every existing `.robota` use in this PR.
- Storing repository harness definitions.
- Storing command history as reusable execution preferences.
- Defining plugin, skill, agent-definition, session replay, or checkpoint semantics.
- Replacing explicit project-owned configuration and debugging artifacts without a migration PR.

## Canonical Storage Rule

Baseline workflow state has exactly one allowed persistent storage class:

```text
user-local storage outside the active repository
```

The canonical product root is `~/.robota`. SDK APIs may later introduce a sub-root for workflow
state such as `~/.robota/workflow/`, but all baseline workflow state must remain under the resolved
user-local root and outside the active repository.

Rules:

- No tracked repository file may store baseline workflow state.
- No ignored repository file may store baseline workflow state.
- No project `.robota/` cache may store baseline workflow state.
- No workspace-local fallback is allowed when user-local storage is unavailable.
- Persistence must fail closed or operate in non-persistent mode when the SDK cannot prove the
  target path is outside the repository.

Test environments may inject a temporary user-local root, but production behavior must not silently
fall back to the project tree.

## Category Layout

The SDK-owned storage contract must use stable category identifiers. The first implementation may
choose exact filenames, but the categories below are the required logical layout:

| Category             | Purpose                                                                | May execute commands? |
| -------------------- | ---------------------------------------------------------------------- | --------------------- |
| `preferences`        | User-local UI/display preferences.                                     | no                    |
| `view-state`         | Last selected panels, filters, and navigation state.                   | no                    |
| `memory-projections` | Inspectable local memory item projections and user choices.            | no                    |
| `task-associations`  | User-local associations between sessions, tasks, and background items. | no                    |
| `workflow-metadata`  | Transparent workflow metadata that is not repo-owned.                  | no                    |
| `inspection-index`   | Category/item summaries for user inspection and deletion.              | no                    |

Command strings must not be stored as reusable execution preferences in any category. Session logs
may contain historical command text as transcript data, but transcript history is not a baseline
command source.

## Repo-Outside Validation

SDK storage APIs must validate persistent baseline workflow paths before writing:

1. Resolve the active repository/workspace root.
2. Resolve the candidate storage root to an absolute normalized path.
3. Resolve symlinks when the path or parent exists.
4. Reject the candidate when it is equal to or inside the active repository root.
5. Reject relative paths, empty roots, and roots that cannot be proven outside the repository.

This validation belongs in `agent-sdk` or a lower reusable owner. `agent-cli` must not duplicate it.

## Inspection Projection

Every persisted baseline workflow item must be inspectable through SDK/command APIs. The projection
must include:

| Field              | Meaning                                                                   |
| ------------------ | ------------------------------------------------------------------------- |
| `root`             | Effective user-local storage root.                                        |
| `category`         | Stable category identifier.                                               |
| `key`              | Stable item key within the category.                                      |
| `summary`          | Bounded human-readable item summary.                                      |
| `source`           | Provenance source that created or last changed the item.                  |
| `scope`            | Applicability scope, such as global user scope or a repo identity string. |
| `storageLocation`  | Concrete path or opaque user-local location.                              |
| `createdAt`        | Creation timestamp when available.                                        |
| `lastUsedAt`       | Last use timestamp when available.                                        |
| `enabled`          | Whether the item currently affects behavior.                              |
| `deleteAvailable`  | Whether the item can be removed.                                          |
| `disableAvailable` | Whether the item can be disabled without deletion.                        |

Delete and disable actions must be explicit user actions. Robota must not silently remove or disable
stored state as part of normal rendering.

## Existing Storage Audit

Current storage usage is classified below. This audit prevents new baseline workflow features from
copying legacy/project-local behavior by accident.

| Storage                                                   | Current owner/use                                           | Classification                                               | Required follow-up                                                                                                                            |
| --------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `~/.robota/settings.json`                                 | User settings and provider profiles.                        | User-local existing.                                         | May be read by settings commands; new workflow preference categories should use the SDK user-local storage contract instead of ad hoc fields. |
| `~/.robota/update-check.json`                             | CLI package update cache.                                   | CLI operational cache, not workflow state.                   | Keep CLI-owned; do not reuse for workflow state.                                                                                              |
| `~/.robota/plugins/`                                      | User-installed bundle plugins.                              | User-owned extension storage.                                | Not baseline workflow state.                                                                                                                  |
| `~/.robota/skills/`                                       | User-global skills.                                         | User-owned extension storage.                                | Not baseline workflow state.                                                                                                                  |
| `~/.robota/agents/`                                       | User-global agent definitions.                              | User-owned extension storage.                                | Not baseline workflow state.                                                                                                                  |
| `.robota/settings.json` and `.robota/settings.local.json` | Project and project-local configuration layers.             | Explicit project configuration, not baseline workflow state. | Do not store baseline preferences or workflow metadata here.                                                                                  |
| `.robota/sessions/`                                       | Project-local session records for resume/debugging.         | Existing explicit project debugging state.                   | Do not use as baseline workflow memory; migration or user-local mirror needs a separate implementation PR.                                    |
| `.robota/logs/`                                           | Project-local JSONL logs and subagent transcripts.          | Existing explicit project debugging state.                   | Do not use as baseline workflow memory; retention/inspection policy needs a separate PR if reused.                                            |
| `.robota/memory/`                                         | Project memory index, topics, and pending candidates.       | Migration-required for user-local baseline memory.           | Audit and migrate only through the user-local memory transparency backlog.                                                                    |
| `.robota/checkpoints/`                                    | Edit checkpoint pre-images for rewind.                      | Project safety artifact.                                     | Keep separate from baseline workflow state; migration is not part of this policy.                                                             |
| `.robota/agents/`                                         | Project agent definitions.                                  | Project-owned extension definitions.                         | Not baseline workflow state.                                                                                                                  |
| `.robota/plugins/`                                        | Project plugin installation/enablement.                     | Project-owned extension storage.                             | Not baseline workflow state; do not use for workflow preferences.                                                                             |
| `.robota/worktrees/`                                      | Local isolation/worktree artifacts when enabled.            | Runtime isolation artifact, not baseline workflow state.     | Keep out of baseline storage; future isolation policy owns changes.                                                                           |
| `.agents/**`                                              | Repo-owned instructions, tasks, skills, backlog, and rules. | Repository-owned source documents.                           | Read only through explicit context/skill/task contracts; never use as baseline storage.                                                       |

## Ownership

| Concern                                | Owner                                 | Rule                                                                             |
| -------------------------------------- | ------------------------------------- | -------------------------------------------------------------------------------- |
| User-local root resolution             | `agent-sdk`                           | Resolve and validate the effective user-local root.                              |
| Repo-outside validation                | `agent-sdk`                           | Reject baseline workflow paths inside the active repository.                     |
| Category and item projection contracts | `agent-sdk`                           | Define stable category ids and inspect/delete/disable shapes.                    |
| Session-local runtime associations     | `agent-runtime` through SDK contracts | Runtime may expose session-local ids; SDK decides persistence shape.             |
| User-visible commands                  | `agent-command-*`                     | Expose storage inspection/removal using SDK command APIs.                        |
| TUI rendering                          | `agent-cli`                           | Render roots, categories, item summaries, and actions from SDK projections only. |

## Implementation Gates

Before a TUI screen or command stores baseline workflow state, implementation PRs must add:

- SDK unit tests for user-local root resolution;
- negative tests for repo-local, ignored-file, and project `.robota` roots;
- contract tests for category projection fields;
- delete/disable behavior tests;
- tests proving stored commands cannot be reused as execution preferences;
- at least one fixture repository with no Robota files and no baseline storage written inside it.

## Relationship To Transparent Workflow

This storage policy implements the memory transparency and repo-independence requirements in
[transparent-workflow.md](transparent-workflow.md). Transparent workflow features may display
repository context, but their baseline stored state must use this user-local storage foundation.
