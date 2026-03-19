# Context Management

## What

Add context window management to the SDK — tracking context usage, auto-compaction when approaching limits, and manual compaction commands.

## Why

Long conversations accumulate tool outputs and messages that fill the context window. Without management, the agent hits token limits and fails. Claude Code handles this with auto-compaction and `/compact` command.

## Scope

- Query model's max context window size (varies by model: 200k, 1M, etc.)
- Track context usage (token count estimate per message)
- Auto-compaction at threshold (e.g., 95% of context window)
- Compaction strategy: summarize older messages, drop verbose tool outputs
- Manual compaction via slash command (`/compact`)
- Preserve critical context (system prompt, recent messages, user instructions)
- Surface context usage in StatusBar UI

## Context Compression

When conversation history exceeds the model's context limit, automatic compression must be performed:

- Detect when total tokens approach model-specific max context size
- Compress by: summarizing old conversation turns into a condensed summary, removing raw tool outputs (keep result summaries), collapsing repeated tool calls
- The compression itself uses an LLM call to generate the summary
- Compressed messages replace the originals in history (irreversible within session)
- User should be notified when compression occurs ("Context compressed: N messages → summary")
