# CLI `/context` Command — Document Reference List

## Status

Completed.

## Priority

P2 - developer experience and debugging convenience.

## Problem

Many AI coding assistants (Claude Code, etc.) provide a `/context` command that shows which files or documents are currently loaded in the session context. Users can immediately verify "which files am I looking at?" or "did the @reference I just added load correctly?"

agent-cli has no standard command to list or manage currently loaded documents in context.

## Scope

- `packages/agent-cli`
- `packages/agent-sdk` (shared context management API)
- Related command packages

## Research Needed

1. **Existing tool research**
   - Claude Code `/context` behavior: list display, add/remove items, max capacity, auto-eviction policy.
   - Other AI CLI tools (Claude, Copilot CLI, Aider, etc.) context management command patterns.

2. **Current agent-cli context pipeline**
   - When and how settings files, task files, backlog, specs, and rules are loaded.
   - Integration with the `@` file reference feature (separate backlog item).

3. **Feature scope definition**
   - `/context list` — currently loaded document list (file path, size, load time, reference type).
   - `/context add <path>` — manually add a document.
   - `/context remove <path>` — remove a document from context.
   - `/context clear` — reset all.
   - Auto-eviction policy (LRU etc. when token limit is reached).

## Constraints

- agent-cli must remain a thin renderer and host-effect applier.
- Context management state belongs in SDK command packages.
- Token limits and memory usage must be considered.

## Recommended Direction

Provide a `/context` command to list, add, and remove currently loaded documents. Integrate with the `@` file reference feature so that referenced files are automatically added to the list.

## Acceptance Criteria

- `/context` or `/context list` displays the currently loaded document list.
- Each entry includes file path, load type (automatic/manual/@reference), and load time.
- `/context add <path>` allows manual document addition.
- `/context remove <path>` allows document removal.
- Auto-eviction policy based on token limits works correctly.
- Integration with `@` file references so referenced files are auto-registered in the list.
- Unit tests verify command behavior and context state management.

## Verification Plan

- Add unit tests for context state management layer.
- Add `/context` command behavior tests.
- Add `@` reference integration tests.
- Add auto-eviction (token limit) policy tests.
- Add CLI integration tests for actual behavior verification.
