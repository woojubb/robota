# Agent CLI Execution Modes

Source-verified against `develop` on 2026-05-09.

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

### WebSocket Sidecar Mode

```mermaid
sequenceDiagram
  participant User as robota --web [--web-port N]
  participant TUI as agent-cli React/Ink TUI
  participant Sidecar as startWebSidecarServer
  participant WsTransport as agent-transport-ws createWsHandler
  participant Browser as agent-web (browser)

  User->>TUI: launch with --web flag
  TUI->>Sidecar: startWebSidecarServer(interactiveSession, port)
  Sidecar->>Sidecar: bind HTTP+WebSocket server on 127.0.0.1:PORT
  Sidecar-->>TUI: IWebSidecarServer { port, stop }
  TUI->>Browser: open ROBOTA_MONITOR_URL (default http://localhost:7071/monitor)

  Browser->>Sidecar: WebSocket connect
  Sidecar->>WsTransport: createWsHandler({ session, send })
  Sidecar-->>Browser: send { type: "messages", messages } (full history replay)

  loop session events
    TUI->>TUI: normal interactive TUI operation
    WsTransport-->>Browser: real-time session events
  end
```

WebSocket sidecar mode starts a local HTTP and WebSocket server alongside the interactive TUI when
the `--web` flag is set. Each browser client receives all session events in real-time through the
`agent-transport-ws` protocol and gets full message-history replay on connect.

Supported flags:

| Flag                 | Default                       | Description                                     |
| -------------------- | ----------------------------- | ----------------------------------------------- |
| `--web`              | false                         | Enable WebSocket sidecar server                 |
| `--web-port N`       | 7070                          | Port to bind the sidecar server                 |
| `--no-open`          | false                         | Skip auto-opening the browser monitor           |
| `ROBOTA_NO_OPEN`     | —                             | Environment variable; also suppresses auto-open |
| `ROBOTA_MONITOR_URL` | http://localhost:7071/monitor | Override monitor URL auto-opened in browser     |

Sidecar bind failure is non-fatal. The interactive TUI continues if the sidecar server cannot bind
to the requested port. The browser monitor (`agent-web`) connects to the sidecar independently; it
is not embedded in or owned by the CLI.

Source path: `agent-cli/src/web-sidecar/web-sidecar-server.ts`  
React bridge: sidecar is started inside `useInteractiveSession` via a `useEffect` — it does not
block TUI initialization.
