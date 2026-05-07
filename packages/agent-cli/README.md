# @robota-sdk/agent-cli

AI coding assistant CLI built on Robota SDK. Loads AGENTS.md/CLAUDE.md for project context and provides a tool-calling REPL with Claude Code-compatible permission modes.

## Installation

Requires Node.js 22+.

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

| Variable            | Description                                    | Required       |
| ------------------- | ---------------------------------------------- | -------------- |
| `ANTHROPIC_API_KEY` | Anthropic API key for the `anthropic` provider | Anthropic only |
| `DASHSCOPE_API_KEY` | Alibaba Cloud Model Studio key for `qwen`      | Qwen only      |

Set your key before running:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

## Development Setup (Monorepo)

```bash
# Build dependencies and CLI
pnpm build:deps
pnpm --filter @robota-sdk/agent-cli build
```

## Usage (Monorepo)

```bash
# From monorepo root
cd packages/agent-cli

# Development mode (no build needed)
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
robota --output-format <fmt>        # text | json | stream-json (print mode)
robota --system-prompt <text>       # Replace system prompt (print mode)
robota --append-system-prompt <text> # Append to system prompt (print mode)
robota --reset                      # Delete user settings and exit
robota --check-update               # Check npm for a newer CLI version and exit
robota --disable-update-check        # Skip interactive startup update check for this run
robota --version                    # Show version
```

### CLI Updates

Robota can check npm for a newer `@robota-sdk/agent-cli` version:

```bash
robota --check-update
```

When an update is available, Robota prints the npm global install command:

```bash
npm install -g '@robota-sdk/agent-cli@latest'
```

Robota does not implement its own updater and does not modify `~/.robota/settings.json` for update checks. Interactive startup checks use a user-level operational cache at `~/.robota/update-check.json` and can be skipped for one run with `--disable-update-check`. Print/headless mode (`robota -p`) does not perform automatic startup update checks so scripted stdout and stderr remain deterministic.

### Print Mode Output Formats

Print mode (`-p`) supports three output formats via `--output-format`:

| Format        | Description                                                        |
| ------------- | ------------------------------------------------------------------ |
| `text`        | Plain text response to stdout (default)                            |
| `json`        | Single JSON object: `{ type, result, session_id, subtype }`        |
| `stream-json` | Newline-delimited JSON with `content_block_delta` streaming events |

### Stdin Pipe

When `-p` is used without a positional argument and stdin is piped, the CLI reads from stdin:

```bash
echo "Explain this error" | robota -p
cat file.ts | robota -p "Review this code" --output-format json
git diff | robota -p "Summarize changes" --output-format stream-json
```

## First-Run Setup

When no usable settings file exists, the CLI prompts for:

1. **Provider selection** from the providers assembled into the CLI binary
2. **Provider-specific setup fields** such as model, base URL, and masked API key
3. **Response language** (ko/en/ja/zh, default: en)

Creates `~/.robota/settings.json`. Use `robota --reset` to return to first-run state.

Provider setup is generated from provider definitions. The default CLI build includes Anthropic, OpenAI-compatible, Gemma, and Qwen providers; other embeddings can inject their own provider definitions.
Interactive setup creates a readable profile key from the selected model id, such as
`claude-sonnet-4-6` or `gpt-4o`, and appends `-2`, `-3`, etc. when that key already exists. Generated
profile keys never include API keys or credential hints.

Non-interactive/headless mode never prompts. Configure a provider ahead of time with `robota --configure` in an interactive terminal, or use `robota --configure-provider <profile> --type <type> ... --set-current`.

## Built-in Tools

The AI agent can invoke 8 local tools:

| Tool        | Description                          | Primary Argument |
| ----------- | ------------------------------------ | ---------------- |
| `Bash`      | Execute shell commands               | `command`        |
| `Read`      | Read file contents with line numbers | `filePath`       |
| `Write`     | Write content to a file              | `filePath`       |
| `Edit`      | Replace a string in a file           | `filePath`       |
| `Glob`      | Find files matching a pattern        | `pattern`        |
| `Grep`      | Search file contents with regex      | `pattern`        |
| `WebFetch`  | Fetch URL content as text            | `url`            |
| `WebSearch` | Search the internet                  | `query`          |

## Recent TUI Capabilities

- Provider setup is generated from provider definitions, so the default CLI build can configure Anthropic, OpenAI-compatible, Gemma, and Qwen profiles without provider-specific UI branches.
- Interactive startup can check npm for newer CLI versions; print/headless mode skips startup update checks to keep scripted output deterministic.
- Long-running sessions show provider usage summaries, status activity, background job tree rows, and collapsed command-output transcripts.
- Edit results render as context hunks with markdown-friendly diff blocks.
- Background subagents are real runtime jobs with transcripts and resumable task snapshots.
- Explicit multi-agent requests use the `/agent` command module batch path through the SDK runtime.

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

