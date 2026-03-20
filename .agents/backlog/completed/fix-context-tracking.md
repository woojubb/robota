# Fix Context Window Tracking

## What

`session.getContextState()` always returns `usedTokens: 0, usedPercentage: 0%`. The token tracking is broken, which means auto-compaction never triggers.

## Root Cause

`updateTokenUsageFromHistory()` reads token usage from message metadata, but the Anthropic provider's response metadata may not be in the expected format, or agent-core's execution loop doesn't propagate usage data to the conversation history messages.

## Impact

- StatusBar always shows "Context: 0%"
- Auto-compaction (83.5% threshold) never triggers
- Users hit 200K token limit without warning

## Fix Required

1. Verify what metadata `AnthropicProvider.chat()` returns (inputTokens, outputTokens)
2. Verify how agent-core's execution-round stores metadata in assistant messages
3. Fix `updateTokenUsageFromHistory()` to read the correct fields
4. Alternative: estimate tokens from character count (chars / 4) if API metadata unavailable
