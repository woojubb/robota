# CLI-BL-017: Context Injection from Task Files

## Context

An agent's effectiveness is limited by its context window and the relevance of the information it holds. In a monorepo, the "current task" is defined in `.agents/tasks/*.md`. For an agent to work efficiently, these task files must be treated as active "Working Memory."

## Objective

Develop a standardized method for injecting relevant task-level metadata (status, objective, constraints) into the agent's context during execution.

## Key Challenges & Questions

1. **Dynamic Context**: How do we ensure the agent always knows which task is currently being addressed in its operational loop?
2. **Filtering**: If there are many tasks, how do we select only the relevant ones to avoid context clutter/noise?
3. **State Synchronization**: When a task's status changes (e.g., from `unknown` to `in-progress`), how does the system reflect this back to the agent immediately?

## Requirements for Completion (Definition of Done)

- [ ] A protocol for "Task Loading" where the CLI reads relevant `.md` files and formats them into a structured prompt/context block.
- [ ] Implementation of an automated 'Status Update' mechanism that updates the task file when an agent completes an action.
- [ ] Definition of how context-injected data interacts with existing `system-reminder` mechanisms.

## Test Plan

- Add unit tests for task file discovery, task selection, and structured prompt formatting.
- Add unit tests for status update behavior using temporary task files and deterministic timestamps.
- Run affected package `test`, `typecheck`, and `build`, then run `pnpm harness:scan`.

## Notes

This is critical for maintaining "Focus" in a recursive development environment.
