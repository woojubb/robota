# CLI Reference

`@robota-sdk/agent-cli` is a purely TUI layer built on `InteractiveSession` from `@robota-sdk/agent-sdk`. The CLI has no session logic of its own: the `useInteractiveSession` React hook subscribes to `InteractiveSession` events and translates them into React state. All session logic — command handling, prompt queuing, system commands, skill discovery — lives in the SDK layer.

State is managed by `TuiStateManager`, a pure TypeScript class (no React dependency) that receives SDK events and produces an immutable state snapshot. The `useInteractiveSession` hook wraps `TuiStateManager` and feeds its output into the React component tree via `useState`.

## Installation

```bash
npm install -g @robota-sdk/agent-cli
```

## Usage

```bash
robota                              # Interactive TUI
robota "initial prompt"             # TUI with initial message
robota -p "prompt"                  # Print mode (one-shot, exits after response)
robota -c                           # Continue last session
robota -r <session-id>              # Resume specific session
robota --model claude-opus-4-6      # Model override
robota --permission-mode plan       # Permission mode override
robota --max-turns 10               # Limit agentic turns
robota --output-format json         # Output format (text/json/stream-json)
robota --append-system-prompt "..." # Append to system prompt
robota --configure                  # Interactive provider setup
robota --provider qwen              # Run with a configured provider profile
robota --reset                      # Delete user settings and exit
robota --check-update               # Check npm for a newer CLI version and exit
robota --disable-update-check        # Skip startup update check for this run
robota --version                    # Show version
```

## CLI Updates

Robota checks npm package metadata for newer `@robota-sdk/agent-cli` versions and uses npm itself for updates. It does not include a self-updater.

```bash
robota --check-update
```

When a newer version is available, the CLI prints:

```bash
npm install -g '@robota-sdk/agent-cli@latest'
```

Startup checks are rate-limited by a user-level cache at `~/.robota/update-check.json`. They do not create or modify `~/.robota/settings.json`, and they can be skipped for one invocation with `--disable-update-check`.

## Non-Interactive (Headless) Mode

Print mode (`-p`) runs a single prompt without the interactive TUI and exits. It delegates to `@robota-sdk/agent-transport-headless` for output formatting. When the prompt starts with `/skill-name`, headless mode routes it through `InteractiveSession.executeUserSkillCommand()` so the SDK loads the full `SKILL.md` before the model turn.

### Output Formats

Use `--output-format` to control how the response is written to stdout:

**Text (default):**

```bash
robota -p "Explain this error"
# Prints plain text response to stdout
```

**JSON:**

```bash
robota -p "Summarize the project" --output-format json
# Output: { "type": "result", "result": "...", "session_id": "...", "subtype": "success" }
```

**Stream JSON (newline-delimited):**

```bash
robota -p "Write a function" --output-format stream-json
# Each line is a JSON object: content_block_delta events followed by a final result
```

### Stdin Pipe

When `-p` is specified without a positional argument and stdin is piped, the CLI reads from stdin:

```bash
echo "Explain this code" | robota -p
cat error.log | robota -p "What went wrong?"
git diff | robota -p "Review this diff" --output-format json
```

### System Prompt Append

```bash
robota -p "query" --append-system-prompt "Focus on security issues"
robota -p "query" --json-schema '{"type":"object"}'
```

### Exit Codes

| Code | Meaning |
| ---- | ------- |
| 0    | Success |
| 1    | Error   |

## Interactive TUI

The TUI (built with React + Ink) provides:

- **Message list** — Conversation history with markdown rendering
- **Input area** — Text input with slash command autocomplete
- **Status bar** — Permission mode, model, context usage %, message count, and activity state
- **Permission prompts** — Arrow-key Allow/Deny selection for tool calls
- **Streaming** — Real-time text output as the model responds
- **Usage summaries** — Provider usage and cost metadata when available
- **Background work tree** — Running and completed background jobs grouped for quick scanning
- **ESC abort** — Press ESC during streaming to cancel. Partial response is saved with interrupted state
- **History SSOT** — Renders from `IHistoryEntry[]` — the universal timeline of chat messages and session events

