# @robota-sdk/agent-cli

AI coding assistant CLI built on Robota SDK. Loads AGENTS.md/CLAUDE.md for project context and provides a tool-calling REPL with Claude Code-compatible permission modes.

**Version**: 3.0.0-beta.40

## Installation

```bash
# Global install
npm install -g @robota-sdk/agent-cli

# Or run directly with npx
npx @robota-sdk/agent-cli
```

> **macOS users**: Korean/CJK IME input may crash macOS Terminal.app. Use **[iTerm2](https://iterm2.com/)** instead. This is a known Ink + Terminal.app issue shared with Claude Code.

After installing globally, the `robota` command is available system-wide:

```bash
robota                        # Interactive REPL
robota "prompt"               # REPL with initial prompt
robota -p "List all files"    # Print mode (one-shot, exit after response)
```

### Environment Variables

| Variable            | Description       | Required |
| ------------------- | ----------------- | -------- |
| `ANTHROPIC_API_KEY` | Anthropic API key | Yes      |

Set your key before running:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

## Development Setup (Monorepo)

```bash
# 1. Copy .env.example and add your Anthropic API key
cp packages/agent-cli/.env.example packages/agent-cli/.env
# Edit .env and set ANTHROPIC_API_KEY=sk-ant-...

# 2. Build dependencies and CLI
pnpm build:deps
pnpm --filter @robota-sdk/agent-cli build
```

## Usage (Monorepo)

```bash
# From monorepo root
cd packages/agent-cli

# Development mode (no build needed, auto-loads .env)
pnpm dev

# Production mode (requires build)
pnpm start

# With arguments
pnpm dev -- --version
pnpm dev -- --permission-mode plan
pnpm dev -- -p "List all TypeScript files in src/"
```

## CLI Flags

```
robota                              # Interactive REPL (default mode)
robota "prompt"                     # REPL with initial prompt
robota -p "prompt"                  # Print mode (one-shot, exit after response)
robota -c                           # Continue last session
robota -r <session-id>              # Resume session by ID
robota --model <model>              # Model override (e.g., claude-sonnet-4-6)
robota --language <lang>            # Response language (ko, en, ja, zh)
robota --permission-mode <mode>     # plan | default | acceptEdits | bypassPermissions
robota --max-turns <n>              # Limit agentic turns per interaction
robota --reset                      # Delete user settings and exit
robota --version                    # Show version
```

## First-Run Setup

When no settings file exists, the CLI prompts for:

1. **Anthropic API key** (input masked with asterisks)
2. **Response language** (ko/en/ja/zh, default: en)

Creates `~/.robota/settings.json`. Use `robota --reset` to return to first-run state.

## Built-in Tools

The AI agent can invoke 6 tools:

| Tool    | Description                          | Primary Argument |
| ------- | ------------------------------------ | ---------------- |
| `Bash`  | Execute shell commands               | `command`        |
| `Read`  | Read file contents with line numbers | `filePath`       |
| `Write` | Write content to a file              | `filePath`       |
| `Edit`  | Replace a string in a file           | `filePath`       |
| `Glob`  | Find files matching a pattern        | `pattern`        |
| `Grep`  | Search file contents with regex      | `pattern`        |

## Permission System

Every tool call passes through a three-step permission gate:

1. **Deny list** — if any deny pattern matches, the action is blocked
2. **Allow list** — if any allow pattern matches, the action is auto-approved
3. **Mode policy** — the active permission mode determines the decision

### Permission Modes

| Mode                | Read/Glob/Grep | Write/Edit |  Bash   |
| ------------------- | :------------: | :--------: | :-----: |
| `plan`              |      auto      |    deny    |  deny   |
| `default`           |      auto      |  approve   | approve |
| `acceptEdits`       |      auto      |    auto    | approve |
| `bypassPermissions` |      auto      |    auto    |  auto   |

### Changing Mode at Runtime

Use the `/mode` slash command:

```
> /mode                    # Show current mode
> /mode plan               # Switch to plan (read-only)
> /mode bypassPermissions  # Skip all prompts
```

Or set it at startup:

```bash
robota --permission-mode plan
```

### Permission Patterns

Configure in `.robota/settings.json` or `.robota/settings.local.json`:

```json
{
  "permissions": {
    "allow": ["Bash(pnpm *)", "Bash(git status)", "Read(/src/**)"],
    "deny": ["Bash(rm -rf *)", "Write(.env)"]
  }
}
```

Pattern syntax: `ToolName` matches any invocation; `ToolName(pattern)` matches on the primary argument with shell-style globs (`*`, `**`).

## Keyboard Controls

| Key        | Action                                                      |
| ---------- | ----------------------------------------------------------- |
| Enter      | Submit input                                                |
| ESC        | Abort current execution (graceful — saves partial response) |
| Ctrl+C     | Exit process immediately                                    |
| Up/Down    | Navigate visual lines in wrapped multi-line input           |
| Arrow keys | Navigate slash command autocomplete, permission prompt      |

## Paste Handling

Bracketed paste mode (DECSET 2004) is enabled on startup. When pasting multiline text, the input area collapses it into a label: `[Pasted text #1 +42 lines]`. Multiple pastes are numbered sequentially. The full content is expanded on submit.

Single-line paste is inserted directly as typed text. Terminals without bracketed paste fall back to heuristic detection.

## Edit Diff Display

After the Edit tool runs, a `DiffBlock` component renders the change inline:

```
  ✓ Edit(src/provider.ts)
    │ src/provider.ts
    │ - const DEFAULT_MAX_TOKENS = 4096;
    │ + const maxTokens = getModelMaxOutput(modelId);
```

Removed lines appear in red with `-`, added lines in green with `+`. Diffs longer than 10 lines show the first 8 + a `... and N more lines` summary.

## Session Management

The CLI supports continuing, resuming, forking, and naming sessions.

### CLI Flags

| Flag                  | Description                                      |
| --------------------- | ------------------------------------------------ |
| `-c`, `--continue`    | Continue the most recent session                 |
| `-r`, `--resume <id>` | Resume a specific session by ID                  |
| `--fork-session <id>` | Fork a session (new session with copied history) |
| `--name <name>`       | Assign a name to the session at startup          |

### TUI Commands

| Command          | Description                         |
| ---------------- | ----------------------------------- |
| `/resume`        | List recent sessions and resume one |
| `/rename <name>` | Rename the current session          |

### Session Name Display

When a session has a name, it appears in three places:

- **Input border** — session name shown in the input area border
- **Terminal title** — updated via ANSI escape sequences
- **StatusBar** — displayed alongside mode, model, and context usage

## Slash Commands

| Command                   | Description                                                |
| ------------------------- | ---------------------------------------------------------- |
| `/help`                   | Show available commands                                    |
| `/clear`                  | Clear conversation history                                 |
| `/mode [mode]`            | Show or change permission mode                             |
| `/model [model]`          | Select AI model (confirmation prompt, CLI restarts)        |
| `/language [lang]`        | Set response language (ko, en, ja, zh), saves and restarts |
| `/compact [instructions]` | Compress context window                                    |
| `/cost`                   | Show session info                                          |
| `/context`                | Context window details                                     |
| `/permissions`            | Show permission rules                                      |
| `/plugin [subcommand]`    | Plugin management TUI                                      |
| `/resume`                 | List recent sessions and resume one                        |
| `/rename <name>`          | Rename the current session                                 |
| `/exit`                   | Exit CLI                                                   |

Typing `/` triggers an autocomplete popup with arrow-key navigation, Tab completion, and Esc to dismiss. Commands with subcommands (e.g., `/mode`, `/model`) show a nested submenu. Skill commands discovered from `.agents/skills/` and `.claude/commands/` appear alongside built-in commands.

## Plugin Management

The `/plugin` command opens an interactive TUI for managing bundle plugins:

| Subcommand                 | Description                                      |
| -------------------------- | ------------------------------------------------ |
| `/plugin install <name>`   | Install a plugin from marketplace or local path  |
| `/plugin uninstall <name>` | Remove an installed plugin                       |
| `/plugin enable <name>`    | Enable a disabled plugin                         |
| `/plugin disable <name>`   | Disable a plugin without uninstalling            |
| `/plugin list`             | List installed plugins with status               |
| `/plugin marketplace`      | Browse available plugins from configured sources |

## Configuration

Settings are loaded from (highest priority first):

1. `.robota/settings.local.json` (local, gitignored)
2. `.robota/settings.json` (project, shared)
3. `.claude/settings.json` (project, Claude Code compatible)
4. `~/.robota/settings.json` (user global)
5. `~/.claude/settings.json` (user global, Claude Code compatible)

```json
{
  "defaultMode": "default",
  "language": "en",
  "provider": {
    "name": "anthropic",
    "model": "claude-sonnet-4-6",
    "apiKey": "$ENV:ANTHROPIC_API_KEY"
  },
  "permissions": {
    "allow": ["Bash(pnpm *)"],
    "deny": ["Bash(rm -rf *)"]
  }
}
```

## Context Discovery

The CLI automatically discovers and loads:

- **AGENTS.md** — walking up from cwd to filesystem root
- **CLAUDE.md** — same walk-up discovery
- **Project metadata** — from `package.json`, `tsconfig.json`

All context is assembled into the system prompt.

## Memory Management

- **Message windowing** — React state keeps the most recent 100 messages. Older messages are dropped from the render tree; full history remains in the session store.
- **Tool state cleanup** — Completed tool execution states are trimmed to the most recent 50 entries.
- **React.memo** — `MessageItem` uses `React.memo` to skip redundant re-renders.

## Session Logging

Session logs are written to `.robota/logs/{sessionId}.jsonl` in JSONL format by default, capturing structured events for diagnostics and replay.

## Architecture

The CLI is a pure TUI layer. All business logic lives in `@robota-sdk/agent-sdk`'s `InteractiveSession`. `useInteractiveSession` is the sole React↔SDK bridge, converting SDK events to React state.

```
bin.ts → cli.ts (arg parsing)
              └── ui/render.tsx → App.tsx (thin JSX shell)
                    ├── useInteractiveSession  (ONLY React↔SDK bridge)
                    │   ├── InteractiveSession (SDK)
                    │   ├── CommandRegistry    (SDK, re-exported by CLI)
                    │   │   ├── BuiltinCommandSource  (SDK)
                    │   │   ├── SkillCommandSource    (SDK, discovers from 4 paths)
                    │   │   └── PluginCommandSource   (CLI-local)
                    │   └── SystemCommandExecutor (SDK)
                    ├── plugin-hooks-merger.ts (merges plugin hooks into SDK config)
                    ├── MessageList.tsx
                    ├── InputArea.tsx          (CjkTextInput, bracketed paste, slash detection)
                    ├── StatusBar.tsx          (mode, model, context %, message count)
                    ├── PermissionPrompt.tsx   (arrow-key Allow/Deny)
                    ├── SlashAutocomplete.tsx  (command popup with scroll)
                    ├── DiffBlock.tsx          (Edit tool diff display)
                    ├── MenuSelect.tsx         (arrow-key menu, Plugin TUI)
                    ├── PluginTUI.tsx          (plugin management screen stack)
                    ├── TextPrompt.tsx         (text input for Plugin TUI)
                    └── ConfirmPrompt.tsx      (reusable yes/no prompt)
```

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
| `string-width`              | Unicode-aware string width (CJK support)   |

## Documentation

See [docs/SPEC.md](./docs/SPEC.md) for the full specification, architecture details, and design decisions.

## License

MIT
