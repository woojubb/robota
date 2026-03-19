# Slash Menu Spec

## Status: spec_review

## Goal

Implement slash command autocomplete UI with extensible command registry. This is the foundation for all interactive CLI features.

## Menu Tree

```
/
├── [Built-in Commands]
│   ├── help                          Show available commands
│   ├── clear                         Clear conversation history
│   ├── compact [instructions]        Compress context window
│   ├── cost                          Show session info
│   ├── exit                          Exit CLI
│   │
│   ├── mode                          Permission mode
│   │   ├── plan
│   │   ├── default
│   │   ├── acceptEdits
│   │   └── bypassPermissions
│   │
│   ├── model                         Select AI model
│   │   ├── claude-opus-4-6
│   │   ├── claude-sonnet-4-6
│   │   └── claude-haiku-4-5
│   │
│   ├── permissions                   Permission rules
│   │   ├── show
│   │   ├── allow <pattern>
│   │   └── deny <pattern>
│   │
│   └── context                       Context window info
│
├── [Skills] (dynamically loaded)
│   ├── commit                        ← from skills source
│   ├── review                        ← from skills source
│   ├── tdd                           ← from skills source
│   └── ...
│
└── [Plugin Commands] (dynamically loaded, future)
    ├── plugin
    │   ├── marketplace add <repo>
    │   ├── install <name>
    │   ├── uninstall <name>
    │   └── list
    └── <plugin-provided commands>
```

## Command Registry Architecture

### Command Sources (extensible, not hardcoded)

The slash menu aggregates commands from multiple sources. New sources can be added without modifying the autocomplete component.

```typescript
interface ICommandSource {
  /** Unique identifier for this source */
  name: string;
  /** Load available commands (may be async for filesystem/network) */
  getCommands(): Promise<ISlashCommand[]>;
}
```

### Source Types

| Source             | Location                                   | Loading                | Priority |
| ------------------ | ------------------------------------------ | ---------------------- | -------- |
| Built-in           | Hardcoded in CLI                           | Sync, always available | Highest  |
| Local Skills       | `.agents/skills/*/SKILL.md`                | Scan at session start  | Medium   |
| User Skills        | `~/.robota/skills/` or `~/.claude/skills/` | Scan at session start  | Medium   |
| Plugin Skills      | Installed plugins (local cache)            | Scan at session start  | Medium   |
| Plugin Marketplace | Remote registry                            | On-demand (future)     | Lowest   |

### Skill Discovery

Skills are discovered from multiple directories. Each skill directory contains a `SKILL.md` with frontmatter:

```markdown
---
name: commit
description: Commit changes with conventional format
---
```

Discovery paths (all scanned, merged):

1. `.agents/skills/*/SKILL.md` — project-level skills
2. `~/.robota/skills/*/SKILL.md` — user-level skills
3. `~/.claude/skills/*/SKILL.md` — Claude Code compatible path
4. Plugin-provided skills (from installed plugins)

### Plugin System (future, design now for extensibility)

Plugins provide additional command sources. The architecture must support:

```
/plugin marketplace add rulebased-io/claude-plugin    ← add marketplace
/plugin install rulebased-harness@rulebased           ← install from marketplace
/plugin uninstall rulebased-harness                   ← remove plugin
/plugin list                                          ← show installed
```

Plugin storage: local cache directory (e.g., `~/.robota/plugins/cache/`)

Plugins can provide:

- Additional slash commands
- Skills
- Hooks
- MCP servers
- Custom tools

**Not implementing plugin system now**, but the command registry must accept dynamic sources.

## Command Type Definition

```typescript
interface ISlashCommand {
  /** Command name without slash (e.g., "mode") */
  name: string;
  /** Short description shown in autocomplete */
  description: string;
  /** Source identifier (e.g., "builtin", "skill:commit", "plugin:harness") */
  source: string;
  /** Subcommands (for hierarchical menus) */
  subcommands?: ISlashCommand[];
  /** Execute the command. Args is everything after the command name. */
  execute: (args: string) => void | Promise<void>;
}
```

## Autocomplete UI Behavior

### Trigger

- `/` as first character in input triggers autocomplete popup

### Popup Display

```
> /mo
┌─────────────────────────────────────┐
│ ▸ /mode      Permission mode        │
│   /model     Select AI model        │
└─────────────────────────────────────┘
```

### Interaction

- **Arrow ↑↓**: Navigate items
- **Enter**: Select highlighted item (inserts command, executes if no args needed)
- **Tab**: Complete to common prefix
- **Esc**: Dismiss popup, keep typed text
- **Backspace past `/`**: Dismiss popup
- **Typing**: Filter list in real-time

### Subcommand Navigation

When a command with subcommands is selected:

```
> /mode
┌─────────────────────────────────────┐
│ ▸ plan                              │
│   default                           │
│   acceptEdits                       │
│   bypassPermissions                 │
└─────────────────────────────────────┘
```

### Visual Grouping

Commands are grouped by source with subtle separators:

```
> /
┌─────────────────────────────────────┐
│   /help      Show help              │
│   /clear     Clear history          │
│   /mode      Permission mode        │
│   /model     Select model           │
│   /compact   Compress context       │
│ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─  │
│   /commit    Commit changes         │
│   /review    Code review            │
│   /tdd       TDD cycle             │
└─────────────────────────────────────┘
```

## Implementation Plan

### Phase 1: Core Autocomplete (this branch)

- [ ] `ISlashCommand` and `ICommandSource` types
- [ ] Built-in command source (hardcoded commands)
- [ ] `SlashAutocomplete` Ink component (popup, filtering, navigation)
- [ ] Wire into `InputArea` — detect `/` and show popup
- [ ] Subcommand navigation for /mode and /model

### Phase 2: Skill Discovery

- [ ] Skill command source (scan `.agents/skills/`)
- [ ] User skill source (scan `~/.robota/skills/`)
- [ ] Dynamic loading at session start

### Phase 3: Plugin System (future)

- [ ] Plugin marketplace commands
- [ ] Plugin install/uninstall
- [ ] Plugin-provided command sources

## Files to Create/Modify

### New Files

- `packages/agent-cli/src/ui/SlashAutocomplete.tsx` — popup component
- `packages/agent-cli/src/commands/types.ts` — ISlashCommand, ICommandSource
- `packages/agent-cli/src/commands/builtin-source.ts` — built-in commands
- `packages/agent-cli/src/commands/skill-source.ts` — skill discovery (Phase 2)

### Modified Files

- `packages/agent-cli/src/ui/InputArea.tsx` — detect `/`, show autocomplete
- `packages/agent-cli/src/ui/App.tsx` — pass command registry, handle execution
