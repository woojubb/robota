---
title: 'Slash Command Autocomplete UI'
status: done
---

# Slash Command Autocomplete UI

## What

When the user types `/` in the input area, show a popup list of available slash commands that can be navigated with arrow keys and selected with Enter.

## Why

This is the foundation for all interactive CLI features. Model selection, settings, skills, and future features all need to be accessible through slash commands. Without autocomplete, users must memorize command names.

## Scope

### Core Autocomplete

- Detect `/` as first character in input
- Show filtered command list above the input area (popup style)
- Filter as user types (e.g., `/mo` shows `/mode`, `/model`)
- Arrow key navigation (up/down)
- Enter to select and insert command
- Esc to dismiss
- Tab to complete partial match

### Command Registry

Extensible registry so new commands can be added without modifying the autocomplete component:

```typescript
interface ISlashCommand {
  name: string; // e.g., "mode"
  description: string; // e.g., "Show or change permission mode"
  subcommands?: string[]; // e.g., ["plan", "default", "acceptEdits"]
  execute: (args: string) => void | Promise<void>;
}
```

### Initial Commands

| Command    | Description        | Subcommands                                   |
| ---------- | ------------------ | --------------------------------------------- |
| `/help`    | Show help          | —                                             |
| `/clear`   | Clear conversation | —                                             |
| `/mode`    | Permission mode    | plan, default, acceptEdits, bypassPermissions |
| `/model`   | Select model       | claude-sonnet-4-6, claude-opus-4-6, ...       |
| `/compact` | Compress context   | —                                             |
| `/cost`    | Session info       | —                                             |
| `/exit`    | Exit CLI           | —                                             |

### Future Extension Points

These will be added later but the autocomplete system must support them:

- `/settings` — Open settings editor
- `/skills` — Browse and invoke skills
- `/agents` — Manage sub-agents
- `/mcp` — Manage MCP servers
- `/permissions` — View/edit permission rules
- `/context` — Show context usage breakdown

### UI Design

```
> /mo
┌─────────────────────────┐
│ /mode    Permission mode │
│ /model   Select AI model │
└─────────────────────────┘
```

- Popup appears above input area
- Currently highlighted item has distinct color
- Description shown next to command name
- Popup dismisses on: Esc, Backspace past `/`, Enter on selection, typing non-matching text

## Implementation Notes

- Use Ink's `useInput` for keyboard handling
- Command registry should be a simple array/map, not a complex plugin system
- Autocomplete component should be independent of command implementations
- Consider ink-select-input or custom implementation for the popup list
