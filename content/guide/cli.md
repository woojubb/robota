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

Skills are discovered from multiple paths in priority order:

1. `.claude/skills/` (project)
2. `.claude/commands/` (project, legacy)
3. `~/.robota/skills/` (user)
4. `.agents/skills/` (project)

Skills appear as additional slash commands below the built-in commands.

Plugin skills appear with a hint showing their source: `/audit (rulebased-harness) Run audit checks`
Plugin commands use colon format: `/rulebased-harness:audit`

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

When the Edit tool completes, the CLI renders a `DiffBlock` showing the change with `+`/`-` line markers (green for additions, red for removals). This provides immediate visual feedback on file modifications without needing to open the file separately.

### Subagent Execution

The AI can spawn subagents via the **Agent** tool to handle complex subtasks (e.g., exploring the codebase, planning multi-step changes). Subagents run in isolated sessions with their own tool access and inherit the parent session's hooks and permissions. Built-in agent types include `Explore`, `Plan`, and a general-purpose agent.

## Session Logging

Events are logged to `.robota/logs/{sessionId}.jsonl` in JSONL format. Events include `session_init`, `pre_run`, `assistant`, `server_tool`, and `context`.

## First-Run Setup

When no settings file exists, the CLI prompts for an Anthropic API key (input is masked with asterisks) and creates `~/.robota/settings.json` with a minimal config. Use `robota --reset` to delete the settings file and return to the first-run state.

## Configuration

The CLI uses a layered configuration system (highest priority last):

1. `~/.robota/settings.json` (user global)
2. `.robota/settings.json` (project)
3. `.robota/settings.local.json` (local override, gitignored)
4. `.claude/settings.json` (project, Claude Code compatible)
5. `.claude/settings.local.json` (local override, gitignored, Claude Code compatible)

The `.claude/` paths provide compatibility with Claude Code configuration conventions and take higher priority than `.robota/` paths.

See [Using the SDK — Configuration](./sdk.md#configuration) for the full config format.

## Tool Output Limits

- Tool output is capped at 30,000 characters (middle-truncated)
- Glob tool defaults to a maximum of 1,000 entries per invocation

## Known Limitations

- **Korean IME + macOS Terminal.app crash**: Korean/CJK IME input may crash macOS Terminal.app due to an Ink raw mode + Terminal.app IME interaction bug. **Use [iTerm2](https://iterm2.com/) instead.** This is a known industry-wide issue shared with Claude Code (issues #22732, #3045). A custom `CjkTextInput` component mitigates common issues but cannot prevent the Terminal.app crash.
- **Abort propagation**: `session.abort()` rejects the run promise but does not cancel the underlying provider API call.
