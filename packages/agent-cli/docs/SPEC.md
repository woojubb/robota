# SPEC.md — @robota-sdk/agent-cli

## Scope

Interactive terminal AI coding assistant. A React + Ink-based TUI, corresponding to Claude Code.
A **thin CLI layer** built on top of agent-sdk, responsible only for the terminal UI.

## Boundaries

- Does NOT own Session/SessionStore — handled internally by `@robota-sdk/agent-sdk`; CLI must NOT import from `@robota-sdk/agent-sessions`
- Does NOT own tools — assembled internally by `@robota-sdk/agent-sdk`; CLI must NOT import from `@robota-sdk/agent-tools`
- Does NOT own permissions/hooks — public types imported from `@robota-sdk/agent-core`; permission callback type (`TInteractivePermissionHandler`) owned by `@robota-sdk/agent-sdk`
- Does NOT own config/context loading — loaded internally by `InteractiveSession` constructor
- OWNS: Provider composition (receives provider definitions, reads config, selects an injected definition, creates instance, passes to `InteractiveSession`)
- Does NOT own `InteractiveSession` — imported from `@robota-sdk/agent-sdk`
- Does NOT own `CommandRegistry`, `BuiltinCommandSource`, `SkillCommandSource` — all imported from `@robota-sdk/agent-sdk`
- Does NOT use `SystemCommandExecutor` directly — uses `session.executeCommand(name, args)` instead
- Does NOT own ITerminalOutput/ISpinner — SSOT is `@robota-sdk/agent-core`
- OWNS: Ink TUI components, permission-prompt (terminal UI), CLI argument parsing, `useInteractiveSession` hook
- Does NOT own `PluginCommandSource` — imported from `@robota-sdk/agent-sdk`
- Does NOT own `plugin-hooks-merger` — moved to `@robota-sdk/agent-sdk`

## Import Rules

| Source             | Allowed                              | Examples                                                                                    |
| ------------------ | ------------------------------------ | ------------------------------------------------------------------------------------------- |
| `agent-sdk`        | SDK-owned APIs                       | `InteractiveSession`, `TInteractivePermissionHandler`                                       |
| `agent-core`       | Public types + utilities only        | `TUniversalMessage`, `TPermissionMode`, `createSystemMessage`, `getModelName`               |
| `agent-core`       | ❌ Internal engine                   | ~~`Robota`~~, ~~`ExecutionService`~~, ~~`ConversationStore`~~                               |
| `agent-sessions`   | ❌ Forbidden                         | SDK provides its own session and permission types                                           |
| `agent-tools`      | ❌ Forbidden                         | SDK assembles tools internally                                                              |
| `agent-provider-*` | ✅ Provider definition assembly only | CLI composes injected `IProviderDefinition[]`; provider packages own defaults and factories |

## Architecture

The CLI is a pure TUI layer. All business logic (session lifecycle, slash command execution, tool orchestration, abort handling) lives in `@robota-sdk/agent-sdk`'s `InteractiveSession`. The CLI:

1. Reads config to determine which provider profile to use.
2. Resolves the profile `type` against an injected `IProviderDefinition[]`.
3. Creates the provider instance by calling `definition.createProvider(config)`.
4. Creates `InteractiveSession({ cwd, provider })` — config and context loading happen internally inside the SDK.
5. Subscribes to `InteractiveSession` events and converts them to React state for rendering.

### Provider Profile Creation

The CLI owns provider profile resolution and provider definition composition. It must not branch on provider type names to decide defaults, required fields, setup prompts, endpoint probes, or constructor behavior. Those values come from injected `IProviderDefinition` records.

Settings may define an active provider profile:

```json
{
  "currentProvider": "gemma",
  "providers": {
    "gemma": {
      "type": "gemma",
      "model": "supergemma4-26b-uncensored-v2",
      "apiKey": "lm-studio",
      "baseURL": "http://localhost:1234/v1"
    },
    "openai": {
      "type": "openai",
      "model": "<openai-compatible-model>",
      "apiKey": "$ENV:OPENAI_API_KEY"
    }
  }
}
```

Gemma-family local models served through LM Studio must use a `type: "gemma"` profile so the provider package can apply Gemma-specific channel-marker projection. `type: "openai"` remains model-family neutral and must not filter Gemma markers.

Provider resolution order:

1. `currentProvider` plus `providers[currentProvider]`
2. Legacy `provider`
3. Defaults supplied by the resolved provider definition

Provider definition contract:

