# CLI Reference

`@robota-sdk/agent-cli` is an interactive terminal AI coding assistant built on Robota SDK. It loads project context (AGENTS.md, CLAUDE.md) and provides a full TUI with tool execution, permission prompts, and context management.

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
robota --reset                      # Delete user settings and exit
robota --version                    # Show version
```

## Interactive TUI

The TUI (built with React + Ink) provides:

- **Message list** — Conversation history with markdown rendering
- **Input area** — Text input with slash command autocomplete
- **Status bar** — Permission mode, model, context usage %, message count
- **Permission prompts** — Arrow-key Allow/Deny selection for tool calls
- **Streaming** — Real-time text output as the model responds

## Slash Commands

Type `/` to trigger the autocomplete popup. Arrow keys to navigate, Enter to select.

| Command                   | Description                    |
| ------------------------- | ------------------------------ |
| `/help`                   | Show available commands        |
| `/clear`                  | Clear conversation history     |
| `/mode [mode]`            | Show or change permission mode |
| `/model [model]`          | Show or change AI model        |
| `/compact [instructions]` | Compress context window        |
| `/cost`                   | Show session info              |
| `/context`                | Context window details         |
| `/permissions`            | Show permission rules          |
| `/exit`                   | Exit CLI                       |
| `/plugin`                 | Plugin management              |
| `/reload-plugins`         | Reload all plugins             |
| `/language [lang]`        | Show or change UI language     |

`/mode` and `/model` show nested submenus for selection.

### Plugin Management

Plugins extend the CLI with additional skills, hooks, and tools. They are stored in `~/.robota/plugins/`.

**Marketplace commands:**

```bash
/plugin marketplace add <source>       # Add marketplace (shallow clones repo)
/plugin marketplace remove <name>      # Remove marketplace
/plugin marketplace list               # List registered marketplaces
/plugin marketplace update             # Update all marketplaces
```

**Plugin commands:**

```bash
/plugin install <name>@<marketplace>   # Install plugin from marketplace
/plugin uninstall <name>               # Uninstall plugin
/plugin enable <name>                  # Enable installed plugin
/plugin disable <name>                 # Disable installed plugin
```

Use `/reload-plugins` to reload all plugins without restarting the CLI.

### Model Change (`/model`)

Select a model from the submenu (e.g., `Claude Opus 4.6 (1M)`). A confirmation prompt appears warning that the CLI will restart. If confirmed, the new model is saved to `~/.robota/settings.json` and the CLI exits.

Model definitions come from the `CLAUDE_MODELS` registry in `@robota-sdk/agent-core`, which is the single source of truth for model IDs, names, and context window sizes.

### Skill Commands

Skills are discovered from multiple paths. `.agents/` is the primary Robota convention; `.claude/` paths provide Claude Code compatibility. At runtime, higher-priority paths override lower ones:

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

- **User direct**: Type `/skill-name` in the input area
- **Model auto-invoke**: The model calls the Skill tool during a conversation (unless `disable-model-invocation: true`)
- **Model-only**: Skills with `user-invocable: false` are invisible in the `/` menu but available to the model

When `context: fork` is set, the skill runs in a spawned subagent session rather than the main conversation. See [agent-sdk SPEC.md](../../packages/agent-sdk/docs/SPEC.md) for details.

## Permission Modes

| Mode                | Read | Write  | Bash   |
| ------------------- | ---- | ------ | ------ |
| `plan`              | auto | deny   | deny   |
| `default`           | auto | prompt | prompt |
| `acceptEdits`       | auto | auto   | prompt |
| `bypassPermissions` | auto | auto   | auto   |

When a tool requires approval, the TUI shows a permission prompt with arrow-key selection.

## Context Window

The status bar shows context usage with color coding:

| Range  | Color  | Meaning                         |
| ------ | ------ | ------------------------------- |
| 0–69%  | Green  | Healthy                         |
| 70–89% | Yellow | Approaching limit               |
| 90%+   | Red    | Near limit, compaction imminent |

Auto-compaction triggers at ~83.5% of the model's context window. Use `/compact` with optional instructions for manual compaction:

```
/compact focus on the API design decisions
```

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

## Session Logging

Events are logged to `.robota/logs/{sessionId}.jsonl` in JSONL format. Events include `session_init`, `pre_run`, `assistant`, `server_tool`, and `context`.

## First-Run Setup

When no settings file exists, the CLI prompts for an Anthropic API key (input is masked with asterisks) and creates `~/.robota/settings.json` with a minimal config. Use `robota --reset` to delete the settings file and return to the first-run state.

## Configuration

The CLI uses a layered configuration system. `.robota/` is the primary configuration convention; `.claude/` paths are supported as a Claude Code compatibility layer. Later layers override earlier ones:

1. `~/.robota/settings.json` (user global)
2. `.robota/settings.json` (project, primary)
3. `.robota/settings.local.json` (local override, gitignored)
4. `.claude/settings.json` (project, Claude Code compatible)
5. `.claude/settings.local.json` (local override, gitignored, Claude Code compatible)

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
- **Abort propagation**: `session.abort()` rejects the run promise but does not cancel the underlying provider API call.
