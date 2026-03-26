# SPEC.md — @robota-sdk/agent-cli

## Scope

Interactive terminal AI coding assistant. A React + Ink-based TUI, corresponding to Claude Code.
A **thin CLI layer** built on top of agent-sdk, responsible only for the terminal UI.

## Boundaries

- Does NOT own Session/SessionStore — handled internally by `@robota-sdk/agent-sdk`; CLI must NOT import from `@robota-sdk/agent-sessions`
- Does NOT own tools — assembled internally by `@robota-sdk/agent-sdk`; CLI must NOT import from `@robota-sdk/agent-tools`
- Does NOT own permissions/hooks — public types imported from `@robota-sdk/agent-core`; permission callback type (`TInteractivePermissionHandler`) owned by `@robota-sdk/agent-sdk`
- Does NOT own config/context loading — loaded internally by `InteractiveSession` constructor
- OWNS: AI provider creation (reads config, selects provider package, creates instance, passes to `InteractiveSession`)
- Does NOT own `InteractiveSession` — imported from `@robota-sdk/agent-sdk`
- Does NOT own `CommandRegistry`, `BuiltinCommandSource`, `SkillCommandSource` — all imported from `@robota-sdk/agent-sdk`
- Does NOT use `SystemCommandExecutor` directly — uses `session.executeCommand(name, args)` instead
- Does NOT own ITerminalOutput/ISpinner — SSOT is `@robota-sdk/agent-core`
- OWNS: Ink TUI components, permission-prompt (terminal UI), CLI argument parsing, `useInteractiveSession` hook
- Does NOT own `PluginCommandSource` — imported from `@robota-sdk/agent-sdk`
- Does NOT own `plugin-hooks-merger` — moved to `@robota-sdk/agent-sdk`

## Import Rules

| Source             | Allowed                       | Examples                                                                         |
| ------------------ | ----------------------------- | -------------------------------------------------------------------------------- |
| `agent-sdk`        | SDK-owned APIs                | `InteractiveSession`, `TInteractivePermissionHandler`                            |
| `agent-core`       | Public types + utilities only | `TUniversalMessage`, `TPermissionMode`, `createSystemMessage`, `getModelName`    |
| `agent-core`       | ❌ Internal engine            | ~~`Robota`~~, ~~`ExecutionService`~~, ~~`ConversationStore`~~                    |
| `agent-sessions`   | ❌ Forbidden                  | SDK provides its own session and permission types                                |
| `agent-tools`      | ❌ Forbidden                  | SDK assembles tools internally                                                   |
| `agent-provider-*` | ✅ Provider creation only     | `AnthropicProvider` (CLI picks which to use; currently only anthropic supported) |

## Architecture

The CLI is a pure TUI layer. All business logic (session lifecycle, slash command execution, tool orchestration, abort handling) lives in `@robota-sdk/agent-sdk`'s `InteractiveSession`. The CLI:

1. Reads config to determine which provider to use.
2. Creates the provider instance (e.g., `new AnthropicProvider(options)`).
3. Creates `InteractiveSession({ cwd, provider })` — config and context loading happen internally inside the SDK.
4. Subscribes to `InteractiveSession` events and converts them to React state for rendering.

```
bin.ts → cli.ts (arg parsing + provider creation)
              └── ui/render.tsx → App.tsx (Ink TUI)
                    ├── useInteractiveSession (ONLY React↔SDK bridge)
                    │   ├── InteractiveSession({ cwd, provider })
                    │   │   (from @robota-sdk/agent-sdk; config/context loaded internally)
                    │   ├── TuiStateManager    (owned by agent-cli)
                    │   │   holds history: IHistoryEntry[]  ← primary state for message list
                    │   │   syncs from interactiveSession.getFullHistory() on each update
                    │   ├── CommandRegistry    (from @robota-sdk/agent-sdk)
                    │   │   ├── BuiltinCommandSource  (from @robota-sdk/agent-sdk)
                    │   │   ├── SkillCommandSource    (from @robota-sdk/agent-sdk)
                    │   │   └── PluginCommandSource   (from @robota-sdk/agent-sdk)
                    │   └── session.executeCommand()  (slash commands routed via SDK)
                    ├── MessageList.tsx        (renders IHistoryEntry[]; EntryItem dispatches on category)
                    ├── InputArea.tsx          (bottom input area, slash detection)
                    ├── StatusBar.tsx          (status bar, shows "Thinking..." during run())
                    ├── PermissionPrompt.tsx   (arrow-key selection)
                    └── SlashAutocomplete.tsx  (command popup with scroll)
```

