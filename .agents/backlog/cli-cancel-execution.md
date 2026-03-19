# CLI Cancel Execution

## What

Allow the user to cancel an in-progress prompt execution by pressing Esc (or Ctrl+C) during the "Thinking..." state, stopping the current session.run() and returning to the input prompt.

## Why

Long-running agent executions (multi-tool chains, slow API responses) cannot currently be interrupted. The user must wait for completion or kill the process entirely. Claude Code supports interruption mid-execution.

## Scope

- Detect Esc or Ctrl+C keypress during isThinking state in App.tsx
- Abort the in-progress API request (AbortController on provider call)
- Cancel any pending tool executions
- Add partial response to message list (what was received before cancellation)
- Return to input-ready state cleanly (no corrupted conversation history)
- Show cancellation indicator in UI ("Cancelled" message)
