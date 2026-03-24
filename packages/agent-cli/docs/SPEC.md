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

| Field    | Source                                     | Description                                           |
| -------- | ------------------------------------------ | ----------------------------------------------------- |
| Mode     | `session.getPermissionMode()`              | Current permission mode                               |
| Model    | `getModelName(config.provider.model)`      | Human-readable model name (e.g., "Claude Sonnet 4.6") |
| Context  | `session.getContextState().usedPercentage` | Context usage with K/M formatting (e.g., "90K/1M")    |
| msgs     | message count                              | Number of messages in conversation                    |
| Thinking | isThinking state                           | Shown during `session.run()` execution                |

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

### Real-Time Tool Execution (Streaming)

During `session.run()`, tool execution is displayed in real-time via the `onToolExecution` callback. The streaming display shows **Tools: first, then Robota:** in execution order:

```
Tools:

  ✓ Read(/src/index.ts)
  ✓ Bash(ls -la)
  ⟳ Glob(**/*.md)

Robota:

  Checking the file structure now...
```

**Behavior:**

- `onToolExecution` fires `start` when a tool begins and `end` when it completes
- Running tools show `⟳` (yellow), completed tools show `✓` (green)
- Format: `ToolName(firstArgValue)` — first argument truncated to 80 chars, matching post-run summary style
- Completed tools remain visible until `session.run()` finishes (not removed on `end`)
- `Tools:` and `Robota:` sections each have a blank line below the label and between sections
- When no tools and no streaming text, displays "Thinking..."

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

| Command                   | Description                                                   |
| ------------------------- | ------------------------------------------------------------- |
| `/help`                   | Show available commands                                       |
| `/clear`                  | Clear conversation history                                    |
| `/mode [mode]`            | Show/change permission mode                                   |
| `/model [model]`          | Select AI model (shows confirmation prompt, restarts session) |
| `/language [lang]`        | Set response language (ko, en, ja, zh), saves and restarts    |
| `/compact [instructions]` | Compress context window                                       |
| `/cost`                   | Show session info                                             |
| `/context`                | Context window info                                           |
| `/permissions`            | Permission rules                                              |
| `/plugin [subcommand]`    | Plugin management                                             |
| `/exit`                   | Exit CLI                                                      |

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

| Prop       | Type                      | Default         | Description                  |
| ---------- | ------------------------- | --------------- | ---------------------------- |
| `message`  | `string`                  | —               | Message above the options    |
| `options`  | `string[]`                | `['Yes', 'No']` | Options to select from       |
| `onSelect` | `(index: number) => void` | —               | Callback with selected index |

**Interaction:** Arrow keys to navigate, Enter to confirm. For 2-option prompts, `y` selects the first option, `n` selects the second.

### `/plugin` — Plugin Management

The `/plugin` command manages bundle plugins. Subcommands:

| Subcommand                 | Description                                      |
| -------------------------- | ------------------------------------------------ |
| `/plugin install <name>`   | Install a plugin from marketplace or local path  |
| `/plugin uninstall <name>` | Remove an installed plugin                       |
| `/plugin enable <name>`    | Enable a disabled plugin                         |
| `/plugin disable <name>`   | Disable a plugin without uninstalling            |
| `/plugin list`             | List installed plugins with status               |
| `/plugin marketplace`      | Browse available plugins from configured sources |

Installed plugins contribute skills via `PluginCommandSource`, which discovers skills from each plugin's bundle manifest and makes them available as slash commands alongside project and user skills.

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

| Source   | Class                  | Description                                          |
| -------- | ---------------------- | ---------------------------------------------------- |
| Built-in | `BuiltinCommandSource` | Built-in commands with subcommands for /mode, /model |
| Skills   | `SkillCommandSource`   | Discovered from 4 scan paths (see Skill Discovery)   |
| Plugins  | `PluginCommandSource`  | Skills provided by installed bundle plugins          |

### Skill Discovery (Multi-Path)

Skills are discovered at session start from four directories, scanned in priority order (highest first, deduplicated by name):