Use the `/permissions` slash command:

```
> /permissions                    # Show current mode and session-approved tools
> /permissions plan               # Switch to plan (read-only)
> /permissions bypassPermissions  # Skip all prompts
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
- **StatusBar** — displayed alongside activity, model, and context usage

## Slash Commands

| Command                   | Description                                                            |
| ------------------------- | ---------------------------------------------------------------------- |
| `/help`                   | Show available commands                                                |
| `/clear`                  | Clear conversation history                                             |
| `/model [model]`          | Select AI model (confirmation prompt, CLI restarts)                    |
| `/language [lang]`        | Set response language (ko, en, ja, zh), saves and restarts             |
| `/compact [instructions]` | Compress context window                                                |
| `/cost`                   | Show session info                                                      |
| `/context`                | Context window details, reference inventory, and auto-compact controls |
| `/agent`                  | Run and manage background subagent jobs                                |
| `/permissions [mode]`     | Show permission rules or change permission mode                        |
| `/plugin [subcommand]`    | Plugin management                                                      |
| `/resume`                 | List recent sessions and resume one                                    |
| `/rename <name>`          | Rename the current session                                             |
| `/exit`                   | Exit CLI                                                               |

Typing `/` triggers an autocomplete popup with arrow-key navigation and Esc to dismiss. Tab inserts the highlighted command into the input field without executing — continue typing args or press Enter to execute. Enter selects and executes immediately. Commands with subcommands (e.g., `/permissions`, `/model`) show a nested submenu. Skill commands discovered from `.agents/skills/` and `.claude/commands/` appear alongside built-in commands.

## Plugin Management

The `/plugin` command opens an interactive TUI or runs plugin operations through the injected plugin command module:

| Subcommand                               | Description                           |
| ---------------------------------------- | ------------------------------------- |
| `/plugin` or `/plugin manage`            | Open the plugin manager TUI           |
| `/plugin install <name>@<marketplace>`   | Install a plugin from a marketplace   |
| `/plugin uninstall <name>@<marketplace>` | Remove an installed plugin            |
| `/plugin enable <name>@<marketplace>`    | Enable a disabled plugin              |
| `/plugin disable <name>@<marketplace>`   | Disable a plugin without uninstalling |
| `/plugin marketplace add <source>`       | Add a marketplace source              |
| `/plugin marketplace remove <name>`      | Remove a marketplace source           |
| `/plugin marketplace update <name>`      | Update a marketplace source           |
| `/plugin marketplace list`               | List configured marketplace sources   |

## Configuration

Settings are merged in this order, from lowest to highest priority:

1. `~/.robota/settings.json` (user global)
2. `~/.claude/settings.json` (user global, Claude Code compatible)
3. `.robota/settings.json` (project, shared)
4. `.robota/settings.local.json` (local, gitignored)
5. `.claude/settings.json` (project, Claude Code compatible)
6. `.claude/settings.local.json` (local, gitignored, Claude Code compatible)

```json
{
  "defaultMode": "default",
  "language": "en",
  "currentProvider": "qwen-plus",
  "providers": {
    "qwen-plus": {
      "type": "qwen",
      "model": "qwen-plus",
      "apiKey": "$ENV:DASHSCOPE_API_KEY",
      "baseURL": "https://dashscope-intl.aliyuncs.com/compatible-mode/v1"
    },
    "supergemma4-26b-uncensored-v2": {
      "type": "gemma",
      "model": "supergemma4-26b-uncensored-v2",
      "apiKey": "lm-studio",
      "baseURL": "http://localhost:1234/v1"
    },
    "gpt-4o": {
      "type": "openai",
      "model": "gpt-4o",
      "apiKey": "$ENV:OPENAI_API_KEY"
    },
    "claude-sonnet-4-6": {
      "type": "anthropic",
      "model": "claude-sonnet-4-6",
      "apiKey": "$ENV:ANTHROPIC_API_KEY"
    }
  },
  "permissions": {
    "allow": ["Bash(pnpm *)"],
    "deny": ["Bash(rm -rf *)"]
  }
}
```

`currentProvider` selects a profile key from `providers`. The key is the stable profile identity, not
the provider type; multiple profile keys may use the same provider type and model when they represent
different credentials, endpoints, accounts, or operational defaults. Qwen Model Studio profiles use
`type: "qwen"` with a DashScope-compatible `baseURL`; the API key is usually stored as
`$ENV:DASHSCOPE_API_KEY`. Gemma-family LM Studio models use `type: "gemma"` so Robota can apply
Gemma-specific channel-marker projection while still talking to the OpenAI-compatible
`/v1/chat/completions` API through `baseURL`. Generic OpenAI-compatible profiles use
`type: "openai"` and do not apply provider-specific projection. Use `--provider <profile>` for a
one-shot invocation override; add `--set-current` only when the selected profile should become the
persisted default. The legacy single-provider shape remains supported:

```json
{
  "provider": {
    "name": "anthropic",
    "model": "claude-sonnet-4-6",
    "apiKey": "$ENV:ANTHROPIC_API_KEY"
  }
}
```

## Context Discovery

The CLI automatically discovers and loads:

- **AGENTS.md** — walking up from cwd to filesystem root
- **CLAUDE.md** — same walk-up discovery
- **Project metadata** — from `package.json`, `tsconfig.json`

All context is assembled into the system prompt.

Ordinary prompts may also reference workspace-local files with path-like `@file` tokens, for
example `@AGENTS.md` or `@docs/SPEC.md`. The CLI passes those prompts through unchanged; the SDK
resolves bounded file content under the active `cwd`, sends the enriched prompt to the model, and
records a structured file-reference event in the session history.

## Memory Management

- **Message windowing** — React state keeps the most recent 100 messages. Older messages are dropped from the render tree; full history remains in the session store.
- **Tool state cleanup** — Completed tool execution states are trimmed to the most recent 50 entries.
- **React.memo** — `MessageItem` uses `React.memo` to skip redundant re-renders.

## Session Logging

Session logs are written to `.robota/logs/{sessionId}.jsonl` in JSONL format by default, capturing structured events for diagnostics and replay. Background task lifecycle/progress events are logged there as they happen. Child-process subagents also write append-only transcripts to `.robota/logs/{sessionId}/subagents/{agentId}.jsonl`, including streaming text deltas while the local provider request is still running.

Resumable session JSON is written to `.robota/sessions/{sessionId}.json` for the current project and includes messages, UI history, the exact system prompt, registered tool schemas, and background task snapshots. High-frequency streaming chunks stay in JSONL transcript files; the session JSON stores task state and transcript paths.

## Architecture

The CLI is a pure TUI layer. All business logic lives in `@robota-sdk/agent-sdk`'s `InteractiveSession`. `useInteractiveSession` is the sole React↔SDK bridge, converting SDK events to React state.

```
bin.ts → cli.ts (arg parsing)
              └── ui/render.tsx → App.tsx (thin JSX shell)
                    ├── useInteractiveSession  (ONLY React↔SDK bridge)
                    │   ├── InteractiveSession (SDK)
                    │   ├── CommandRegistry    (SDK, re-exported by CLI)
                    │   │   ├── BuiltinCommandSource  (SDK, empty by default)
                    │   │   ├── agent-command-skills  (/skills command + virtual skill aliases)
                    │   │   ├── PluginCommandSource   (SDK, plugin skills)
                    │   │   └── ICommandModule sources (/help, /compact, ...)
                    │   └── SystemCommandExecutor (SDK)
                    ├── plugin-hooks-merger.ts (merges plugin hooks into SDK config)
                    ├── MessageList.tsx
                    ├── InputArea.tsx          (CjkTextInput, bracketed paste, slash detection)
                    ├── StatusBar.tsx          (activity, conditional mode, model, context %)
                    ├── PermissionPrompt.tsx   (arrow-key Allow/Deny)
                    ├── SlashAutocomplete.tsx  (command popup with scroll)
                    ├── DiffBlock.tsx          (Edit tool diff display)
                    ├── MenuSelect.tsx         (arrow-key menu, Plugin TUI)
                    ├── PluginTUI.tsx          (plugin management screen stack)
                    ├── TextPrompt.tsx         (text input for Plugin TUI)
                    └── ConfirmPrompt.tsx      (reusable yes/no prompt)
```

## Dependencies

| Package                                | Purpose                                    |
| -------------------------------------- | ------------------------------------------ |
| `@robota-sdk/agent-sdk`                | Session factory, query, config, context    |
| `@robota-sdk/agent-core`               | Types (TPermissionMode, TToolArgs)         |
| `@robota-sdk/agent-transport-headless` | Headless runner for print mode (`-p`)      |
| `ink` 7, `react` 19.2+                 | TUI rendering                              |
| `ink-select-input`                     | Arrow-key selection (permission prompt)    |
| `ink-spinner`                          | Loading spinner                            |
| `chalk`                                | Terminal colors                            |
| `ink-text-input`                       | Base text input (extended by CjkTextInput) |
| `marked`, `marked-terminal`            | Markdown parsing and terminal rendering    |
| `cli-highlight`                        | Syntax highlighting for code blocks        |
| `string-width`                         | Unicode-aware string width (CJK support)   |

## Documentation

See [docs/SPEC.md](./docs/SPEC.md) for the full specification, architecture details, and design decisions.

## License

MIT
