# @robota-sdk/agent-cli

AI coding assistant CLI built on Robota SDK. Loads AGENTS.md/CLAUDE.md for project context and provides tool-calling REPL with Claude Code-compatible permission modes.

## Setup

```bash
# 1. Copy .env.example and add your API key
cp packages/agent-cli/.env.example packages/agent-cli/.env

# 2. Build
pnpm --filter @robota-sdk/agent-cli build
```

## Usage

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
robota --version                    # Show version
```

## Permission Modes

| Mode                | Alias    | Read/Glob/Grep | Write/Edit |  Bash   |
| ------------------- | -------- | :------------: | :--------: | :-----: |
| `plan`              | safe     |      auto      |    deny    |  deny   |
| `default`           | moderate |      auto      |  approve   | approve |
| `acceptEdits`       | full     |      auto      |    auto    | approve |
| `bypassPermissions` | —        |      auto      |    auto    |  auto   |

## Slash Commands

| Command        | Description                     |
| -------------- | ------------------------------- |
| `/help`        | Show help                       |
| `/clear`       | Start new session               |
| `/mode [mode]` | Show or change permission mode  |
| `/resume`      | List and resume a saved session |
| `/cost`        | Show token usage                |
| `/model`       | Show current model              |
| `/exit`        | Exit CLI                        |

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

## Context

The CLI automatically discovers and loads:

- `AGENTS.md` — walking up from cwd to root
- `CLAUDE.md` — same walk-up discovery
- Project metadata from `package.json`, `tsconfig.json`

All context is assembled into the system prompt for the AI assistant.
