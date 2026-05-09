# Repository Situational Awareness Contract

## Status

Design contract.

This specification defines passive repository context display for Robota clients. The goal is to
show where Robota is operating and what session-known context is available without turning context
display into repository scanning, command discovery, setup inference, or harness scoring.

## Scope

This contract covers display-only context items:

- current `cwd`;
- repository root when a bounded repository-root probe is available;
- current branch when available;
- dirty status summary when available;
- explicitly referenced documents;
- active background workspace context.

It applies to SDK context projections, command modules that expose context/status output, `agent-cli`
TUI surfaces, status bars, and future transports.

## Non-Goals

- Inferring canonical build, test, lint, release, or harness commands.
- Guessing package managers, frameworks, CI mappings, or setup profiles.
- Scoring repository readiness.
- Enumerating visible workspace files.
- Writing repository files, ignored files, manifests, hooks, scripts, or caches.
- Requiring Robota configuration or dependencies inside the user's repository.

## Context Item Model

Every context item must be projected with visible source and bounded display data:

| Field          | Requirement                                                                                       |
| -------------- | ------------------------------------------------------------------------------------------------- |
| `id`           | Stable item id for the current snapshot.                                                          |
| `kind`         | `cwd`, `repo-root`, `git-branch`, `dirty-summary`, `explicit-reference`, or `background-context`. |
| `label`        | Human-readable label suitable for compact UI.                                                     |
| `valueSummary` | Bounded value summary. Dirty state must not enumerate filenames by default.                       |
| `source`       | Provenance source that produced the item.                                                         |
| `capturedAt`   | Capture timestamp when available.                                                                 |
| `actions`      | Display-only actions such as inspect reference or open background detail.                         |

Allowed provenance sources:

| Source                    | Meaning                                                                         |
| ------------------------- | ------------------------------------------------------------------------------- |
| `cwd`                     | The session working directory supplied to the SDK/client.                       |
| `git-state`               | Bounded Git metadata such as root, branch, and dirty summary.                   |
| `active-session-state`    | SDK session state such as context usage or current foreground/background work.  |
| `explicit-user-reference` | Documents explicitly referenced through prompt file references or context APIs. |
| `background-workspace`    | SDK execution workspace entries for background task context.                    |

Context projection must not include raw file contents. Explicit document references may show path,
status, size, and source metadata already recorded by the SDK reference inventory.

## Read Boundary

Passive context display may use only bounded reads:

- session `cwd`;
- bounded Git root/branch/dirty-summary probes through SDK or injected host adapters;
- SDK context-reference inventory for explicit references;
- SDK execution workspace snapshot for background context;
- existing session context-window state.

Passive context display must not:

- walk the workspace tree;
- parse package manifests to infer commands;
- scan CI files;
- inspect dependency lockfiles;
- rank files or commands;
- create setup profiles;
- write repository-local state.

Dirty status must be summarized. A default context row may show counts or coarse states such as
clean, modified, untracked, or conflicted, but it must not list file paths unless the user invokes a
separate explicit Git/status inspection feature.

## Command And Automation Boundary

Repository situational awareness is not an execution source.

Rules:

- Context items may orient the user before they run or accept commands.
- Context items must not execute commands.
- Context items must not become remembered command preferences.
- Context items must not trigger background work, repair loops, review gates, readiness scores, or
  workflow orchestration.
- Any future command suggested from context requires a separate transparent process execution
  contract and explicit user input or accepted assistant suggestion provenance.

## Ownership

| Concern                                                         | Owner             | Rule                                                             |
| --------------------------------------------------------------- | ----------------- | ---------------------------------------------------------------- |
| Context item projection, provenance, bounded read contracts     | `agent-sdk`       | Own reusable read models and negative inference rules.           |
| Git metadata adapters                                           | SDK host adapter  | Provide bounded root/branch/dirty summaries without file walks.  |
| `/context`, `/statusline`, or future status command formatting  | `agent-command-*` | Consume SDK projections and format user-visible output.          |
| TUI panels, status bars, row rendering, and keyboard navigation | `agent-cli`       | Render SDK/command projections only.                             |
| Background workspace context                                    | `agent-sdk`       | Reuse execution workspace snapshots; do not duplicate lifecycle. |

`agent-cli` must not implement package-manager guessing, command discovery, readiness scoring,
workspace enumeration, or repository write policy.

## Existing Capability Notes

The CLI already shows some operational context such as cwd-derived session state, git branch in the
status bar, context-window usage, and background workspace entries. This contract governs future
expansion: new situational awareness surfaces must receive SDK-owned projections instead of adding
new CLI-local repository interpretation.

Existing SDK context loading may read explicit context sources for prompt construction. Passive
situational awareness must not reuse broader context-loading internals to infer package manager,
framework, command, or readiness facts for display.

## Implementation Gates

Before adding a context view or expanding status bars beyond existing fields, implementation PRs
must add:

- SDK projection tests for cwd, repo root, branch, dirty summary, explicit references, and active
  background workspace context;
- provenance tests proving every displayed item includes a source;
- negative tests proving no package-manager guessing, command inference, CI mapping, readiness
  scoring, setup profile generation, or workspace-file enumeration occurs;
- tests proving context display does not create or modify repository files;
- CLI rendering tests after SDK projections exist.

## Relationship To Other Specs

- [transparent-workflow.md](transparent-workflow.md) owns action provenance and UI disclosure.
- [process-execution.md](process-execution.md) owns command execution provenance and forbids
  context items as command sources.
- [background-work-state.md](background-work-state.md) owns active background workspace entries.
- [user-local-memory.md](user-local-memory.md) owns remembered display/navigation preferences, which
  may affect context view defaults but cannot execute commands.