| Field            | Owner                            | CLI behavior                                          |
| ---------------- | -------------------------------- | ----------------------------------------------------- |
| `type`           | Provider package or CLI assembly | Match settings profile type to a definition           |
| `defaults`       | Provider package                 | Fill omitted model/apiKey/baseURL/timeout values      |
| `setupSteps`     | Provider package                 | Drive interactive setup prompts without type branches |
| `requiresApiKey` | Provider package                 | Validate profiles consistently                        |
| `probeProfile`   | Provider package                 | Optional endpoint/profile test hook                   |
| `createProvider` | Provider package                 | Build concrete provider instance                      |

The default CLI binary assembles definitions from provider packages. Alternate embeddings can pass their own definitions into `startCli({ providerDefinitions })`.

### Provider Configuration UX

The CLI owns provider setup and provider profile writes. Default writes go to `~/.robota/settings.json`; `.claude/settings.json` compatibility is read-only for Robota-specific provider profile creation.

Supported setup flags:

| Flag                             | Behavior                                                            |
| -------------------------------- | ------------------------------------------------------------------- |
| `--configure`                    | Run interactive provider setup and exit                             |
| `--configure-provider <profile>` | Upsert a provider profile and exit unless a prompt is also provided |
| `--provider <profile>`           | Select an existing provider profile for this invocation             |
| `--set-current`                  | Persist the selected or configured profile as `currentProvider`     |
| `--type <type>`                  | Provider implementation type used by `--configure-provider`         |
| `--base-url <url>`               | Provider API base URL                                               |
| `--api-key <value>`              | Store a literal API key                                             |
| `--api-key-env <name>`           | Store `$ENV:<name>`, not the current environment value              |

First-run setup must offer the injected provider definitions when stdin/stdout are TTYs. Non-interactive print/headless execution must not prompt; missing provider config must produce an actionable error that points to `robota --configure` and `robota --configure-provider`.

Provider slash commands are TUI side effects:

| Command                    | Behavior                                                    |
| -------------------------- | ----------------------------------------------------------- |
| `/provider`                | Show current provider and subcommands                       |
| `/provider current`        | Show active profile, type, model, and baseURL               |
| `/provider list`           | Show provider profiles from merged settings                 |
| `/provider use <profile>`  | Confirm, persist `currentProvider`, and restart the session |
| `/provider test [profile]` | Validate fields and optionally probe the endpoint           |

Provider changes must follow the existing `/model` restart pattern: command returns structured data, TUI confirms, settings are written after confirmation, and the App remounts with a new provider instance.

Provider setup prompt semantics must live outside Ink components. `provider-setup-flow` owns setup steps, defaults, required-field validation, masked-field metadata, and final `IProviderSetupInput` construction. TUI components may only render the current prompt step and pass submitted values back to the flow module.

TUI input semantics must live outside Ink components. `src/ui/flows/*` owns prompt and input state transitions, shortcut meaning, selection bounds, slash autocomplete command selection, paste label insertion, and CJK cursor movement. Components may only translate `useInput` key data into flow actions, apply returned state, render the result, and call external callbacks.

Flow ownership:

| Flow module                 | Owns                                                                        | Thin shell consumers                                     |
| --------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------- |
| `text-prompt-flow.ts`       | text prompt editing, submit/cancel effects, validation state                | `TextPrompt`, `ProviderSetupPrompt` through `TextPrompt` |
| `selection-flow.ts`         | bounded/wrapping selection, select/cancel effects, viewport scrolling       | `ListPicker`, `MenuSelect`, choice prompt flows          |
| `confirm-prompt-flow.ts`    | confirmation shortcuts and option selection                                 | `ConfirmPrompt`                                          |
| `permission-prompt-flow.ts` | permission shortcuts and `true`/`allow-session`/`false` decisions           | `PermissionPrompt`                                       |
| `input-area-flow.ts`        | slash autocomplete movement, command completion, queue cancel, paste labels | `InputArea`                                              |
| `cjk-text-input-flow.ts`    | printable filtering, cursor movement, bracketed paste, submit effects       | `CjkTextInput`                                           |