### Recent TUI Behavior

The CLI is intentionally a thin TUI over SDK-owned session state. Recent updates focus on making long agentic runs readable:

- Command output transcripts collapse automatically so long shell output does not dominate the conversation.
- Edit tool results render as context hunks with markdown-friendly diff blocks.
- Provider usage summaries appear in the primary scan path when token/cost metadata is present.
- Background subagent work renders as tree rows with status activity instead of a flat list.
- Print/headless mode skips startup update checks so scripted stdout/stderr remain deterministic.

### useInteractiveSession Hook

The `useInteractiveSession` hook is the sole bridge between `InteractiveSession` (SDK) and the React component tree. It:

1. Receives an `InteractiveSession` instance as its argument.
2. Passes SDK events (`text_delta`, `tool_start`, `tool_end`, `thinking`, `context_update`, `error`) to a `TuiStateManager` instance.
3. Exposes derived React state and actions (`submit`, `abort`, `cancelQueue`).

The state shape exposed to components includes `history: IHistoryEntry[]` — the universal timeline of chat messages and session events. Components render from this single list; there is no separate `messages` array.

`TuiStateManager` is a pure TypeScript class with no React dependency. It can be instantiated and tested independently of the component tree, making state transition logic fully unit-testable.

The CLI contains no session management logic beyond this hook. The old `useSession`, `useSubmitHandler`, `useSlashCommands`, `useCommandRegistry`, and `useMessages` hooks have been removed; session execution lives in `InteractiveSession`, and command discovery uses SDK-owned command registry/source classes.

## Slash Commands

Type `/` to trigger the autocomplete popup. Arrow keys to navigate, Tab to insert into input (without executing), Enter to execute immediately.

The available command list is built from SDK-owned command sources: `BuiltinCommandSource`, `SkillCommandSource`, `PluginCommandSource`, and command modules such as `agent-command-help`, `agent-command-agent`, `agent-command-provider`, `agent-command-plugin`, and `agent-command-exit`. The CLI renders this list but does not own the command definitions.

| Command                   | Description                             |
| ------------------------- | --------------------------------------- |
| `/help`                   | Show available commands                 |
| `/clear`                  | Clear conversation history              |
| `/mode [mode]`            | Show or change permission mode          |
| `/model [model]`          | Show or change AI model                 |
| `/compact [instructions]` | Compress context window                 |
| `/cost`                   | Show session info                       |
| `/context`                | Context window details                  |
| `/permissions`            | Show permission rules                   |
| `/memory`                 | Inspect and manage project memory       |
| `/rewind`                 | List and restore edit checkpoints       |
| `/provider`               | Manage provider profiles                |
| `/resume`                 | Resume a previous session               |
| `/background`             | List and control background tasks       |
| `/agent`                  | Run and manage background subagent jobs |
| `/rename`                 | Rename the current session              |
| `/validate-session`       | Validate replay-grade session log data  |
| `/exit`                   | Exit CLI                                |
| `/plugin`                 | Plugin management                       |
| `/reload-plugins`         | Reload all plugin resources             |
| `/language [lang]`        | Show or change UI language              |
| `/statusline`             | Show, hide, or reset status line fields |
| `/reset`                  | Delete settings and exit                |

`/mode` and `/model` show nested submenus for selection.

### Plugin Management

Plugins extend the CLI with additional skills, hooks, and tools. They are stored in `~/.robota/plugins/` (user scope) or `.robota/plugins/` (project scope).

**Interactive TUI (`/plugin`):**

Typing `/plugin` opens an interactive menu with arrow-key navigation:

```
Plugin Management
│
├─ Marketplace
│    ├─ Add Marketplace      → enter source (owner/repo or git URL)
│    └─ <marketplace-name>   → Browse plugins / Update / Remove
│         └─ Browse          → plugin list → Install (scope) or Uninstall
│
└─ Installed Plugins
     └─ <plugin-name>       → Uninstall (with confirmation)
```

Navigate with arrow keys, Enter to select, Esc to go back.

**Text subcommands** (also available when typed directly):

