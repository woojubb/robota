# CLI-BL-017: Context Injection from Task Files

- **Status**: completed
- **Branch**: feat/context-injection-task-files
- **Scope**: packages/agent-sdk

## Context

An agent's effectiveness is limited by its context window and the relevance of the information it holds. In a monorepo, the "current task" is defined in `.agents/tasks/*.md`. For an agent to work efficiently, these task files must be treated as active "Working Memory."

## Objective

Develop a standardized method for injecting relevant task-level metadata (status, objective, constraints) into the agent's context during execution.

## Key Challenges & Questions

1. **Dynamic Context**: How do we ensure the agent always knows which task is currently being addressed in its operational loop?
2. **Filtering**: If there are many tasks, how do we select only the relevant ones to avoid context clutter/noise?
3. **State Synchronization**: When a task's status changes (e.g., from `unknown` to `in-progress`), how does the system reflect this back to the agent immediately?

## Requirements for Completion (Definition of Done)

- [x] A protocol for "Task Loading" where the CLI reads relevant `.md` files and formats them into a structured prompt/context block.
- [x] Implementation of an automated 'Status Update' mechanism that updates the task file when an agent completes an action.
- [x] Definition of how context-injected data interacts with existing `system-reminder` mechanisms.
- [x] Unit tests cover task discovery, task selection, prompt formatting, and deterministic status updates.

## Prior Art Research

- Claude Code treats CLAUDE.md files and auto memory as context loaded at session start, not hard enforcement. It also recommends concise context and debuggability through loaded-file visibility.
- GitHub Copilot supports repository-wide instructions, path-specific instructions, and AGENTS.md. Relevant instruction files are automatically added to requests, and multiple instruction sets may apply with precedence.
- Codex uses AGENTS.md as repository-local instructions. This supports keeping task-context data in Markdown and injecting it as structured context rather than as hidden imperative prompt code.
- Cursor rules are applied to model context when relevant, with rule types that control when a file is included. This supports selecting only a bounded set of relevant task files instead of dumping every backlog item.

## Implementation Direction

- Implement task context loading in `agent-sdk/context`, not in the TUI.
- Load `.agents/tasks/*.md` from the current project only, excluding `README.md` and `completed/`.
- Select a bounded set of active tasks by current git branch match first, then `in-progress`, then `todo`, then unknown status.
- Format selected task metadata as a neutral `## Active Task Context` section containing file path, status, branch, scope, objective, and unchecked completion items.
- Provide a deterministic task-status update utility so callers can synchronize task files without ad hoc string edits.

## Test Plan

- Add unit tests for task file discovery, task selection, and structured prompt formatting.
- Add unit tests for status update behavior using temporary task files and deterministic timestamps.
- Run affected package `test`, `typecheck`, and `build`, then run `pnpm harness:scan`.

## Progress

### 2026-05-02

- Started implementation on `feat/context-injection-task-files`.
- Completed prior-art research from Claude Code memory, GitHub Copilot custom instructions, Codex AGENTS.md, and Cursor rules documentation.
- Added `agent-sdk` task context discovery, parsing, bounded selection, neutral prompt formatting, and deterministic status update helpers.
- Integrated active task context into context loading and system prompt composition as a neutral `## Active Task Context` section.
- Added unit coverage for discovery, parsing, selection, prompt formatting, status updates, context loading, and prompt section placement.
- Fixed pre-push full-suite isolation by preventing cwd-less injected sessions from implicitly writing edit checkpoint state to the repository cwd.
- Verified with targeted tests, full `@robota-sdk/agent-sdk` tests, typecheck, build, lint, `harness:scan`, and affected `harness:verify`.

## Result

`agent-sdk` now loads relevant `.agents/tasks/*.md` metadata into session context without embedding behavioral instructions. The exported task-context utilities provide reusable discovery, selection, formatting, and deterministic task status synchronization for CLI or future orchestration layers.

## Notes

This is critical for maintaining "Focus" in a recursive development environment.