```
bin.ts → cli.ts (arg parsing + provider definition composition)
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
  └──────────────────────────────────────→ agent-provider-* (provider definitions)
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

### Session Name Display

Session name appears in three locations when set (via `--name` or `/rename`):

1. **Input box top border** — right-aligned title embedded in the border with background color matching the border and black bold text:
   ```
   ┌──────────────────────────────────────── "my-session" ──┐
   │ > Type a message                                       │
   └────────────────────────────────────────────────────────┘
   ```
2. **Terminal title** — ANSI escape `\x1b]0;Robota — <name>\x07` updates the terminal tab/window title
3. **StatusBar** — displayed in magenta alongside mode, model, and context info

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
| `/rename <name>`          | Rename the current session (name displayed in StatusBar)      |
| `/exit`                   | Exit CLI                                                      |

### Slash Command Autocomplete

Typing `/` as the first character in the input triggers an autocomplete popup. The popup filters commands in real-time as the user types.

**Interaction:**

- Arrow Up/Down: Navigate items
- Tab: Insert highlighted command into input field (does NOT execute). User can continue typing args or press Enter to execute.
- Enter: Insert and execute the highlighted command immediately
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

1. Creates `InteractiveSession({ cwd, provider, commandModules })` and `CommandRegistry` once (via `useRef` — never recreated on re-render). The provider instance is passed in from the caller; `InteractiveSession` handles config/context loading internally.
2. Creates a `TuiStateManager` instance that holds `history: IHistoryEntry[]` as the primary state for the message list. On each execution update (when `thinking` transitions to `false`, or on `complete`/`interrupted`), the hook delegates to `TuiStateManager` to sync state from `interactiveSession.getFullHistory()`.
3. Subscribes to `InteractiveSession` events (`text_delta`, `tool_start`, `tool_end`, `thinking`, `complete`, `interrupted`, `error`, `background_task_event`) and converts them to React state.
4. Exposes `handleSubmit`, `handleAbort`, `handleCancelQueue`, and `handleShutdown` as stable callbacks to the TUI.
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

### Streaming Text Debounce

`TuiStateManager.onTextDelta` debounces `notify()` calls to reduce React re-render and markdown rendering frequency. Text deltas are accumulated in `streamBuf` immediately (no data loss), but `notify()` fires at most once per `STREAMING_DEBOUNCE_MS` (default 300ms). This limits `renderMarkdown()` invocations to ~3/second instead of per-token (hundreds/second). A `createDebouncedNotify` utility manages the timer lifecycle; `flush()` is called on completion/interruption/error to clean up.

## Command Registry Architecture

The slash command system uses an extensible registry pattern. Multiple `ICommandSource` implementations provide commands, and the `CommandRegistry` aggregates them. `CommandRegistry`, `BuiltinCommandSource`, and `SkillCommandSource` are all owned by `@robota-sdk/agent-sdk`. Slash command execution is routed through `session.executeCommand(name, args)` — the CLI does not instantiate `SystemCommandExecutor` directly. The CLI adds `PluginCommandSource` and any injected `ICommandModule` sources generically.

Reusable CLI/TUI code must not special-case command module names such as `/agent`. It accepts `commandModules` and registers them with the SDK registry. The package binary may choose product defaults by passing modules into `startCli()`.

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
| Modules  | `ICommandModule`       | Module package          | Optional command modules injected by composition     |
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
│   ├── provider-factory.ts          ← AI provider resolution from injected definitions
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
    ├── flows/
    │   ├── text-prompt-flow.ts      ← Text prompt editing, validation, submit/cancel effects
    │   ├── selection-flow.ts        ← Shared bounded/wrapping selection state machine
    │   ├── confirm-prompt-flow.ts   ← Confirmation shortcuts and option selection
    │   ├── permission-prompt-flow.ts← Permission shortcuts and decision mapping
    │   ├── input-area-flow.ts       ← Slash autocomplete and paste-label input flow
    │   └── cjk-text-input-flow.ts   ← CJK-aware text editing and paste flow
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

**Note:** `CommandRegistry`, `BuiltinCommandSource`, `SkillCommandSource`, `PluginCommandSource`, and `SystemCommandExecutor` are owned by `@robota-sdk/agent-sdk`. The CLI does not use `SystemCommandExecutor` directly; slash command execution goes through `session.executeCommand(name, args)`. The CLI's `src/commands/` directory holds re-export shims (`builtin-source.ts`, `command-registry.ts`, `skill-source.ts`) for backward compatibility, plus `slash-executor.ts` (plugin TUI handlers and IPluginCallbacks interface) and `skill-executor.ts` (fork/inject execution helpers). The CLI's `src/index.ts` exports only `startCli` and local CLI types.

## CLI Usage

```bash
robota                              # Interactive TUI
robota -p "prompt"                  # Print mode (one-shot)
robota -c                           # Continue last session (most recent by cwd)
robota --continue                   # Same as -c
robota -r <id>                      # Resume session by ID or name
robota --resume [id]                # Resume session (shows picker if no ID given)
robota -c --fork-session             # Fork from last session (new ID, restored context)
robota --name <name>                # Set session name on startup
robota --reset                      # Delete user settings and exit
robota --model <model>              # Model override
robota --language <lang>            # Response language (ko, en, ja, zh)
robota --permission-mode <mode>     # plan | default | acceptEdits | bypassPermissions
robota --max-turns <n>              # Limit turns
robota --output-format <fmt>        # text | json | stream-json (print mode only)
robota --system-prompt <text>       # Replace system prompt (print mode only)
robota --append-system-prompt <text> # Append to system prompt (print mode only)
robota --version                    # Version
```

### Print Mode and Headless Transport

Print mode (`-p`) delegates execution to `@robota-sdk/agent-transport-headless` via `createHeadlessTransport`. The CLI creates an `InteractiveSession`, attaches the headless transport via `session.attachTransport(transport)`, calls `transport.start()`, then calls `session.shutdown({ reason: 'prompt_input_exit' })` before exiting with `transport.getExitCode()`.

Any command modules supplied to `startCli({ commandModules })` are passed to the same `InteractiveSession` in both print mode and TUI mode.

**`--output-format`** controls how the response is written to stdout:

| Format        | Description                                              |
| ------------- | -------------------------------------------------------- |
| `text`        | Plain text response (default)                            |
| `json`        | Single JSON object with `type`, `result`, `session_id`   |
| `stream-json` | Newline-delimited JSON with `content_block_delta` events |

**`--system-prompt`** and **`--append-system-prompt`** are parsed but not yet connected to InteractiveSession. Requires SDK-level support for custom system prompt injection. Flags are reserved for future implementation.

### Stdin Pipe

When `-p` is specified with no positional argument and stdin is piped (not a TTY), the CLI reads the full stdin stream as the prompt:

```bash
echo "Explain this" | robota -p
cat file.ts | robota -p "Review this code"
```

If both stdin and a positional argument are provided, stdin content is prepended to the prompt.

### Exit Codes

| Code | Meaning                |
| ---- | ---------------------- |
| 0    | Success or interrupted |
| 1    | Error during execution |

### Session Resolution Logic

| Flag                | Behavior                                                                                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--continue` / `-c` | Finds the most recent session matching the current working directory and resumes it (reuses original session ID, continues writing to the same session file)  |
| `--resume [id]`     | If an ID or name is provided, resumes that session (reuses original session ID). If omitted, shows a session picker                                           |
| `--fork-session`    | Boolean flag, used with `--continue` or `--resume`. Creates a new session (fresh UUID) but restores context from the resumed session. Original file preserved |
| `--name <name>`     | Sets the session name. Can be combined with other flags                                                                                                       |

