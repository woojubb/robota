---
title: Fix execution loop crash on missing final assistant message
status: completed
priority: high
created: 2026-03-20
packages:
  - agent-core
  - agent-sessions
---

# Fix execution loop crash on missing final assistant message

## Problem

`[EXECUTION] Final assistant message is required` error crashes the session when the execution loop ends without a text-bearing assistant message. Observed in robota CLI session.

## Root Cause (two possibilities)

### 1. Strict validation in buildFinalResult()

`execution-service.ts:398-403` throws if the last assistant message has empty or non-string content. This happens when:

- The model responds with tool calls only (no text) and the loop terminates before a final text response
- Max turn limit reached during tool execution
- API error mid-loop causes early termination

### 2. Context overflow causing API error mid-loop

The more likely root cause: during the tool-calling loop, accumulated history (user message + multiple tool calls + tool results) may exceed the model's context limit. The API call fails silently or returns an incomplete response, and the loop ends without a final assistant message.

**Evidence from logs**: Session was at 61.58% context usage (123154/200000 tokens) when the second message started, but then 20+ tool calls were made in the first round, each adding to the context. By the time of the second round of tool calls, the context may have overflowed.

## Proposed Fixes

### Fix 1: Pre-send context check (proactive compaction)

Before each API call in the execution loop, check if the accumulated history + tool results would exceed the context limit. If so, compact before sending rather than letting the API fail.

This should happen in `execution-round.ts` before `provider.chat()`:

- Estimate tokens for current messages
- If over threshold (e.g., 90%), trigger compaction or truncate tool results before sending

### Fix 2: Graceful degradation in buildFinalResult()

Instead of throwing, return a partial result or a synthesized error message:

- If the last assistant message is tool-call-only, return something like "(response interrupted during tool execution)"
- Log the failure for diagnostics but don't crash the session

### Fix 3: Mid-loop compaction

Add compaction support inside the execution loop itself. If tool results push context past threshold, compact the earlier history while preserving the current tool exchange.

### Fix 4: Error logging and session preservation

Even when execution fails, the session must preserve its state:

- Session history should retain everything up to the point of failure (user message, tool calls, tool results)
- Errors should be logged to a separate error log (not just thrown and lost)
- The session should remain usable after an error — the user can continue the conversation or retry

Currently, when `buildFinalResult()` throws, the error propagates up and the session state may be inconsistent (tool results in history but no assistant response). The fix should catch the error at the Session level, log it, and leave the session in a recoverable state.

## Recommendation

Fix 1 + Fix 2 + Fix 4 together. Fix 1 prevents context overflow, Fix 2 handles it gracefully when prevention fails, Fix 4 ensures errors are logged and sessions remain usable.
