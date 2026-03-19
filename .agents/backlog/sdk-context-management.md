# Context Management

## What

Add context window management to the SDK — tracking context usage, auto-compaction when approaching limits, and manual compaction commands.

## Why

Long conversations accumulate tool outputs and messages that fill the context window. Without management, the agent hits token limits and fails. Claude Code handles this with auto-compaction and `/compact` command.

## Scope

- Track context usage (token count estimate per message)
- Auto-compaction at threshold (e.g., 95% of context window)
- Compaction strategy: summarize older messages, drop verbose tool outputs
- Manual compaction via slash command (`/compact`)
- Preserve critical context (system prompt, recent messages, user instructions)
- Surface context usage in StatusBar UI
