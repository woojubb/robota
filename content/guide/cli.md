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

`/mode` and `/model` show nested submenus for selection.

### Model Change (`/model`)

Select a model from the submenu (e.g., `Claude Opus 4.6 (1M)`). A confirmation prompt appears warning that the CLI will restart. If confirmed, the new model is saved to `~/.robota/settings.json` and the CLI exits.

Model definitions come from the `CLAUDE_MODELS` registry in `@robota-sdk/agent-core`, which is the single source of truth for model IDs, names, and context window sizes.

### Skill Commands

Skills discovered from `.agents/skills/*/SKILL.md` (project) and `~/.claude/skills/*/SKILL.md` (user) appear as additional slash commands below the built-in commands.

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

## Session Logging

Events are logged to `.robota/logs/{sessionId}.jsonl` in JSONL format. Events include `session_init`, `pre_run`, `assistant`, `server_tool`, and `context`.

## First-Run Setup

When no settings file exists, the CLI prompts for an Anthropic API key (input is masked with asterisks) and creates `~/.robota/settings.json` with a minimal config. Use `robota --reset` to delete the settings file and return to the first-run state.

## Configuration

The CLI uses the same 3-layer configuration as the SDK:

1. `~/.robota/settings.json` (user global)
2. `.robota/settings.json` (project)
3. `.robota/settings.local.json` (local override, gitignored)

See [Using the SDK — Configuration](./sdk.md#configuration) for the full config format.

## Tool Output Limits

- Tool output is capped at 30,000 characters (middle-truncated)
- Glob tool defaults to a maximum of 1,000 entries per invocation

## Known Limitations

- **Korean IME + macOS Terminal.app crash**: Korean/CJK IME input may crash macOS Terminal.app due to an Ink raw mode + Terminal.app IME interaction bug. **Use [iTerm2](https://iterm2.com/) instead.** This is a known industry-wide issue shared with Claude Code (issues #22732, #3045). A custom `CjkTextInput` component mitigates common issues but cannot prevent the Terminal.app crash.
- **Abort propagation**: `session.abort()` rejects the run promise but does not cancel the underlying provider API call.
