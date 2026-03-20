---
title: CLI first-run setup — prompt for API key and create config
status: completed
priority: high
created: 2026-03-21
packages:
  - agent-cli
  - agent-sdk
---

# CLI First-Run Setup

## Goal

When `robota` is run for the first time without configuration, prompt the user for their API key and create a minimal `.robota/settings.json` automatically.

## Current Behavior

CLI crashes with an error when no API key is configured.

## Desired Behavior

1. Check if `.robota/settings.json` exists (project or user global)
2. If not, show a welcome message and prompt for Anthropic API key
3. Create `~/.robota/settings.json` with the key
4. Continue to normal TUI startup

## Config Template

```json
{
  "provider": {
    "name": "anthropic",
    "model": "claude-sonnet-4-6",
    "apiKey": "<user-provided-key>"
  }
}
```