When `--resume` is used without a value, a `ListPicker` overlay is shown with all saved sessions. The user selects one to resume.

### Session Storage

The CLI constructs `SessionStore` with the current project path `.robota/sessions`, not the generic user-level default. Every resumable session record must stay beside the project logs and must include provider messages, UI history, the exact system prompt, and registered tool schemas. This makes `/continue`, `/resume`, and local debugging inspect the same project-local `.robota` tree.

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

- During streaming: `StreamingIndicator` renders `activeTools` + `streamingText` in real-time (Tool → Robota order). Each tool occupies exactly one line — `onToolEnd` uses `findIndex` to update only the first matching running entry (not all entries with the same tool name).
- Individual `tool-start` and `tool-end` events are recorded as `IHistoryEntry` in the session history for persistence, but `MessageList` does **not** render them (returns empty fragment). They exist only for session resume and debugging.
- On complete/interrupt/error: `InteractiveSession.pushToolSummaryMessage()` inserts a formatted tool summary into the `messages` array BEFORE the Robota response. Then `activeTools` is cleared and `StreamingIndicator` disappears.
- Result: Tool → Robota order is preserved in both real-time and final state. Tool information transitions from `StreamingIndicator` (live) to `MessageList` (permanent).

### Ctrl+C — Graceful Shutdown

Ink render uses `exitOnCtrlC: false`. The first Ctrl+C is handled by `App.tsx`, renders `Shutting down...`, and calls `useInteractiveSession.handleShutdown('prompt_input_exit')`. That delegates to `InteractiveSession.shutdown()`, so foreground abort, managed background task cancellation, session persistence, and `SessionEnd` hooks run in the SDK-owned lifecycle before the TUI exits.