```bash
/plugin install <name>@<marketplace>   # Install plugin
/plugin uninstall <name>@<marketplace> # Uninstall plugin
/plugin enable <name>@<marketplace>    # Enable plugin
/plugin disable <name>@<marketplace>   # Disable plugin
/plugin marketplace add <source>       # Add marketplace source
/plugin marketplace remove <name>      # Remove marketplace
/plugin marketplace update <name>      # Update marketplace
/plugin marketplace list               # List registered marketplaces
```

Use `/reload-plugins` to reload plugin resources and refresh plugin-provided slash commands without restarting the CLI.

### Model Change (`/model`)

Select a model from the submenu (e.g., `Claude Opus 4.6 (1M)`). A confirmation prompt appears warning that the CLI will restart. If confirmed, the new model is saved to `~/.robota/settings.json` and the CLI exits.

Model definitions come from the `CLAUDE_MODELS` registry in `@robota-sdk/agent-core`, which is the single source of truth for model IDs, names, and context window sizes.

### Skill Commands

Skills are discovered by `SkillCommandSource` in `agent-sdk`. `.agents/` is the primary Robota convention; `.claude/` paths provide Claude Code compatibility. At runtime, higher-priority paths override lower ones:

1. `.agents/skills/` (project, Robota primary)
2. `.claude/skills/` (project, Claude Code compatible)
3. `.claude/commands/` (project, Claude Code legacy)
4. `~/.robota/skills/` (user)

Skills appear as additional slash commands below the built-in commands.

Plugin skills appear with a hint showing their source: `/audit (rulebased-harness) Run audit checks`
Plugin commands use colon format: `/rulebased-harness:audit`

### Skill Frontmatter

Each skill is a markdown file with YAML frontmatter controlling its behavior:

| Field                      | Type    | Description                                            |
| -------------------------- | ------- | ------------------------------------------------------ |
| `name`                     | string  | Display name for the slash command                     |
| `description`              | string  | One-line description shown in autocomplete             |
| `argument-hint`            | string  | Placeholder text for the argument (e.g., `<file>`)     |
| `disable-model-invocation` | boolean | If true, model cannot auto-invoke this skill           |
| `user-invocable`           | boolean | If false, only the model can invoke (not via `/` menu) |
| `allowed-tools`            | array   | Tool allowlist for the skill's execution context       |
| `model`                    | string  | Model override for skill execution                     |
| `effort`                   | string  | Reasoning effort level                                 |
| `context`                  | string  | Execution context; `fork` spawns a subagent            |
| `agent`                    | string  | Agent definition name for subagent execution           |

### Variable Substitution

Skill markdown bodies support variable substitution before execution:

- `$ARGUMENTS` / `$ARGUMENTS[N]` — Full argument string or Nth argument
- `$N` — Shorthand for Nth positional argument
- `${CLAUDE_SESSION_ID}` — Current session ID
- `${CLAUDE_SKILL_DIR}` — Directory containing the skill file

### Shell Preprocessing

Use the `` !`command` `` syntax to embed shell command output into the skill body at invocation time. The command runs in the project working directory.

### Invocation Methods

- **User direct**: Type `/skill-name` in the input area, or pass `/skill-name ...` to print/headless mode
- **User directive**: Prompts such as `Use the repo-writing skill ...` are treated as explicit user-directed skill activations and load the matching `SKILL.md` before the model turn
- **Skill discovery**: Use `/skills` to list registered skills and show the activation contract. Models can also call the SDK-owned `/skills` command through `ExecuteCommand` before choosing a matching skill.
- **Model auto-invoke**: The model calls `ExecuteSkill` during a conversation when a task matches the skill description. The tool accepts only registered model-invocable skill names for the session.
- **Model-only**: Skills with `user-invocable: false` are invisible in the `/` menu but available to the model

Skill descriptions are metadata only. Mentioning a skill name in ordinary assistant text does not
activate that skill; activation is recorded only when `ExecuteSkill` or an explicit `/skill-name`
invocation loads the full `SKILL.md`.

