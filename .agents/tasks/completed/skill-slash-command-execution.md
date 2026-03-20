---
title: Skill discovery and slash command execution
status: completed
priority: high
created: 2026-03-21
packages:
  - agent-cli
---

# Skill Discovery and Slash Command Execution

## Goal

User folder skills (~/.claude/skills/) should be discovered, shown in slash command autocomplete, and executable from the TUI.

## Current State

- SkillCommandSource scans .agents/skills/ and ~/.claude/skills/
- Skills appear in slash autocomplete popup
- But executing a skill slash command sends it as a session prompt ("Use the X skill: ...") — not actual skill content injection

## Desired Behavior

1. Skills discovered from project + user folders
2. Appear in slash autocomplete
3. When selected, read SKILL.md content and inject as context for the session prompt