Slash-command restarts and exits (`/exit`, provider/model/language restart, reset) also call `InteractiveSession.shutdown()` before `useApp().exit()`. The CLI owns only signal/UI wiring; it must not enumerate or kill SDK-managed background work directly.

### ESC — Abort Execution

ESC aborts the current execution gracefully (unlike Ctrl+C which kills the process):

1. ESC key handler in `App.tsx` calls `handleAbort()` (from `useInteractiveSession`). The App-level ESC listener remains mounted and guards permission, plugin, and session-picker overlays inside the handler instead of toggling `useInput({ isActive })`.
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

- Cursor-only manipulation — text is never modified, only flow `cursor` position changes
- External value sync with `cursorHint` — when parent sets value, cursor position is determined by `cursorHint` prop: `null` (default) moves cursor to end (tab completion, clear), a number moves cursor to that position (paste). `cursorHint` is consumed once and reset to `null` after use.
- Helpers in `cjk-text-input-flow.ts`:
  - `displayOffset(chars, charIndex, width)` → cumulative display column offset, accounting for CJK line-end gaps
  - `charIndexAtDisplayOffset(chars, targetOffset, width)` → char index closest to target offset
- Up arrow: `cursor = charIndexAtDisplayOffset(chars, offset - availableWidth, width)`
- Down arrow: `cursor = charIndexAtDisplayOffset(chars, offset + availableWidth, width)`
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
- `cjk-text-input-flow` detects these markers and buffers all input between them
- On paste-end marker, the complete buffer is flushed with `\r\n`/`\r` normalized to `\n`
- Deterministic boundary detection — no debounce or timing heuristics

**Single-line vs multiline paste:**

- Single-line paste (no `\n`): inserted directly into the input at the current cursor position via `insertAtCursor`
- Multiline paste (contains `\n`): routed to `onPaste(text, cursorPosition)` → `InputArea.handlePaste` inserts a `[Pasted text #N +M lines]` label at the current cursor position, stores content in `pasteStore`
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

Subagent execution (Agent tool, fork sessions, agent definition loading) is managed by `@robota-sdk/agent-sdk` internally. The CLI does not own subagent lifecycle state — `InteractiveSession` handles subagent and background task lifecycle.

The CLI owns Node runtime process adapters. It injects `createManagedShellProcessRunner()` into `InteractiveSession` as a `kind: 'process'` background task runner. SDK composition then exposes the separate `BackgroundProcess` tool; the existing foreground `Bash` tool remains unchanged.

The CLI also injects `createChildProcessSubagentRunnerFactory()` into `InteractiveSession` as the production subagent runner factory. The factory receives SDK-assembled subagent dependencies, but the runner starts a child Node worker and sends only serializable config/context/provider/agent-definition data over IPC. The worker reconstructs its provider inside the child process using the same concrete provider profile the CLI used for the parent session.

`child-process-subagent-runner-result.ts` owns child-worker result orchestration for the adapter: IPC message validation, timeout timer cleanup, early-exit errors, and transcript metadata projection. `child-process-subagent-runner.ts` remains the process factory and payload composer.

Agent command behavior is not owned by the TUI. The Robota binary can compose `@robota-sdk/agent-command-agent` as a default command module, but reusable CLI UI code only handles generic command modules.

Child-process subagent runner responsibilities:

- fork one worker process per subagent job
- pass `ISubagentSpawnRequest`, agent definition, parent config/context, permission mode, and serialized provider profile over IPC
- expose child `pid` on the background task state
- forward worker text/tool IPC messages to `BackgroundTaskManager` progress events
- create an append-only subagent transcript at `.robota/logs/PARENT_SESSION_ID/subagents/AGENT_ID.jsonl` and make `/agent read AGENT_ID` read that transcript while the worker is still running
- forward cancellation to the worker and terminate it after a grace period
- forward follow-up prompts to workers that support input
- keep runtime-owned lifecycle state inside `BackgroundTaskManager`; the CLI owns only the Node process adapter

When an agent request sets `isolation: 'worktree'`, the CLI composes the runtime-owned `WorktreeSubagentRunner` exposed through SDK contracts around the child-process runner and injects a CLI-owned `GitWorktreeIsolationAdapter`.

The runtime worktree runner owns worktree lifecycle orchestration:

