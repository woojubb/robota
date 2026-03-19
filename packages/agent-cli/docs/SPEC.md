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
    ├── StatusBar.tsx         ← Mode, message count, Thinking status
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