When `context: fork` is set, the skill runs in a spawned subagent session rather than the main conversation. See [agent-sdk SPEC.md](../../packages/agent-sdk/docs/SPEC.md) for details.

## Session Management

The CLI supports continuing, resuming, forking, and naming sessions for workflow continuity across invocations.

### Continue and Resume

```bash
robota -c                    # Continue the most recent session
robota -r <session-id>       # Resume a specific session by ID
robota -r <session-id> --fork-session # Fork a session (new session with copied history)
robota --name "my-task"      # Assign a name to the session at startup
```

Within the TUI, use `/resume` to list recent sessions and select one to resume. Use `/rename <name>` to rename the current session. Use `/validate-session` to validate the current JSONL session log for replay-grade provider/tool coverage.

### Session Names

When a session has a name, it is displayed in the input area border, the terminal title bar, and the status bar. Names make it easy to identify sessions when resuming later.

## Permission Modes

| Mode                | Read | Write  | Bash   |
| ------------------- | ---- | ------ | ------ |
| `plan`              | auto | deny   | deny   |
| `default`           | auto | prompt | prompt |
| `acceptEdits`       | auto | auto   | prompt |
| `bypassPermissions` | auto | auto   | auto   |

When a tool requires approval, the TUI shows a permission prompt with arrow-key selection.

The status bar hides `default` permission mode because it is the baseline. Non-default permission
modes remain visible as `Mode: plan`, `Mode: acceptEdits`, or `Mode: bypassPermissions`.

## Context Window

The status bar shows context usage with color coding:

| Range  | Color  | Meaning                         |
| ------ | ------ | ------------------------------- |
| 0–69%  | Green  | Healthy                         |
| 70–89% | Yellow | Approaching limit               |
| 90%+   | Red    | Near limit, compaction imminent |

Auto-compaction triggers at ~83.5% of the model's context window. A separate hard-capacity guard blocks only when effective usage is near the actual model limit and includes diagnostic values in the resulting message. Use `/compact` with optional instructions for manual compaction:

```
/compact focus on the API design decisions
```

## Prompt Queue

If you submit a prompt while the model is still executing (thinking), `InteractiveSession` queues the new prompt automatically. The input area border turns cyan to indicate a prompt is waiting. As soon as the current execution completes, the queued prompt is submitted automatically. Press Backspace while a prompt is queued to cancel it (calls `cancelQueue()` on the session).

## Input Navigation

The input area supports multi-line cursor movement. When input spans multiple rows, press Up/Down arrows to move the cursor to the previous or next display row within the input. This lets you navigate and edit long prompts without the cursor jumping out of the input box.

## Paste Handling

When pasting multiline text into the input area, the CLI collapses the content into a compact label:

```
[Pasted text #1 +42 lines]
```

Multiple pastes are numbered sequentially (`#1`, `#2`, etc.). The full pasted content is expanded when the prompt is submitted, so the AI receives the complete text. This keeps the input area readable while supporting large code blocks and log excerpts.

## Tool Display

Tool invocations in the TUI use a unified display format with status indicators:

| Status  | Symbol | Color                        | Meaning            |
| ------- | ------ | ---------------------------- | ------------------ |
| Running | ⟳      | Yellow                       | Tool is executing  |
| Success | ✓      | Green                        | Completed normally |
| Error   | ✗      | Red + strikethrough          | Execution failed   |
| Denied  | ⊘      | YellowBright + strikethrough | Permission denied  |

Long tool arguments are middle-truncated, keeping the last 30 characters visible for context.

### Edit Diff Display

When the Edit tool completes, the CLI renders a `DiffBlock` showing the change. The display format consists of a file path header followed by red (`-`) lines for removals and greenBright (`+`) lines for additions. A maximum of 10 lines are displayed; larger diffs are truncated with an `... and N more lines` indicator. No-op edits (where old and new strings are identical) are suppressed entirely.

### Subagent Execution

The AI can spawn subagents via the **Agent** tool to handle complex subtasks (e.g., exploring the codebase, planning multi-step changes). Subagents run in isolated sessions with their own tool access and inherit the parent session's hooks and permissions. Built-in agent types include `Explore`, `Plan`, and a general-purpose agent.

