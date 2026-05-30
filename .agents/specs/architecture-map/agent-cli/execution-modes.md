# Agent CLI Execution Modes

Source-verified against `develop` on 2026-05-15.

Interactive TUI and non-interactive print-mode execution paths.

## Interactive TUI

```mermaid
sequenceDiagram
  participant User
  participant TUI as agent-cli React/Ink
  participant Bridge as useInteractiveSession
  participant SDK as InteractiveSession
  participant Session as agent-session Session
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

See [packages/agent-cli/docs/SPEC.md](../../../../packages/agent-cli/docs/SPEC.md) for supported interactive flags.

## Non-Interactive Print Mode

```mermaid
sequenceDiagram
  participant CLI as cli.ts -p path
  participant SDK as InteractiveSession
  participant Transport as agent-transport/headless
  participant Session as agent-session Session

  CLI->>CLI: collect positional prompt or piped stdin
  CLI->>CLI: build appendSystemPrompt from flags
  CLI->>Runtime: runtime.createSession({ permissionMode, maxTurns, sessionStore, bare, allowedTools, appendSystemPrompt })
  Runtime-->>CLI: session (IInteractiveSession)
  CLI->>Transport: createHeadlessTransport({ outputFormat, prompt })
  CLI->>Session: session.attachTransport(transport)
  CLI->>Transport: transport.start()
  Transport->>Session: submit prompt
  Session->>SessionSvc: run loop
  SessionSvc-->>Transport: text/json/stream-json output events
  CLI->>Session: session.shutdown()
```

Flags: `-p`, piped stdin, `--output-format`, `--permission-mode`, `--max-turns`, `--bare`,
`--allowed-tools`, `--no-session-persistence`, `--append-system-prompt`, `--json-schema`.

## WebSocket Sidecar Mode

> **[Planned — not yet implemented]** The `--web` / `--web-port` flags and `startWebSidecarServer()` described below do not exist in the codebase. This section documents the planned design intent referenced in `agent-web-ui/docs/SPEC.md`. Do not rely on it as a current implementation reference.

```mermaid
sequenceDiagram
  participant User as robota --web [--web-port N]
  participant TUI as agent-cli React/Ink TUI
  participant Sidecar as startWebSidecarServer
  participant WsTransport as agent-transport/ws createWsHandler
  participant Browser as agent-web (browser)

  User->>TUI: launch with --web flag
  TUI->>Sidecar: startWebSidecarServer(interactiveSession, port)
  Sidecar->>Sidecar: bind HTTP+WebSocket server on 127.0.0.1:PORT
  Sidecar-->>TUI: IWebSidecarServer { port, stop }
  TUI->>Browser: open ROBOTA_MONITOR_URL

  Browser->>Sidecar: WebSocket connect
  Sidecar->>WsTransport: createWsHandler({ session, send })
  Sidecar-->>Browser: send { type: "messages", messages } (full history replay)

  loop session events
    TUI->>TUI: normal interactive TUI operation
    WsTransport-->>Browser: real-time session events
  end
```

Sidecar bind failure is non-fatal. Source: `agent-cli/src/web-sidecar/web-sidecar-server.ts`.
See [packages/agent-cli/docs/SPEC.md](../../../../packages/agent-cli/docs/SPEC.md) for supported flags.