Dependency chain:

```
agent-cli ─→ agent-sdk ─→ agent-sessions ─→ agent-core
  │            ├─→ agent-tools ────────────→ agent-core
  │            └─────────────────────────→ agent-core  (direct: types, utilities)
  ├──────────────────────────────────────→ agent-core  (direct: public types only)
  └──────────────────────────────────────→ agent-provider-* (provider creation)
```

## StatusBar Display

The StatusBar shows real-time session information:

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Mode: default  |  Claude Sonnet 4.6  |  Context: 45% (90K/200K)  |  msgs: 12  |  my-project │
└──────────────────────────────────────────────────────────────────────────┘
```

| Field    | Source                                     | Description                                           |
| -------- | ------------------------------------------ | ----------------------------------------------------- |
| Mode     | `session.getPermissionMode()`              | Current permission mode                               |
| Model    | `getModelName(config.provider.model)`      | Human-readable model name (e.g., "Claude Sonnet 4.6") |
| Context  | `session.getContextState().usedPercentage` | Context usage with K/M formatting (e.g., "90K/1M")    |
| msgs     | message count                              | Number of messages in conversation                    |
| Session  | `session.getName()`                        | Session name (shown only when a name is set)          |
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
- When no tools and no streaming text, renders nothing (empty fragment); "Thinking..." is shown by `StatusBar`

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
| `/resume`                 | Show session picker to resume a saved session                 |
| `/rename [name]`          | Rename the current session                                    |
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

### ListPicker Component

A generic list picker overlay (`ListPicker.tsx`) for selecting an item from a list. Used by the session resume flow to display saved sessions.

**Props:**

| Prop       | Type                      | Description                                                       |
| ---------- | ------------------------- | ----------------------------------------------------------------- |
| `title`    | `string`                  | Header text above the list                                        |
| `items`    | `Array<{ label, value }>` | Items to display. `label` is shown, `value` is returned on select |
| `onSelect` | `(value: string) => void` | Callback when an item is selected                                 |
| `onCancel` | `() => void`              | Callback when ESC is pressed                                      |

**Interaction:** Arrow Up/Down to navigate, Enter to select, ESC to cancel.

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

## React↔SDK Bridge

`useInteractiveSession` is the single boundary between React and the SDK. It:

1. Creates `InteractiveSession({ cwd, provider })` and `CommandRegistry` once (via `useRef` — never recreated on re-render). The provider instance is passed in from the caller; `InteractiveSession` handles config/context loading internally.
2. Creates a `TuiStateManager` instance that holds `history: IHistoryEntry[]` as the primary state for the message list. On each execution update (when `thinking` transitions to `false`, or on `complete`/`interrupted`), the hook delegates to `TuiStateManager` to sync state from `interactiveSession.getFullHistory()`.
3. Subscribes to `InteractiveSession` events (`text_delta`, `tool_start`, `tool_end`, `thinking`, `complete`, `interrupted`, `error`) and converts them to React state.
4. Exposes `handleSubmit`, `handleAbort`, `handleCancelQueue` as stable callbacks to the TUI.
5. Routes slash commands via `session.executeCommand(name, args)` — no `SystemCommandExecutor` is instantiated directly by the CLI.
6. Manages the permission queue (serialises concurrent permission requests).

No other hook or component interacts with `InteractiveSession` directly.

### Plugin Hook Merging

Plugin hook merging (resolving `${CLAUDE_PLUGIN_ROOT}` and merging hook groups) is handled internally by `@robota-sdk/agent-sdk`. The CLI does not perform hook merging.

### App.tsx

`App.tsx` is a thin JSX shell (~220 lines). It:

- Calls `useInteractiveSession` and `usePluginCallbacks`.
- Wraps `handleSubmit` only to process TUI-specific side effects (`_pendingModelId`, `_pendingLanguage`, `_resetRequested`, `_exitRequested`, `_triggerPluginTUI`) that require Ink APIs (`useApp().exit`).
- Contains no queue logic, no abort logic, no session business logic.

### Tool List Visibility

The `StreamingIndicator` (showing active tools) is rendered when `isThinking || activeTools.length > 0`. Streaming state (`streamBuf`, `activeTools`) is cleared at the **start** of a new execution (when `thinking: true`), not at the end. This means the tool list stays visible after execution completes or is aborted, until the next execution begins.

## Command Registry Architecture

The slash command system uses an extensible registry pattern. Multiple `ICommandSource` implementations provide commands, and the `CommandRegistry` aggregates them. `CommandRegistry`, `BuiltinCommandSource`, and `SkillCommandSource` are all owned by `@robota-sdk/agent-sdk`. Slash command execution is routed through `session.executeCommand(name, args)` — the CLI does not instantiate `SystemCommandExecutor` directly. The CLI adds only `PluginCommandSource`.

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

| Source   | Class                  | Owner                   | Description                                          |
| -------- | ---------------------- | ----------------------- | ---------------------------------------------------- |
| Built-in | `BuiltinCommandSource` | `@robota-sdk/agent-sdk` | Built-in commands with subcommands for /mode, /model |
| Skills   | `SkillCommandSource`   | `@robota-sdk/agent-sdk` | Discovered from 4 scan paths (see Skill Discovery)   |
| Plugins  | `PluginCommandSource`  | `@robota-sdk/agent-sdk` | Skills provided by installed bundle plugins          |

### Skill Discovery (Multi-Path)

Skills are discovered at session start from directories scanned by `SkillCommandSource` (agent-sdk), in priority order (highest first, deduplicated by name). Paths are defined in agent-sdk's SPEC.md; the CLI uses them as-is:

| Priority | Path                          | Scope                            |
| -------- | ----------------------------- | -------------------------------- |
| 1        | `.claude/skills/*/SKILL.md`   | Project (Claude Code native)     |
| 2        | `.claude/commands/*.md`       | Project (Claude Code compatible) |
| 3        | `~/.robota/skills/*/SKILL.md` | User global (Robota native)      |
| 4        | `.agents/skills/*/SKILL.md`   | Project (Robota native)          |

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

`interactiveSession.submit(input, displayInput, rawInput)` is called with three arguments:

- `input` — the expanded skill content for the model
- `displayInput` — the display form shown to the user (e.g., `/audit`)
- `rawInput` — the qualified name form used for hook matching (e.g., `/rulebased-harness:audit some-args`); if no qualified name is found, falls back to `displayInput`

The qualified name is resolved via `registry.resolveQualifiedName(cmd)` so that hook matchers can identify which plugin's skill was invoked.

## Type Ownership

| Type               | Location                | Purpose                                                    |
| ------------------ | ----------------------- | ---------------------------------------------------------- |
| ITerminalOutput    | `src/types.ts`          | Terminal I/O DI interface (duplicate — SSOT is agent-core) |
| ISpinner           | `src/types.ts`          | Spinner handle (duplicate — SSOT is agent-core)            |
| IPermissionRequest | `src/ui/types.ts`       | Permission prompt React state                              |
| ISlashCommand      | `src/commands/types.ts` | CLI alias for `ICommand` from agent-sdk                    |
| ICommandSource     | `src/commands/types.ts` | Re-export of `ICommandSource` from agent-sdk               |

## Public API Surface

| Export          | Kind     | Description               |
| --------------- | -------- | ------------------------- |
| startCli        | function | CLI entry point           |
| ITerminalOutput | type     | Terminal I/O DI interface |
| ISpinner        | type     | Spinner handle            |

Note: `createSession()` is internal to `agent-sdk` and is NOT re-exported. The CLI uses `InteractiveSession` directly. `index.ts` does not re-export SDK types; consumers should import those directly from `@robota-sdk/agent-sdk`.

## File Structure

```
src/
├── bin.ts                           ← Binary entry point
├── cli.ts                           ← Config loading, Ink render invocation
├── print-terminal.ts                ← ITerminalOutput for print mode (-p)
├── types.ts                         ← ITerminalOutput, ISpinner
├── index.ts                         ← Re-exports (CommandRegistry, BuiltinCommandSource, etc.)
├── commands/
│   ├── types.ts                     ← ISlashCommand, ICommandSource interfaces
│   ├── builtin-source.ts            ← Re-export shim: `export { BuiltinCommandSource } from '@robota-sdk/agent-sdk'`
│   ├── command-registry.ts          ← Re-export shim: `export { CommandRegistry } from '@robota-sdk/agent-sdk'`
│   ├── skill-source.ts              ← Re-export shim: `export { SkillCommandSource } from '@robota-sdk/agent-sdk'`
│   ├── plugin-source.ts             ← PluginCommandSource (legacy local copy; main flow uses SDK version)
│   ├── skill-executor.ts            ← Skill execution helpers (fork/inject modes); not in main flow
│   │                                  (main flow uses buildSkillPrompt from @robota-sdk/agent-sdk)
│   └── slash-executor.ts            ← IPluginCallbacks interface + plugin TUI handler functions
│                                      (executeSlashCommand not in main flow; main flow uses session.executeCommand())
├── utils/
│   ├── cli-args.ts                  ← CLI argument parsing and validation
│   ├── settings-io.ts               ← Settings file read/write/update/delete
│   ├── provider-factory.ts          ← AI provider creation from settings
│   ├── tool-call-extractor.ts       ← Tool call display extraction from history
│   ├── paste-labels.ts              ← Paste label insertion and expansion for multiline paste
│   └── edit-diff.ts                 ← Edit diff computation and formatting for display
└── ui/
    ├── App.tsx                      ← Thin JSX shell (~220 lines); no queue/abort/session logic
    ├── hooks/
    │   ├── useInteractiveSession.ts ← ONLY React↔SDK bridge; delegates to TuiStateManager for
    │   │                              history: IHistoryEntry[] state; converts InteractiveSession
    │   │                              events to React state (streamingText, activeTools, etc.)
    │   ├── TuiStateManager.ts       ← Holds history: IHistoryEntry[]; syncs from getFullHistory();
    │   │                              manages windowing (MAX_RENDERED_MESSAGES) and local event entries
    │   └── usePluginCallbacks.ts    ← Plugin TUI callback wiring
    ├── render.tsx                   ← Ink render() invocation
    ├── MessageList.tsx              ← Renders IHistoryEntry[] via EntryItem (dispatches on category)
    ├── InputArea.tsx                ← Bottom fixed input (CjkTextInput), slash detection
    ├── StatusBar.tsx                ← Mode, model, context %, message count, Thinking
    ├── PermissionPrompt.tsx         ← Allow/Deny arrow-key selection (useInput)
    ├── StreamingIndicator.tsx       ← Real-time Tools:/Robota: display during run()
    ├── SlashAutocomplete.tsx        ← Command autocomplete popup (scroll, highlight)
    ├── CjkTextInput.tsx             ← Custom text input with Korean IME support
    ├── ConfirmPrompt.tsx            ← Reusable arrow-key confirmation prompt
    ├── WaveText.tsx                 ← Wave color animation for waiting indicator
    ├── ListPicker.tsx               ← Generic list picker overlay (session resume, etc.)
    ├── DiffBlock.tsx                ← Diff block rendering for Edit tool output display
    ├── MenuSelect.tsx               ← Arrow-key menu selection component (Plugin TUI)
    ├── PluginTUI.tsx                ← Plugin management TUI (screen stack navigation)
    ├── TextPrompt.tsx               ← Text input prompt component (Plugin TUI)
    ├── plugin-tui-handlers.ts       ← Plugin TUI action handlers (install, uninstall, etc.)
    ├── render-markdown.ts           ← Markdown rendering for terminal output
    ├── InkTerminal.ts               ← No-op ITerminalOutput
    └── types.ts                     ← IPermissionRequest
```

**Note:** `CommandRegistry`, `BuiltinCommandSource`, `SkillCommandSource`, `PluginCommandSource`, and `SystemCommandExecutor` are all owned by `@robota-sdk/agent-sdk`. The CLI does not use `SystemCommandExecutor` directly; slash command execution goes through `session.executeCommand(name, args)`. The CLI's `src/commands/` directory holds re-export shims (`builtin-source.ts`, `command-registry.ts`, `skill-source.ts`) for backward compatibility, plus `slash-executor.ts` (plugin TUI handlers and IPluginCallbacks interface) and `skill-executor.ts` (fork/inject execution helpers). The CLI's `src/index.ts` exports only `startCli` and local CLI types.

## CLI Usage

```bash
robota                              # Interactive TUI
robota -p "prompt"                  # Print mode (one-shot)
robota -c                           # Continue last session (most recent by cwd)
robota --continue                   # Same as -c
robota -r <id>                      # Resume session by ID or name
robota --resume [id]                # Resume session (shows picker if no ID given)
robota --fork-session <id>          # Fork from a saved session (new session with restored context)
robota --name <name>                # Set session name on startup
robota --reset                      # Delete user settings and exit
robota --model <model>              # Model override
robota --language <lang>            # Response language (ko, en, ja, zh)
robota --permission-mode <mode>     # plan | default | acceptEdits | bypassPermissions
robota --max-turns <n>              # Limit turns
robota --version                    # Version
```

### Session Resolution Logic

| Flag                  | Behavior                                                                                                                                                     |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `--continue` / `-c`   | Finds the most recent session matching the current working directory and resumes it (reuses original session ID, continues writing to the same session file) |
| `--resume [id]`       | If an ID or name is provided, resumes that session (reuses original session ID). If omitted, shows a session picker                                          |
| `--fork-session <id>` | Creates a new session (fresh UUID) but restores conversation context from the specified session. Original session file is preserved unchanged                |
| `--name <name>`       | Sets the session name. Can be combined with other flags                                                                                                      |

When `--resume` is used without a value, a `ListPicker` overlay is shown with all saved sessions. The user selects one to resume.

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

Session logging is an SDK-internal concern. The CLI does not configure or manage log files. For logging details (JSONL format, log paths, event types), see the agent-sdk SPEC.

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
- Context lines (surrounding unchanged file content) shown in **dim white** — 2 lines before and after the changed region.
- **Max display lines: 12.** If the diff exceeds 12 lines, show the first 10 lines + `... and N more lines`.
- If `old_string` and `new_string` are identical (no-op edit), show nothing.
- Diff is shown in both the real-time streaming indicator (after tool completes) and the post-execution summary.

**Permission prompt integration (future):**

When a permission prompt is shown for an Edit tool, the diff should be displayed alongside the Allow/Deny prompt so the user can see what will change before approving.

## Keyboard Controls

### Message Display Order (fixed)

The display order is **Tool → Robota**, fixed and identical for streaming, normal completion, and ESC abort:

**During streaming (real-time):**

```
You: [user prompt]             ← MessageList (visible immediately on submit)
System: Invoking skill: audit  ← MessageList (visible immediately, skills only)
Tool: ⟳ Read(file.ts)         ← StreamingIndicator (real-time, below MessageList)
      ⟳ Edit(file.ts)
Robota: [streaming text...]    ← StreamingIndicator (real-time)
```

`You:` and `System:` messages are visible from the start of streaming — not delayed until completion. Messages are synced from InteractiveSession on both `thinking=true` (execution start) and `thinking=false` (execution end). Only `Tool:` and `Robota:` are handled by StreamingIndicator during streaming.

**After completion or abort (final state):**

```
You: [user prompt]             ← MessageList
Tool: ✓ Read(file.ts)         ← MessageList (tool summary message, inserted before Robota)
      ✓ Edit(file.ts)
Robota: [response]             ← MessageList
System: Interrupted by user.   ← MessageList (abort only)
```

**Mechanism:**

- During streaming: `StreamingIndicator` renders `activeTools` + `streamingText` in real-time (Tool → Robota order).
- On complete/interrupt/error: `InteractiveSession.pushToolSummaryMessage()` inserts a formatted tool summary into the `messages` array BEFORE the Robota response. Then `activeTools` is cleared and `StreamingIndicator` disappears.
- Result: Tool → Robota order is preserved in both real-time and final state. Tool information transitions from `StreamingIndicator` (live) to `MessageList` (permanent).

### Ctrl+C — Process Exit

Ctrl+C always exits the process immediately. This is handled by Ink's `exitOnCtrlC: true` option at the render level, bypassing all `useInput` handlers. It works regardless of which UI overlay is active (PluginTUI, permission prompt, etc.).

### ESC — Abort Execution

ESC aborts the current execution gracefully (unlike Ctrl+C which kills the process):

1. ESC key handler in `App.tsx` calls `handleAbort()` (from `useInteractiveSession`)
2. `handleAbort` sets `isAborting: true` and calls `interactiveSession.abort()`
3. AbortSignal propagates through the entire stack (ExecutionService -> Provider -> `streamWithAbort`)
4. `executeRound` calls `commitAssistant('interrupted')` — the partial response is saved to conversation history with `state: 'interrupted'`. Text is ALWAYS preserved (no stripping).
5. `InteractiveSession` emits the `interrupted` event; the `thinking` event fires with `false`

**Rendering state on abort (`onInterrupted` handler):**

- **Tool list**: `pushToolSummaryMessage()` inserts tool summary into `messages` (before Robota). Then `activeTools` is cleared — tool info lives in `MessageList` now, not `StreamingIndicator`.
- **Streaming text**: cleared (`streamBuf = ''`, `setStreamingText('')`). The interrupted response is committed to message history.
- **isAborting**: cleared by `onThinking(false)` handler.
- **Border color**: yellow (aborting) → green (normal) after `onThinking(false)`.

6. `useInteractiveSession`'s `onThinking(false)` handler:
   - Sets `isAborting: false`
   - Re-syncs `messages` from `interactiveSession.getMessages()` — interrupted messages are already committed
   - Messages with `msg.state === 'interrupted'` show an interrupted indicator in the UI
7. After abort, conversation continues normally — history includes the interrupted assistant message and any tool results
8. History is the SSOT for all message content. Append-only, read-only — no edit, no delete.

**What appears in the UI after ESC:**

```
Tool:                           ← in MessageList (from pushToolSummaryMessage)
  ✓ Read(file.ts)
  ⟳ Edit(file.ts)

Robota:                         ← in MessageList (committed interrupted response)
  [partial response text...]

System:                         ← in MessageList
  Interrupted by user.
```

Tool → Robota order preserved. StreamingIndicator is cleared (activeTools = []).

### Up/Down Arrows — Visual Line Navigation

When input text wraps across multiple visual lines (exceeds terminal width), up/down arrows move the cursor between visual lines using display offset arithmetic.

**Architecture:**

- Cursor-only manipulation — text is never modified, only `cursorRef` position changes
- Two private helpers in `CjkTextInput.tsx` (no separate module):
  - `displayOffset(chars, charIndex, width)` → cumulative display column offset, accounting for CJK line-end gaps
  - `charIndexAtDisplayOffset(chars, targetOffset, width)` → char index closest to target offset
- Up arrow: `cursorRef = charIndexAtDisplayOffset(chars, offset - availableWidth, width)`
- Down arrow: `cursorRef = charIndexAtDisplayOffset(chars, offset + availableWidth, width)`
- Uses `string-width` for CJK character support (2 columns per CJK character)

**Available width calculation:**

- `InputArea` computes `availableWidth` from `useStdout().columns` minus layout constants
- `availableWidth = terminalColumns - BORDER_HORIZONTAL - PADDING_LEFT - PROMPT_WIDTH`
- Named constants (no magic numbers): `BORDER_HORIZONTAL = 2`, `PADDING_LEFT = 1`, `PROMPT_WIDTH = 2` ("> ")
- Layout constants are co-located with InputArea (the component that owns the layout)
- `availableWidth` is passed to `CjkTextInput` as a prop

**Behavior:**

- Up arrow when already on first visual line: no-op (target offset < 0)
- Down arrow when already on last visual line: no-op (target offset exceeds text)
- Column position is preserved across line moves via offset arithmetic
- Terminal resize recalculates available width via `useStdout()`

### Paste Handling

**Bracketed paste mode (DECSET 2004):**

- `render.tsx` enables on startup (`\x1b[?2004h`), disables on exit (`\x1b[?2004l`)
- Only enabled when `process.stdin.isTTY && process.stdout.isTTY`
- Terminal wraps pasted content with `\x1b[200~` (start) and `\x1b[201~` (end) markers
- Ink's CSI parser strips the ESC prefix, so `useInput` receives `[200~` and `[201~`
- `CjkTextInput` detects these markers and buffers all input between them
- On paste-end marker, the complete buffer is flushed with `\r\n`/`\r` normalized to `\n`
- Deterministic boundary detection — no debounce or timing heuristics

**Single-line vs multiline paste:**

- Single-line paste (no `\n`): inserted directly into the input as typed text
- Multiline paste (contains `\n`): routed to `onPaste` → `InputArea.handlePaste` creates a `[Pasted text #N +M lines]` label in the input field, stores content in `pasteStore`
- On submit, `expandPasteLabels()` replaces labels with actual content from `pasteStore`
- Paste store is cleared after each submit

**Fallback for terminals without bracketed paste:**

- Multi-char input containing `\n` or `\r` is treated as a single paste (original heuristic)

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

Subagent execution (Agent tool, fork sessions, agent definition loading) is managed entirely by `@robota-sdk/agent-sdk` internally. The CLI does not wire these components directly — `InteractiveSession` handles all subagent lifecycle.

For implementation details of subagent execution (Agent tool, `context: fork` skills, agent definition scanning), see the agent-sdk SPEC.

## Memory Management

### Message Windowing

`TuiStateManager` keeps only the most recent 100 entries (`MAX_RENDERED_MESSAGES`) in `history: IHistoryEntry[]`. Older entries are dropped from the render tree to prevent unbounded memory growth. Full conversation history is preserved in the session store on disk.

### Tool State Cleanup

Completed tool execution states are trimmed to the most recent 50 entries (`MAX_COMPLETED_TOOLS`). Running tools are always kept. This prevents `activeTools` array from growing unbounded during tool-heavy responses.

### React.memo

`MessageItem` component uses `React.memo` to skip re-renders when message props are unchanged, reducing CPU and indirect memory pressure from Ink's full-tree reconciliation.

## Message Architecture

The CLI uses `IHistoryEntry` (from `@robota-sdk/agent-core`, re-exported by `@robota-sdk/agent-sdk`) as the primary message type for the message list. `TUniversalMessage` is still used in lower-level contexts (session history access, type guards, provider calls). There is no local `IChatMessage` type.

### Type Unification

- `IHistoryEntry[]` is the primary type held by `TuiStateManager` and passed to `MessageList`
- `MessageList` renders entries via `EntryItem`, which dispatches on `entry.category`:
  - `'chat'` entries: rendered as conversation messages (user, assistant, system, tool)
  - `'event'` entries: rendered based on `entry.type` (e.g., `'tool-summary'` renders the tool call list, `'skill-invocation'` renders a system notice)
- `entry.id` (UUID) is used as the React key for message list rendering
- `TUniversalMessage` is still used where needed (type guards, provider API calls, `getMessages()` for backward compat)
- `msg.state === 'interrupted'` shows an interrupted indicator in the UI

### Message State in useInteractiveSession

- `history: IHistoryEntry[]` React state is managed by `TuiStateManager` and derived from `interactiveSession.getFullHistory()`.
- After each execution (when `thinking` transitions to `false`), the hook delegates to `TuiStateManager` to sync `history` from `interactiveSession.getFullHistory()` — the session is the SSOT for all history content.
- `addMessage` appends a local system message directly to React state (used for command output and error notices that are not part of the AI conversation). These are wrapped as `IHistoryEntry` with `category: 'event'` before insertion.
- After abort: interrupted messages are already committed to session history by `InteractiveSession`; the hook re-syncs from full history — no separate streaming text ref is needed.

### Tool Message Type Guards

Tool messages use the `isToolMessage(msg)` type guard for safe access to `msg.name`.

## Known Limitations

- **Korean IME on macOS Terminal.app**: Ink's renderer shifts the input area during IME composition, causing Terminal.app to crash (SIGSEGV). Fixed by adding a permanent blank line below the input area, which stabilizes the cursor position during IME composition. **Use [iTerm2](https://iterm2.com/) for the best experience.**
- **CjkTextInput**: Custom text input component with try-catch error handling, non-printable character filtering, `setCursorPosition` removed to minimize IME interaction surface, and visual-line-aware up/down arrow navigation for wrapped text.

## Dependencies

| Package                                | Purpose                                                                     |
| -------------------------------------- | --------------------------------------------------------------------------- |
| `@robota-sdk/agent-sdk`                | `InteractiveSession`, `CommandRegistry`, command sources, plugin management |
| `@robota-sdk/agent-core`               | Public types (`TPermissionMode`, `TToolArgs`, `TUniversalMessage`, etc.)    |
| `@robota-sdk/agent-provider-anthropic` | Anthropic provider creation (CLI picks provider based on config)            |
| `ink`, `react`                         | TUI rendering                                                               |
| `ink-select-input`                     | Arrow-key selection (permission prompt)                                     |
| `ink-spinner`                          | Loading spinner                                                             |
| `chalk`                                | Terminal colors                                                             |
| `ink-text-input`                       | Base text input (extended by CjkTextInput)                                  |
| `marked`, `marked-terminal`            | Markdown parsing and terminal rendering                                     |
| `cli-highlight`                        | Syntax highlighting for code blocks                                         |
| `string-width`                         | Unicode-aware string width calculation                                      |