For explicit multi-agent or parallel-agent requests, the model-visible Agent tool now supports a `jobs` array. A single batch tool call starts all valid jobs before waiting for terminal summaries and returns structured per-job results with a shared group identifier. The older single-job `prompt` shape remains supported.

## Session Logging

Events are logged to `.robota/logs/{sessionId}.jsonl` in JSONL format. Events include `session_init`, `pre_run`, `text_delta`, `assistant`, `server_tool`, `context`, and `background_task_event`.

The session log also records execution-boundary events emitted by the core run loop: `provider_request`, `provider_native_raw_payload`, `provider_response_raw`, `provider_response_normalized`, `assistant_message_committed`, `tool_batch_started`, `tool_execution_request`, and `tool_execution_result`. Provider packages own the exact native SDK request, response, and stream payload objects; the core routes them through provider-neutral events, and the session logger redacts or externalizes large payloads before writing JSONL.

Use `/validate-session` to check that the current session log has replay-grade provider/tool coverage, including provider-native raw response or stream payload events paired with each provider request.

Background subagents write append-only transcripts to `.robota/logs/{sessionId}/subagents/{agentId}.jsonl`. These transcripts include streaming deltas, tool calls/results, final output, and errors as they occur. The resumable `.robota/sessions/{sessionId}.json` file stores background task snapshots and transcript paths, not every token chunk.

## First-Run Setup

When no usable settings file exists, the CLI prompts for an Anthropic API key (input is masked with asterisks) and creates `~/.robota/settings.json` with a minimal config. Use `robota --reset` to delete the settings file and return to the first-run state. OpenAI-compatible local profiles can be configured manually without using the first-run Anthropic prompt.

## Configuration

The CLI uses a layered configuration system. `.robota/` is the primary configuration convention; `.claude/` paths are supported as a Claude Code compatibility layer. Later layers override earlier ones:

1. `~/.robota/settings.json` (user global)
2. `~/.claude/settings.json` (user global, Claude Code compatible)
3. `.robota/settings.json` (project, primary)
4. `.robota/settings.local.json` (local override, gitignored)
5. `.claude/settings.json` (project, Claude Code compatible)
6. `.claude/settings.local.json` (local override, gitignored, Claude Code compatible)

The `.claude/` paths take higher runtime priority so that Claude Code settings override `.robota/` defaults.

See [Using the SDK — Configuration](./sdk.md#configuration) for the full config format.

## Tool Output Limits

- Tool output is capped at 30,000 characters (middle-truncated)
- Glob tool defaults to a maximum of 1,000 entries per invocation

## Memory Management

The TUI applies several optimizations to keep memory usage bounded during long sessions:

- **Message windowing**: Only the most recent `MAX_RENDERED_MESSAGES` (100) messages are rendered in the React tree. Older messages are removed from the DOM but retained in session state.
- **Tool state cleanup**: Completed tool results beyond `MAX_COMPLETED_TOOLS` (50) have their detailed state cleared to reduce memory pressure.
- **React.memo**: `MessageItem` components are wrapped with `React.memo` to prevent unnecessary re-renders when new messages arrive.

See [agent-cli SPEC.md](../../packages/agent-cli/docs/SPEC.md) for implementation details.

## Known Limitations

- **Korean IME + macOS Terminal.app crash**: Korean/CJK IME input may crash macOS Terminal.app due to an Ink raw mode + Terminal.app IME interaction bug. **Use [iTerm2](https://iterm2.com/) instead.** This is a known industry-wide issue shared with Claude Code (issues #22732, #3045). A custom `CjkTextInput` component mitigates common issues but cannot prevent the Terminal.app crash.
- **Abort propagation**: `session.abort()` triggers an AbortSignal that flows through the entire chain (Session -> Robota -> Provider). The provider returns partial content with `state: 'interrupted'`. Streaming renders are debounced at 16ms. Interrupted responses display "Interrupted by user." and failed requests display "Request failed:" messages. The "Thinking..." indicator has been removed; a "Waiting for response... (ESC to interrupt)" message is shown instead.
