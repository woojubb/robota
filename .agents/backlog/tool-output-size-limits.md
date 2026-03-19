# Tool Output Size Limits

## What

All built-in tools need output size limits to prevent context window overflow. Currently Glob can return 76K+ chars from a single call.

## Issues Found (from session logs)

- `Glob("**/*.{ts,tsx,js,jsx}")` returned 76,556 chars (~19K tokens)
- `Bash("pnpm build")` returned 55,940 chars (~14K tokens)
- `Read("README.md")` returned 15,155 chars (~4K tokens)
- After 2 exchanges, history reached 171K chars (~43K tokens)
- At this rate, 200K token limit exceeded in 3-4 exchanges

## Research Required

Research how Claude Code handles each tool's output limits:

- Glob: max entries, truncation strategy
- Bash: max output chars, truncation with "[output truncated]" message
- Read: max lines (currently 2000), max file size
- How does Claude Code show truncation to the model?

## Scope

### Glob

- Default max entries: 1000 (user can request more with explicit parameter)
- Sort by relevance or mtime
- Truncate with count message: "Showing 1000 of 5432 matches"

### Bash

- Max output chars (e.g., 50K)
- Truncate from middle or end
- Show "[output truncated, showing first/last N chars]"

### Read

- Already has 2000 line limit (good)
- Consider max chars limit too

### All Tools

- General max result size enforced in tool wrapper
- Log warning when truncation occurs