| Priority | Path                            | Scope                                |
| -------- | ------------------------------- | ------------------------------------ |
| 1        | `.agents/skills/*/SKILL.md`     | Project (Robota native)              |
| 2        | `.claude/commands/*/SKILL.md`   | Project (Claude Code compatible)     |
| 3        | `~/.agents/skills/*/SKILL.md`   | User global (Robota native)          |
| 4        | `~/.claude/commands/*/SKILL.md` | User global (Claude Code compatible) |

### Skill Frontmatter Schema

Each `SKILL.md` may contain YAML frontmatter with the following fields:

| Field           | Type       | Required | Description                                            |
| --------------- | ---------- | -------- | ------------------------------------------------------ |
| `name`          | `string`   | No       | Display name (default: directory name)                 |
| `description`   | `string`   | No       | Short description for autocomplete                     |
| `allowed-tools` | `string[]` | No       | Tools the skill is allowed to use                      |
| `context`       | `string`   | No       | Execution context: `fork`, `agent`                     |
| `model`         | `string`   | No       | Override model for this skill                          |
| `max-turns`     | `number`   | No       | Maximum conversation turns                             |
| `invocation`    | `string`   | No       | Invocation method: `user`, `auto-invoke`, `model-only` |

If no frontmatter is found, the directory name is used as the command name.

### Variable Substitution

Skill content supports variable substitution before injection:

| Variable               | Description                               |
| ---------------------- | ----------------------------------------- |
| `$ARGUMENTS`           | User-provided arguments after the command |
| `${CLAUDE_SESSION_ID}` | Current session identifier                |
| `${CLAUDE_MODEL}`      | Current model identifier                  |
| `${PROJECT_DIR}`       | Project root directory path               |
| `${USER_HOME}`         | User home directory path                  |

Variables are substituted at invocation time, not at discovery time.

### Shell Command Preprocessing

Skill content supports inline shell command execution using the `` !`command` `` syntax. The shell command is executed and its stdout replaces the markup in the skill content before injection. This enables dynamic content like file listings or environment values.

### Skill Execution Features

| Feature          | Value          | Description                                                   |
| ---------------- | -------------- | ------------------------------------------------------------- |
| `context: fork`  | Fork context   | Skill runs in a forked session, preserving the parent context |
| `context: agent` | Agent context  | Skill runs as a sub-agent with its own isolated session       |
| `allowed-tools`  | Tool whitelist | Restricts which tools the skill can use during execution      |

### Skill Invocation Methods

| Method        | Trigger                 | Description                                            |
| ------------- | ----------------------- | ------------------------------------------------------ |
| `user`        | User types `/skillname` | Default — user explicitly invokes via slash command    |
| `auto-invoke` | Model decides           | Model can invoke the skill automatically when relevant |
| `model-only`  | Model-initiated only    | Not shown in user autocomplete, model-only access      |

### Skill Execution

When a skill slash command is selected, the full SKILL.md content (after variable substitution and shell preprocessing) is injected into the session prompt wrapped in `<skill>` tags. The model receives both the skill instructions and any user-provided arguments.

## Type Ownership

