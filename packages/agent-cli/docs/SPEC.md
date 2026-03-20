# SPEC.md — @robota-sdk/agent-cli

## Scope

Interactive terminal AI coding assistant. A React + Ink-based TUI, corresponding to Claude Code.
A **thin CLI layer** built on top of agent-sdk, responsible only for the terminal UI.

## Boundaries

- Does NOT own Session/SessionStore — imported from `@robota-sdk/agent-sessions`
- Does NOT own tools — imported from `@robota-sdk/agent-tools`
- Does NOT own permissions/hooks — imported from `@robota-sdk/agent-core`
- Does NOT own config/context loading — imported from `@robota-sdk/agent-sdk`
- Does NOT own AI provider — imported from `@robota-sdk/agent-provider-anthropic`
- Does NOT own ITerminalOutput/ISpinner — SSOT is `@robota-sdk/agent-sessions` (permission-enforcer.ts). agent-cli has a local duplicate in `src/types.ts` that should eventually import from agent-sessions.
- OWNS: Ink TUI components, permission-prompt (terminal UI), CLI argument parsing, slash command registry

## Architecture

```
bin.ts → cli.ts (arg parsing)
              └── ui/render.tsx → App.tsx (Ink TUI)
                    ├── MessageList.tsx        (conversation list)
                    ├── InputArea.tsx          (bottom input area, slash detection)
                    ├── StatusBar.tsx          (status bar)
                    ├── PermissionPrompt.tsx   (arrow-key selection)
                    ├── SlashAutocomplete.tsx  (command popup with scroll)
                    ├── CommandRegistry        (aggregates command sources)
                    │   ├── BuiltinCommandSource  (9 built-in commands)
                    │   └── SkillCommandSource    (discovered from .agents/skills/)
                    └── Session (from @robota-sdk/agent-sessions)
```

Dependency chain:

```
agent-cli ─→ agent-sdk ─→ agent-sessions ─→ agent-core
  │            ├─→ agent-tools ────────────→ agent-core
  │            └─→ agent-provider-anthropic → agent-core
  └──────────────────────────────────────→ agent-core  (direct: types only)
```

## StatusBar Display

The StatusBar shows real-time session information:

```
┌──────────────────────────────────────────────────────────┐
│ Mode: default  |  Model: claude-sonnet-4-6  |  Context: 45%  |  msgs: 12 │
└──────────────────────────────────────────────────────────┘
```

| Field    | Source                                     | Description                            |
| -------- | ------------------------------------------ | -------------------------------------- |
| Mode     | `session.getPermissionMode()`              | Current permission mode                |
| Model    | `config.provider.model`                    | Active AI model name                   |
| Context  | `session.getContextState().usedPercentage` | Context window usage with color coding |
| msgs     | message count                              | Number of messages in conversation     |
| Thinking | isThinking state                           | Shown during `session.run()` execution |

### Context Color Coding

| Range  | Color  | Meaning                         |
| ------ | ------ | ------------------------------- |
| 0-69%  | Green  | Healthy                         |
| 70-89% | Yellow | Approaching limit               |
| 90%+   | Red    | Near limit, compaction imminent |

## Context Management (CLI Layer)

### `/compact` Slash Command

```
/compact                          # Default compaction
/compact focus on API changes     # Custom focus instructions
```

- Calls `session.compact(instructions)`
- Displays before/after context percentage
- Shows "Context compressed: 85% → 32%" message

### Auto-Compaction Notification

When auto-compaction triggers (at ~83.5% threshold), the UI shows a system message notifying the user.

## Slash Commands

| Command                   | Description                 |
| ------------------------- | --------------------------- |
| `/help`                   | Show available commands     |
| `/clear`                  | Clear conversation history  |
| `/mode [mode]`            | Show/change permission mode |
| `/model [model]`          | Select AI model             |
| `/compact [instructions]` | Compress context window     |
| `/cost`                   | Show session info           |
| `/context`                | Context window info         |
| `/permissions`            | Permission rules            |
| `/exit`                   | Exit CLI                    |

### Slash Command Autocomplete

Typing `/` as the first character in the input triggers an autocomplete popup. The popup filters commands in real-time as the user types.

**Interaction:**

- Arrow Up/Down: Navigate items
- Enter: Select highlighted item (inserts command, executes if no args needed)
- Tab: Complete to common prefix
- Esc: Dismiss popup, keep typed text
- Backspace past `/`: Dismiss popup

**Subcommand Navigation:**

Commands with subcommands (e.g., `/mode`, `/model`) show a nested submenu when selected:

```
> /mode
+-------------------------------------+
|   plan                              |
|   default                           |
|   acceptEdits                       |
|   bypassPermissions                 |
+-------------------------------------+
```

**Visual Grouping:**

Commands are grouped by source with separators: built-in commands appear first, followed by discovered skill commands.

## Command Registry Architecture

The slash command system uses an extensible registry pattern. Multiple `ICommandSource` implementations provide commands, and the `CommandRegistry` aggregates them.

### ICommandSource Interface

```typescript
interface ICommandSource {
  name: string;
  getCommands(): ISlashCommand[];
}
```

### ISlashCommand Interface

```typescript
interface ISlashCommand {
  name: string;
  description: string;
  source: string;
  subcommands?: ISlashCommand[];
  execute?: (args: string) => void | Promise<void>;
}
```

### Command Sources

