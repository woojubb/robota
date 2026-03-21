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
  │            ├─→ agent-provider-anthropic → agent-core
  │            └─────────────────────────→ agent-core  (direct: types, permissions, hooks)
  └──────────────────────────────────────→ agent-core  (direct: types only)
```

## StatusBar Display

The StatusBar shows real-time session information:

```
┌──────────────────────────────────────────────────────────┐
│ Mode: default  |  Claude Sonnet 4.6  |  Context: 45% (90K/200K)  |  msgs: 12 │
└──────────────────────────────────────────────────────────┘
```

| Field    | Source                                     | Description                            |
| -------- | ------------------------------------------ | -------------------------------------- |
| Mode     | `session.getPermissionMode()`              | Current permission mode                |
| Model    | `getModelName(config.provider.model)`      | Human-readable model name (e.g., "Claude Sonnet 4.6") |
| Context  | `session.getContextState().usedPercentage` | Context usage with K/M formatting (e.g., "90K/1M") |
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

## Tool Call Display

### Real-Time Tool Execution

During `session.run()`, tool execution is displayed in real-time via the `onToolExecution` callback:

```
  ⟳ Bash...
  ⟳ Read...
```

The callback fires `start` when a tool begins and `end` when it completes. The UI shows running tools with a spinner indicator, replacing the "Thinking..." message.

### Post-Run Tool Summary

After each `session.run()` completes, tool calls from the session history are extracted and displayed as a single grouped message:

```
Tool: [5 tools]

  Read(/Users/jungyoun/Documents/dev/robota/.agents/tasks/apps-web-sep...)
  Bash(ls -la .agents/tasks/)
  Glob(**/*.md)
```

- All tool calls from a run are grouped into one `role: 'tool'` message
- Format: `ToolName(firstArgValue)` — first argument value extracted from JSON, truncated to 80 chars
- Displayed after the assistant response in the message list

## Slash Commands

| Command                   | Description                 |
| ------------------------- | --------------------------- |
| `/help`                   | Show available commands     |
| `/clear`                  | Clear conversation history  |
| `/mode [mode]`            | Show/change permission mode |
| `/model [model]`          | Select AI model (shows confirmation prompt, restarts session) |
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

### `/model` — Model Change Flow

The `/model` command lists available models as subcommands with the format `Claude Opus 4.6 (1M)`. Model definitions come from the `CLAUDE_MODELS` registry in `@robota-sdk/agent-core`.

**Subcommand display:**

```
> /model
+-------------------------------------+
|   Claude Opus 4.6 (1M)             |
|   Claude Sonnet 4.6 (1M)           |
|   Claude Haiku 4.5 (200K)          |
+-------------------------------------+
```

**Model change flow:**

1. User selects a model from the subcommand list
2. A `ConfirmPrompt` appears: "Change model to Claude Opus 4.6? The CLI will restart."
3. If confirmed (Yes / `y`): settings are written to `~/.robota/settings.json` and the CLI exits (user restarts manually)
4. If cancelled (No / `n`): returns to normal input

### ConfirmPrompt Component

A reusable confirmation prompt with arrow-key selection (`ConfirmPrompt.tsx`). Used by `/model` change and available for other yes/no confirmations.

**Props:**

| Prop      | Type                     | Default          | Description                  |
| --------- | ------------------------ | ---------------- | ---------------------------- |
| `message` | `string`                 | —                | Message above the options    |
| `options` | `string[]`               | `['Yes', 'No']`  | Options to select from       |
| `onSelect`| `(index: number) => void`| —                | Callback with selected index |

**Interaction:** Arrow keys to navigate, Enter to confirm. For 2-option prompts, `y` selects the first option, `n` selects the second.

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
  skillContent?: string; // Full SKILL.md content (skill commands only)
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

### Skill Execution

When a skill slash command is selected, the full SKILL.md content is injected into the session prompt wrapped in `<skill>` tags. The model receives both the skill instructions and any user-provided arguments.

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
├── cli.ts                           ← Config loading, Ink render invocation
├── print-terminal.ts                ← ITerminalOutput for print mode (-p)
├── types.ts                         ← ITerminalOutput, ISpinner
├── index.ts                         ← Re-exports
├── commands/
│   ├── types.ts                     ← ISlashCommand, ICommandSource interfaces
│   ├── builtin-source.ts            ← BuiltinCommandSource (9 commands + subcommands)
│   ├── skill-source.ts              ← SkillCommandSource (discovers from .agents/skills/)
│   ├── command-registry.ts          ← CommandRegistry (aggregates multiple sources)
│   └── slash-executor.ts            ← Slash command handlers (pure functions, no React)
├── utils/
│   ├── cli-args.ts                  ← CLI argument parsing and validation
│   ├── settings-io.ts               ← Settings file read/write/update/delete
│   └── tool-call-extractor.ts       ← Tool call display extraction from history
├── permissions/                      ← (empty — prompt imported from @robota-sdk/agent-sdk)
└── ui/
    ├── App.tsx                      ← Main layout, Session creation, state management
    ├── render.tsx                   ← Ink render() invocation
    ├── MessageList.tsx              ← Conversation message list (Robota: label)
    ├── InputArea.tsx                ← Bottom fixed input (CjkTextInput), slash detection
    ├── StatusBar.tsx                ← Mode, model, context %, message count, Thinking
    ├── PermissionPrompt.tsx         ← Allow/Deny arrow-key selection (useInput)
    ├── SlashAutocomplete.tsx        ← Command autocomplete popup (scroll, highlight)
    ├── CjkTextInput.tsx             ← Custom text input with Korean IME support
    ├── ConfirmPrompt.tsx            ← Reusable arrow-key confirmation prompt
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
robota --reset                      # Delete user settings and exit
robota -r <id>                      # Resume session
robota --model <model>              # Model override
robota --permission-mode <mode>     # plan | default | acceptEdits | bypassPermissions
robota --max-turns <n>              # Limit turns
robota --version                    # Version
```

## Tool Output Limits

- **Universal cap**: Tool output is capped at 30,000 characters. Outputs exceeding this limit are middle-truncated (first and last portions are kept, with a truncation marker in the middle).
- **Glob entry limit**: The Glob tool defaults to a maximum of 1,000 entries per invocation to prevent oversized responses.

## First-Run Setup

When no settings file exists (`~/.robota/settings.json`, `.robota/settings.json`, or `.robota/settings.local.json`), the CLI prompts for an Anthropic API key and creates `~/.robota/settings.json` with a minimal config (provider name, model, API key).

Use `robota --reset` to delete the user settings file and return to the first-run state.

## Session Logging

Session logging is enabled by default. Log files are written to `.robota/logs/{sessionId}.jsonl` in JSONL format, capturing structured events (pre_run, assistant, server_tool, etc.) for diagnostics and replay.

## Known Limitations

- **Korean IME on macOS Terminal.app**: Ink's renderer shifts the input area during IME composition, causing Terminal.app to crash (SIGSEGV). Fixed by adding a permanent blank line below the input area, which stabilizes the cursor position during IME composition. **Use [iTerm2](https://iterm2.com/) for the best experience.**
- **CjkTextInput**: Custom text input component with try-catch error handling, non-printable character filtering, and `setCursorPosition` removed to minimize IME interaction surface.

## Dependencies

| Package                     | Purpose                                    |
| --------------------------- | ------------------------------------------ |
| `@robota-sdk/agent-sdk`     | Session factory, query, config, context    |
| `@robota-sdk/agent-core`    | Types (TPermissionMode, TToolArgs)         |
| `ink`, `react`              | TUI rendering                              |
| `ink-select-input`          | Arrow-key selection (permission prompt)    |
| `ink-spinner`               | Loading spinner                            |
| `chalk`                     | Terminal colors                            |
| `ink-text-input`            | Base text input (extended by CjkTextInput) |
| `marked`, `marked-terminal` | Markdown parsing and terminal rendering    |
| `cli-highlight`             | Syntax highlighting for code blocks        |
| `string-width`              | Unicode-aware string width calculation     |
