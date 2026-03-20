---
title: Auto-allow access to config folders (.agents, .claude, .robota)
status: completed
priority: high
created: 2026-03-21
packages:
  - agent-sdk
  - agent-cli
---

# Auto-Allow Access to Config Folders

## Goal

Reading files in `.agents/`, `.claude/`, `.robota/` should not trigger permission prompts. These are config/context folders that the agent needs to read freely.

## Options

1. Add default allow patterns in createSession: `Read(.agents/**)`, `Read(.claude/**)`, `Read(.robota/**)`
2. Path whitelist in settings schema
3. Both — defaults + user-configurable whitelist

## Chosen Approach

Add default allow patterns in createSession() so all CLI/SDK sessions auto-allow reads from these folders.