| Source   | Class                  | Description                                             |
| -------- | ---------------------- | ------------------------------------------------------- |
| Built-in | `BuiltinCommandSource` | 9 hardcoded commands with subcommands for /mode, /model |
| Skills   | `SkillCommandSource`   | Discovered from .agents/skills/ and ~/.claude/skills/   |

### Skill Discovery

Skills are discovered at session start from two directories (scanned in order, deduplicated):

1. `.agents/skills/*/SKILL.md` -- project-level skills (primary)
2. `~/.claude/skills/*/SKILL.md` -- user-level skills (Claude Code compatible)

Each `SKILL.md` may contain YAML frontmatter with `name` and `description` fields. If no frontmatter is found, the directory name is used as the command name.

## Type Ownership

| Type               | Location                | Purpose                                                        |
| ------------------ | ----------------------- | -------------------------------------------------------------- |
| ITerminalOutput    | `src/types.ts`          | Terminal I/O DI interface (duplicate — SSOT is agent-sessions) |
| ISpinner           | `src/types.ts`          | Spinner handle (duplicate — SSOT is agent-sessions)            |
| IChatMessage       | `src/ui/types.ts`       | UI message model                                               |
| IPermissionRequest | `src/ui/types.ts`       | Permission prompt React state                                  |
| ISlashCommand      | `src/commands/types.ts` | Slash command entry definition                                 |
| ICommandSource     | `src/commands/types.ts` | Interface for command providers                                |

## Public API Surface

| Export       | Kind     | Description                                                                 |
| ------------ | -------- | --------------------------------------------------------------------------- |
| startCli     | function | CLI entry point                                                             |
| (re-exports) | various  | Backward-compatible re-exports of Session, query, types etc. from agent-sdk |

## File Structure

```
src/
├── bin.ts                           ← Binary entry point
├── cli.ts                           ← CLI argument parsing, Ink render invocation
├── types.ts                         ← ITerminalOutput, ISpinner
├── index.ts                         ← Re-exports
├── commands/
│   ├── types.ts                     ← ISlashCommand, ICommandSource interfaces
│   ├── builtin-source.ts            ← BuiltinCommandSource (9 commands + subcommands)
│   ├── skill-source.ts              ← SkillCommandSource (discovers from .agents/skills/)
│   └── command-registry.ts          ← CommandRegistry (aggregates multiple sources)
├── permissions/
│   └── permission-prompt.ts         ← Terminal Allow/Deny prompt
└── ui/
    ├── App.tsx                      ← Main layout, Session creation, state management
    ├── render.tsx                   ← Ink render() invocation
    ├── MessageList.tsx              ← Conversation message list (Robota: label)
    ├── InputArea.tsx                ← Bottom fixed input (CjkTextInput), slash detection
    ├── StatusBar.tsx                ← Mode, model, context %, message count, Thinking
    ├── PermissionPrompt.tsx         ← Allow/Deny arrow-key selection (useInput)
    ├── SlashAutocomplete.tsx        ← Command autocomplete popup (scroll, highlight)
    ├── CjkTextInput.tsx             ← Custom text input with Korean IME support
    ├── WaveText.tsx                 ← Wave color animation for waiting indicator
    ├── render-markdown.ts           ← Markdown rendering for terminal output
    ├── InkTerminal.ts               ← No-op ITerminalOutput
    └── types.ts                     ← IChatMessage, IPermissionRequest
```

## CLI Usage

```bash
robota                              # Interactive TUI
robota -p "prompt"                  # Print mode (one-shot)
robota -c                           # Continue last session
robota -r <id>                      # Resume session
robota --model <model>              # Model override
robota --permission-mode <mode>     # plan | default | acceptEdits | bypassPermissions
robota --max-turns <n>              # Limit turns
robota --version                    # Version
```

## Tool Output Limits

- **Universal cap**: Tool output is capped at 30,000 characters. Outputs exceeding this limit are middle-truncated (first and last portions are kept, with a truncation marker in the middle).
- **Glob entry limit**: The Glob tool defaults to a maximum of 1,000 entries per invocation to prevent oversized responses.

## Session Logging

Session logging is enabled by default. Log files are written to `.robota/logs/{sessionId}.jsonl` in JSONL format, capturing structured events (pre_run, assistant, server_tool, etc.) for diagnostics and replay.

## Known Limitations

- **Korean IME (Input Method Editor)**: Ink's raw mode does not fully support Korean IME composition. This is a known upstream limitation shared with Claude Code (see Claude Code issue #3045). A custom `CjkTextInput` component (replacing `ink-text-input`) mitigates the most common issues using refs-based state management, but edge cases remain on Terminal.app.

## Dependencies

| Package                   | Purpose                                    |
| ------------------------- | ------------------------------------------ |
| `@robota-sdk/agent-sdk`   | Session factory, query, config, context    |
| `@robota-sdk/agent-core`  | Types (TPermissionMode, TToolArgs)         |
| `ink`, `react`            | TUI rendering                              |
| `ink-select-input`        | Arrow-key selection (permission prompt)    |
| `ink-spinner`             | Loading spinner                            |
| `chalk`                   | Terminal colors                            |
| `ink-text-input`          | Base text input (extended by CjkTextInput) |
| `marked`, `marked-terminal` | Markdown parsing and terminal rendering  |
| `cli-highlight`           | Syntax highlighting for code blocks        |
| `string-width`            | Unicode-aware string width calculation     |
