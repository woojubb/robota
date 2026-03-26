# Print Mode

One-shot CLI usage for scripts and pipelines.

## Basic Usage

```bash
robota -p "List all TypeScript files in src/"
```

Print mode sends the prompt, streams the response to stdout, and exits.

## With Options

```bash
# Use a specific model
robota -p "Explain this project" --model claude-opus-4-6

# Allow all tool execution without prompts
robota -p "Run all tests" --permission-mode bypassPermissions

# Limit agentic turns
robota -p "Find and fix the bug" --max-turns 5
```

## In Shell Scripts

```bash
#!/bin/bash

# Code review pipeline
robota -p "Review the changes in this diff: $(git diff)" \
  --permission-mode plan \
  --model claude-sonnet-4-6

# Generate documentation
robota -p "Generate JSDoc for all exported functions in src/utils.ts" \
  --permission-mode acceptEdits
```

## Piping

```bash
# Pipe input
cat error.log | robota -p "Analyze this error log"

# Capture output
REVIEW=$(robota -p "Summarize the README.md" --permission-mode plan)
echo "$REVIEW"
```

## JSON Output

```bash
# JSON output (structured)
robota -p "Summarize this project" --output-format json

# Stream JSON (real-time events)
robota -p "Explain recursion" --output-format stream-json

# Extract result with jq
robota -p "query" --output-format json | jq -r '.result'
```

## System Prompt

```bash
# Replace system prompt
robota -p "Review this code" --system-prompt "You are a security auditor"

# Append to default system prompt
robota -p "Fix the bug" --append-system-prompt "Focus on error handling"
```

## Exit Codes

```
Exit code 0: Success
Exit code 1: Error
```
