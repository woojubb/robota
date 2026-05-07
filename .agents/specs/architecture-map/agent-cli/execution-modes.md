# Agent CLI Execution Modes

Source-verified against `develop` on 2026-05-07.

This document owns the interactive TUI and non-interactive print-mode execution paths.

## Execution Modes

### Interactive TUI

```mermaid
sequenceDiagram
  participant User
  participant TUI as agent-cli React/Ink
  participant Bridge as useInteractiveSession
  participant SDK as InteractiveSession
  participant Session as agent-sessions Session
  participant Provider as IAIProvider

  User->>TUI: type prompt or slash command
  TUI->>Bridge: handleSubmit(input)
  alt slash command
    Bridge->>SDK: executeCommand(name, args)
    SDK-->>Bridge: ICommandResult
    Bridge-->>TUI: message, interaction, or typed effects
  else model prompt
    Bridge->>SDK: submit(input)
    SDK->>SDK: resolve @file references under cwd
    SDK->>Session: run enriched prompt
    Session->>Provider: chat/stream request
    Provider-->>Session: text, tool calls, usage
    Session-->>SDK: history, context, tool events
    SDK-->>Bridge: events
    Bridge-->>TUI: TuiStateManager render state
  end
```

Interactive mode currently supports:

- permission prompts through CLI React state and SDK permission handler injection;
- `/` command execution through `InteractiveSession.executeCommand()`;
- generic `ICommandInteraction` rendering;
- typed `TCommandEffect` application;
- skill and plugin command discovery through SDK command sources;
- prompt `@file` references through SDK-owned preprocessing, with CLI only passing submitted text;
- session resume/fork/name flows through SDK-owned session persistence facade and summaries.

### Non-Interactive Print Mode

```mermaid
sequenceDiagram
  participant CLI as cli.ts -p path
  participant SDK as InteractiveSession
  participant Transport as agent-transport-headless
  participant Session as agent-sessions Session

  CLI->>CLI: collect positional prompt or piped stdin
  CLI->>CLI: build appendSystemPrompt from flags
  CLI->>SDK: new InteractiveSession({ permissionMode: bypassPermissions, bare, allowedTools, noSessionPersistence, commandModules })
  CLI->>Transport: createHeadlessTransport({ outputFormat, prompt })
  CLI->>SDK: attachTransport(transport)
  CLI->>Transport: start()
  Transport->>SDK: submit prompt
  SDK->>Session: run loop
  Session-->>Transport: text/json/stream-json output events
  CLI->>SDK: shutdown()
```

Current `develop` print mode supports `-p`, piped stdin, `--output-format`,
`--permission-mode`, `--max-turns`, `--bare`, `--allowed-tools`,
`--no-session-persistence`, `--append-system-prompt`, and `--json-schema`.

`--task-file` is not present in current `develop`; if that flag is merged from another branch,
this section must be updated in the same PR.