- delegate non-worktree requests unchanged
- run isolated workers with `cwd` set to the prepared worktree path
- remove clean worktrees on success or worker failure
- preserve dirty worktrees and return `worktreePath` plus `branchName` in result metadata
- fire SDK hook notifications for `WorktreeCreate` and `WorktreeRemove` when configured

The CLI-owned Git adapter implements only local Git/filesystem I/O:

- create a temporary branch and worktree before the worker starts
- remove the worktree and branch when the worktree remains clean
- report whether the worktree has local edits

When a user invokes a skill slash command with `context: fork`, the CLI must call `interactiveSession.executeSkillCommand(...)`. The CLI may render a `skill-invocation` event, but it must not convert fork skills into plain prompt injection. This keeps fork execution deterministic and preserves the CLI as a thin TUI shell.

When a user asks in normal conversation to call or delegate to an agent, the request is handled by the model through the SDK-owned `Agent` tool. The CLI only displays the resulting tool execution events and final assistant response.

Background agent task lifecycle and progress are projected into `TuiStateManager.backgroundTasks` through the runtime-owned event union exposed as the SDK `background_task_event` event. Text deltas are accumulated into a short preview, and tool start/end events update the current action. React components must render this state only; they must not own task transition or cancellation logic.

`TuiStateManager` owns presentation-only visibility policy. Clean completed tasks remain visible as an unread completion notice until the next accepted user turn, then leave the always-visible background panel without calling `closeBackgroundTask()`. Failed, cancelled, non-zero exit, signal-terminated, and worktree/branch-bearing terminal tasks remain visible until explicit close or acknowledge. `/background list` and `/background read` continue to use the SDK runtime registry, so tasks hidden from the panel remain inspectable until runtime close or session cleanup.

`BackgroundTaskPanel` renders active and recently completed background tasks with a compact status marker, kind, label, task ID, unread marker, and a short preview. The status marker uses the panel's existing status colors instead of rendering status words in the always-visible task list. User controls are routed through SDK system commands:

| Command                               | Behavior                       |
| ------------------------------------- | ------------------------------ |
| `/background` or `/background list`   | List current background tasks  |
| `/background read <task-id> [offset]` | Read stdout/stderr log lines   |
| `/background cancel <task-id>`        | Cancel one queued/running task |
| `/background close <task-id>`         | Dismiss one terminal task      |

For implementation details of subagent/background execution (Agent tool, `context: fork` skills, background task manager, agent definition scanning), see the agent-sdk and agent-runtime SPEC files.

Background job groups are SDK-owned orchestration state. The TUI may render group view models derived from `background_job_group_event`, but it must not decide group completion, aggregate raw logs, trigger continuations, or own retry/wait behavior. Group waiting and summaries are exposed through SDK APIs and `/agent wait` command behavior.

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

`@robota-sdk/agent-cli` requires Node.js 22+ because Ink 7 requires Node.js 22 and React 19.2+.

| Package                                | Purpose                                                                                                    |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `@robota-sdk/agent-command-agent`      | Optional default `/agent` command module composed by the Robota binary                                     |
| `@robota-sdk/agent-sdk`                | `InteractiveSession`, `CommandRegistry`, command sources, plugin management, re-exported runtime contracts |
| `@robota-sdk/agent-core`               | Public types (`TPermissionMode`, `TToolArgs`, `TUniversalMessage`, etc.)                                   |
| `@robota-sdk/agent-provider-anthropic` | Default provider definition contributed by the Robota binary                                               |
| `@robota-sdk/agent-provider-openai`    | Default provider definition contributed by the Robota binary                                               |
| `@robota-sdk/agent-provider-gemma`     | Default provider definition contributed by the Robota binary                                               |
| `@robota-sdk/agent-transport-headless` | Headless runner for print mode (`-p`) execution                                                            |
| `ink` 7, `react` 19.2+                 | TUI rendering                                                                                              |
| `ink-select-input`                     | Arrow-key selection (permission prompt)                                                                    |
| `ink-spinner`                          | Loading spinner                                                                                            |
| `chalk`                                | Terminal colors                                                                                            |
| `ink-text-input`                       | Base text input (extended by CjkTextInput)                                                                 |
| `marked`, `marked-terminal`            | Markdown parsing and terminal rendering                                                                    |
| `cli-highlight`                        | Syntax highlighting for code blocks                                                                        |
| `string-width`                         | Unicode-aware string width calculation                                                                     |
