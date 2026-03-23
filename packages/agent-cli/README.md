# @robota-sdk/agent-cli

AI coding assistant CLI built on Robota SDK. Loads AGENTS.md/CLAUDE.md for project context and provides tool-calling REPL with Claude Code-compatible permission modes.

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
robota --permission-mode <mode>     # plan | default | acceptEdits | bypassPermissions
robota --max-turns <n>              # Limit agentic turns per interaction
robota --reset                      # Delete user settings and exit
robota --version                    # Show version
```

## First-Run Setup

When no settings file exists, the CLI prompts for an Anthropic API key (input masked with asterisks) and creates `~/.robota/settings.json`. Use `robota --reset` to return to first-run state.

## Built-in Tools

The CLI provides 6 tools that the AI agent can invoke:

| Tool    | Description                          | Primary Argument |
| ------- | ------------------------------------ | ---------------- |
| `Bash`  | Execute shell commands               | `command`        |
| `Read`  | Read file contents with line numbers | `filePath`       |
| `Write` | Write content to a file              | `filePath`       |
| `Edit`  | Replace a string in a file           | `filePath`       |
| `Glob`  | Find files matching a pattern        | `pattern`        |
| `Grep`  | Search file contents with regex      | `pattern`        |

## Permission System

Every tool call passes through a three-step permission gate before execution:

1. **Deny list** — if any deny pattern matches, the action is blocked immediately
2. **Allow list** — if any allow pattern matches, the action is auto-approved
3. **Mode policy** — the active permission mode determines the decision

When a tool requires approval, the user sees an interactive prompt:

```
[Permission Required] Tool: Bash
  Arguments: command: rm -rf dist
Allow? [y/N]
```

- Type `y` or `yes` to approve
- Press Enter or type anything else to deny

If denied, the AI agent receives a "Permission denied" error and can adjust its approach.

### Permission Modes

| Mode                | Alias    | Read/Glob/Grep | Write/Edit |  Bash   |
| ------------------- | -------- | :------------: | :--------: | :-----: |
| `plan`              | safe     |      auto      |    deny    |  deny   |
| `default`           | moderate |      auto      |  approve   | approve |
| `acceptEdits`       | full     |      auto      |    auto    | approve |
| `bypassPermissions` | —        |      auto      |    auto    |  auto   |

- **auto** — tool executes without prompting
- **approve** — user is prompted to allow or deny
- **deny** — tool is blocked silently (no prompt shown)

Unknown tools default to `approve` in most modes, `deny` in `plan` mode.

### Changing Mode at Runtime

Use the `/mode` slash command in the REPL:

```
> /mode                    # Show current mode
Current permission mode: default

> /mode plan               # Switch to plan (read-only)
Permission mode set to: plan

> /mode bypassPermissions  # Skip all prompts
Permission mode set to: bypassPermissions
```

Or set it at startup:

```bash
robota --permission-mode plan
```

### Permission Patterns (allow/deny lists)

Configure in `.robota/settings.json` or `.robota/settings.local.json`:

```json
{
  "permissions": {
    "allow": ["Bash(pnpm *)", "Bash(git status)", "Read(/src/**)"],
    "deny": ["Bash(rm -rf *)", "Write(.env)"]
  }
}
```

**Pattern syntax:**

- `ToolName` — match any invocation of that tool (e.g., `Bash`)
- `ToolName(pattern)` — match when the primary argument matches the glob (e.g., `Bash(pnpm *)`)
- `*` — zero or more characters (shell-style)
- `**` — one or more characters (recursive path matching)

**Evaluation order:** deny patterns are checked first, then allow patterns, then the mode policy. Deny always wins.

## Slash Commands

| Command                   | Description                              |
| ------------------------- | ---------------------------------------- |
| `/help`                   | Show help                                |
| `/clear`                  | Clear conversation history               |
| `/mode [mode]`            | Show or change permission mode           |
| `/model [model]`          | Select AI model (confirmation + restart) |
| `/compact [instructions]` | Compress context window                  |
| `/cost`                   | Show session info                        |
| `/context`                | Context window details                   |
| `/permissions`            | Show permission rules                    |
| `/exit`                   | Exit CLI                                 |

## Configuration

Settings are loaded from (highest priority first):

1. `.robota/settings.local.json` (local, gitignored)
2. `.robota/settings.json` (project, shared)
3. `~/.robota/settings.json` (user global)

```json
{
  "defaultMode": "default",
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

### Environment Variables

| Variable            | Description       | Required |
| ------------------- | ----------------- | -------- |
| `ANTHROPIC_API_KEY` | Anthropic API key | Yes      |

Copy `.env.example` to `.env` and set your key. The CLI reads `.env` automatically in dev mode.

## Paste Template

When pasting multiline text, the input area collapses it into a label: `[Pasted text #1 +42 lines]`. Multiple pastes are numbered sequentially. The full content is expanded on submit, keeping the input area compact while preserving the complete text for the AI.

## Edit Diff Display

After the Edit tool runs, a `DiffBlock` component renders the change with colored `+`/`-` line markers (green = added, red = removed), giving immediate visual feedback on file modifications.

## Plugin Commands Display

Plugin-provided commands appear in the slash command autocomplete with their source plugin name as a hint. Commands are also accessible via colon format: `/plugin-name:command`.

## Memory Management

The CLI applies two strategies to keep memory usage bounded during long sessions:

- **Message windowing** — Conversation history is capped at 100 messages. Older messages are pruned from the window.
- **Tool state cleanup** — Completed tool results older than 50 entries are cleaned up to reduce retained state.

React components use `React.memo` to avoid unnecessary re-renders.

### Forced Summary on maxRounds

When the tool execution loop exhausts its maximum rounds, the CLI injects a synthetic user message requesting a summary. This ensures the user always receives a meaningful response even if the agent could not complete all planned tool calls.

## Context Discovery

The CLI automatically discovers and loads:

- **AGENTS.md** — walking up from cwd to filesystem root
- **CLAUDE.md** — same walk-up discovery
- **Project metadata** — from `package.json`, `tsconfig.json`

All context is assembled into the system prompt for the AI assistant.

## Architecture

```
bin.ts → cli.ts (parseArgs, load config/context, create Session)
                ├── config/config-loader.ts    — settings file discovery + Zod validation
                ├── context/context-loader.ts  — AGENTS.md/CLAUDE.md walk-up discovery
                ├── context/project-detector.ts — package.json/tsconfig detection
                ├── context/system-prompt-builder.ts — system message assembly
                ├── session.ts                 — Robota agent wrapper + permission enforcement
                │   └── permissions/
                │       ├── permission-gate.ts   — 3-step evaluation (deny → allow → mode)
                │       ├── permission-mode.ts   — mode × tool policy matrix
                │       └── permission-prompt.ts — interactive [y/N] prompt
                ├── tools/                     — 6 built-in tools (Bash, Read, Write, Edit, Glob, Grep)
                ├── session-store.ts           — JSON file-based session persistence
                └── ui/                        — Ink TUI components (App, MessageList, InputArea, etc.)
```

Tool calls flow through the permission system:

```
AI agent requests tool call
  → Session.wrapToolWithPermission() intercepts execute()
    → evaluatePermission(toolName, args, mode, allow/deny lists)
      → deny list match? → blocked
      → allow list match? → auto-approved
      → mode policy lookup → auto | approve | deny
    → if 'approve': promptForApproval() → user types y/N
    → if allowed: original tool.execute() runs
    → if denied: returns error result to AI agent
```
