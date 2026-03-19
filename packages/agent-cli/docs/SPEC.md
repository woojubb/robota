# SPEC.md — @robota-sdk/agent-cli

## Scope

Interactive terminal AI coding assistant. A React + Ink-based TUI, corresponding to Claude Code.
A **thin CLI layer** built on top of agent-sdk, responsible only for the terminal UI.

## Boundaries

- Does NOT own Session/SessionStore — imported from `@robota-sdk/agent-sessions`
- Does NOT own tools — imported from `@robota-sdk/agent-tools`
- Does NOT own permissions/hooks — imported from `@robota-sdk/agent-core`
- Does NOT own config/context loading — imported from `@robota-sdk/agent-sdk`
- Does NOT own AI provider — imported from `@robota-sdk/agent-provider-anthropic`
- OWNS: Ink TUI components, ITerminalOutput, permission-prompt (terminal UI), CLI argument parsing

## Architecture

```
bin.ts → cli.ts (arg parsing)
              └── ui/render.tsx → App.tsx (Ink TUI)
                    ├── MessageList.tsx    (conversation list)
                    ├── InputArea.tsx      (bottom input area)
                    ├── StatusBar.tsx      (status bar)
                    ├── PermissionPrompt.tsx (arrow-key selection)
                    └── Session (from @robota-sdk/agent-sessions)
```

Dependency chain: `agent-cli → agent-sdk → agent-sessions → agent-tools → agent-core`

## StatusBar Display

The StatusBar shows real-time session information:

```
┌──────────────────────────────────────────────────────────┐
│ Mode: default  |  Model: claude-sonnet-4-6  |  Context: 45%  |  msgs: 12 │
└──────────────────────────────────────────────────────────┘
```

| Field    | Source                                     | Description                            |
| -------- | ------------------------------------------ | -------------------------------------- |
| Mode     | `session.getPermissionMode()`              | Current permission mode                |
| Model    | `config.provider.model`                    | Active AI model name                   |
| Context  | `session.getContextState().usedPercentage` | Context window usage with color coding |
| msgs     | message count                              | Number of messages in conversation     |
| Thinking | isThinking state                           | Shown during `session.run()` execution |

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

## Slash Commands

| Command                   | Description                 |
| ------------------------- | --------------------------- |
| `/help`                   | Show available commands     |
| `/clear`                  | Clear conversation history  |
| `/mode [mode]`            | Show/change permission mode |
| `/compact [instructions]` | Compress context window     |
| `/cost`                   | Show session info           |
| `/exit`                   | Exit CLI                    |

## Type Ownership

| Type               | Location          | Purpose                       |
| ------------------ | ----------------- | ----------------------------- |
| ITerminalOutput    | `src/types.ts`    | Terminal I/O DI interface     |
| ISpinner           | `src/types.ts`    | Spinner handle                |
| IChatMessage       | `src/ui/types.ts` | UI message model              |
| IPermissionRequest | `src/ui/types.ts` | Permission prompt React state |

## Public API Surface

| Export       | Kind     | Description                                                                 |
| ------------ | -------- | --------------------------------------------------------------------------- |
| startCli     | function | CLI entry point                                                             |
| (re-exports) | various  | Backward-compatible re-exports of Session, query, types etc. from agent-sdk |

## File Structure

```
src/
├── bin.ts                    ← Binary entry point
├── cli.ts                    ← CLI argument parsing, Ink render invocation
├── types.ts                  ← ITerminalOutput, ISpinner
├── index.ts                  ← Re-exports
├── permissions/
│   └── permission-prompt.ts  ← Terminal Allow/Deny prompt
└── ui/
    ├── App.tsx               ← Main layout, Session creation, state management
    ├── render.tsx            ← Ink render() invocation
    ├── MessageList.tsx       ← Conversation message list (Robota: label)
    ├── InputArea.tsx         ← Bottom fixed input (ink-text-input)
    ├── StatusBar.tsx         ← Mode, model, context %, message count, Thinking
    ├── PermissionPrompt.tsx  ← Allow/Deny arrow-key selection (useInput)
    ├── InkTerminal.ts        ← No-op ITerminalOutput
    └── types.ts              ← IChatMessage, IPermissionRequest
```

## CLI Usage

```bash
robota                              # Interactive TUI
robota -p "prompt"                  # Print mode (one-shot)
robota -c                           # Continue last session
robota -r <id>                      # Resume session
robota --model <model>              # Model override
robota --permission-mode <mode>     # plan | default | acceptEdits | bypassPermissions
robota --max-turns <n>              # Limit turns
robota --version                    # Version
```

## Dependencies

| Package                 | Purpose                         |
| ----------------------- | ------------------------------- |
| `@robota-sdk/agent-sdk` | Session, query, config, context |
| `ink`, `react`          | TUI rendering                   |
| `ink-text-input`        | Text input                      |
| `chalk`                 | Terminal colors                 |
