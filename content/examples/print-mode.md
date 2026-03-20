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