| Type               | Location                | Purpose                                                        |
| ------------------ | ----------------------- | -------------------------------------------------------------- |
| ITerminalOutput    | `src/types.ts`          | Terminal I/O DI interface (duplicate — SSOT is agent-sessions) |
| ISpinner           | `src/types.ts`          | Spinner handle (duplicate — SSOT is agent-sessions)            |
| IChatMessage       | `src/ui/types.ts`       | UI message model                                               |
| IPermissionRequest | `src/ui/types.ts`       | Permission prompt React state                                  |
| ISlashCommand      | `src/commands/types.ts` | Slash command entry definition                                 |
| ICommandSource     | `src/commands/types.ts` | Interface for command providers                                |
| ISkillFrontmatter  | `src/commands/types.ts` | Parsed YAML frontmatter from SKILL.md files                    |

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
│   ├── skill-source.ts              ← SkillCommandSource (discovers from 4 scan paths)
│   ├── plugin-source.ts             ← PluginCommandSource (skills from installed plugins)
│   ├── command-registry.ts          ← CommandRegistry (aggregates multiple sources)
│   └── slash-executor.ts            ← Slash command handlers (pure functions, no React)
├── utils/
│   ├── cli-args.ts                  ← CLI argument parsing and validation
│   ├── settings-io.ts               ← Settings file read/write/update/delete
│   ├── skill-prompt.ts              ← Skill prompt builder (pure function)
│   └── tool-call-extractor.ts       ← Tool call display extraction from history
├── permissions/                      ← (empty — prompt imported from @robota-sdk/agent-sdk)
└── ui/
    ├── App.tsx                      ← Main layout (thin JSX shell, ~130 lines)
    ├── hooks/
    │   ├── useSession.ts            ← Session creation, permission queue, streaming, tool events
    │   ├── useMessages.ts           ← Chat message list state management
    │   ├── useSlashCommands.ts      ← Slash command dispatch via slash-executor
    │   ├── useSubmitHandler.ts      ← Input submission, session.run(), tool call extraction
    │   └── useCommandRegistry.ts    ← CommandRegistry initialization
    ├── render.tsx                   ← Ink render() invocation
    ├── MessageList.tsx              ← Conversation message list (Robota: label)
    ├── InputArea.tsx                ← Bottom fixed input (CjkTextInput), slash detection
    ├── StatusBar.tsx                ← Mode, model, context %, message count, Thinking
    ├── PermissionPrompt.tsx         ← Allow/Deny arrow-key selection (useInput)
    ├── StreamingIndicator.tsx       ← Real-time Tools:/Robota: display during run()
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
robota --language <lang>            # Response language (ko, en, ja, zh)
robota --permission-mode <mode>     # plan | default | acceptEdits | bypassPermissions
robota --max-turns <n>              # Limit turns
robota --version                    # Version
```

## Tool Output Limits

- **Universal cap**: Tool output is capped at 30,000 characters. Outputs exceeding this limit are middle-truncated (first and last portions are kept, with a truncation marker in the middle).
- **Glob entry limit**: The Glob tool defaults to a maximum of 1,000 entries per invocation to prevent oversized responses.

## First-Run Setup

When no settings file exists (`~/.robota/settings.json`, `.robota/settings.json`, or `.robota/settings.local.json`), the CLI prompts for initial setup:

1. **Anthropic API key** (input masked with asterisks)
2. **Response language** (ko/en/ja/zh, default: en)

Creates `~/.robota/settings.json` with provider config and language setting. The language is injected into the system prompt as `"Always respond in {language}."` and persists across compaction.

Use `robota --reset` to delete the user settings file and return to the first-run state.

## Session Logging

Session logging is enabled by default. Log files are written to `.robota/logs/{sessionId}.jsonl` in JSONL format, capturing structured events (pre_run, assistant, server_tool, etc.) for diagnostics and replay.

## Tool Execution Display

Tool execution uses a unified visual style across real-time streaming and post-execution summary.

### Icons and Colors

| State   | Icon | Color        | Strikethrough | When                        |
| ------- | ---- | ------------ | ------------- | --------------------------- |
| Running | ⟳    | yellow       | no            | Tool is executing           |
| Success | ✓    | green        | no            | Tool completed successfully |
| Error   | ✗    | red          | yes           | Tool execution failed       |
| Denied  | ⊘    | yellowBright | yes           | Permission denied           |

### Labels

- `Tools:` / `Tool:` headers use **white bold** (visible on dark terminals).
- Tool count badge: `[N tools]` in white dim.

### Argument Truncation

Long tool arguments are truncated with **middle ellipsis**, keeping the last 30 characters visible:

- Before: `Read(/Users/jungyoun/Documents/dev/robota/packages/agent-sdk/src/plugins/ver...)`
- After: `Read(/Users/jungyoun/Documents/dev/...sdk/src/plugins/very-long/file.ts)`

This ensures file names and important suffixes remain visible.

### Plugin Skill Display

Plugin skills show the plugin hint before the description:

- Format: `/skill-name (plugin-name) description`
- Example: `/audit (rulebased-harness) Audits your project's harness setup`

### Edit Diff Display

When the Edit tool completes successfully, a compact diff is shown below the tool line. This gives the user immediate visibility into what changed without inspecting the file.

**Source:** `old_string` and `new_string` from the Edit tool arguments.

**Display format:**

```
  ✓ Edit(src/provider.ts)
    │ src/provider.ts
    │ - const DEFAULT_MAX_TOKENS = 4096;
    │ + const maxTokens = getModelMaxOutput(modelId);
```

**Rules:**

- Show the file path as a header line.
- Removed lines in **red** with `-` prefix.
- Added lines in **green** with `+` prefix.
- **Max display lines: 10.** If the diff exceeds 10 lines, show the first 8 lines + `... and N more lines`.
- Only display one contiguous changed region (the `old_string` → `new_string` replacement). No context lines from the surrounding file.
- If `old_string` and `new_string` are identical (no-op edit), show nothing.
- Diff is shown in both the real-time streaming indicator (after tool completes) and the post-execution summary.

**Permission prompt integration (future):**

When a permission prompt is shown for an Edit tool, the diff should be displayed alongside the Allow/Deny prompt so the user can see what will change before approving.

## ESC Abort Behavior

Pressing ESC during an active `session.run()` triggers abort:

1. ESC key handler calls `session.abort()`
2. `session.run()` throws `AbortError` (see agent-sessions abort behavior)
3. `useSubmitHandler` catches the `AbortError` and displays "Cancelled." in the message list
4. `clearStreamingText(keepTools?: boolean)` is called with `keepTools: true` to preserve the tool execution list while clearing streaming text. This ensures the user can still see which tools ran before the abort.

## Plugin Management TUI

The `/plugin` command opens an interactive TUI for managing bundle plugins, built with `MenuSelect`, `TextPrompt`, and `ConfirmPrompt` components.

### Screen Stack Navigation

The TUI uses a screen stack pattern with 8 screens:

| Screen                      | Description                                                       |
| --------------------------- | ----------------------------------------------------------------- |
| `main`                      | Top-level menu (Marketplace / Installed / Exit)                   |
| `marketplace-list`          | List of configured marketplace sources                            |
| `marketplace-action`        | Actions for a selected source (Browse / Add / Back)               |
| `marketplace-browse`        | Browse plugins from a selected source                             |
| `marketplace-install-scope` | Choose install scope (project / user)                             |
| `marketplace-add`           | Add a new marketplace source URL                                  |
| `installed-list`            | List of installed plugins with enable/disable state               |
| `installed-action`          | Actions for a selected plugin (Enable/Disable / Uninstall / Back) |

ESC navigates back in the stack. When the stack is empty, the TUI closes and returns to the normal input area.

## Subagent Execution

### Agent Tool Registration

The `Agent` tool is registered alongside the standard tools during session creation via `createAgentTool(deps)`. Each session gets its own tool instance with dependencies captured in closure, eliminating shared mutable state. Per-session deps are also stored via `storeAgentToolDeps(session, deps)` for retrieval by the fork runner.

### context:fork Wiring

Skills with `context: fork` in their frontmatter are executed via `createSubagentSession` from `@robota-sdk/agent-sdk`. The fork worker session:

- Receives the skill's SKILL.md content as the system prompt
- Inherits the parent session's config, context, and tools
- Uses the fork worker suffix (concise 500-word response)
- Respects `allowed-tools` from the skill frontmatter as a tool allowlist
- Respects `model` from the skill frontmatter as a model override

### Agent Definition Loading

Agent definitions are loaded via `AgentDefinitionLoader` from `@robota-sdk/agent-sdk`. The loader scans `.robota/agents/` (project, primary), `.claude/agents/` (project, Claude Code compatible), and `~/.robota/agents/` (user) directories for custom agent `.md` files. Plugin-provided agent definitions can be registered via the `customAgentRegistry` callback in `IAgentToolDeps`.

## Memory Management

### Message Windowing

React state keeps only the most recent 100 messages (`MAX_RENDERED_MESSAGES`). Older messages are dropped from the render tree to prevent unbounded memory growth. Full conversation history is preserved in the session store on disk.

### Tool State Cleanup

Completed tool execution states are trimmed to the most recent 50 entries (`MAX_COMPLETED_TOOLS`). Running tools are always kept. This prevents `activeTools` array from growing unbounded during tool-heavy responses.

### React.memo

`MessageItem` component uses `React.memo` to skip re-renders when message props are unchanged, reducing CPU and indirect memory pressure from Ink's full-tree reconciliation.

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
