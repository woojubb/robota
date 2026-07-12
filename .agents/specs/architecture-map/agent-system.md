# Agent System Architecture

Agent product stack, playground stack, command/provider/runtime ownership, and profile identity rules.

Back to [System Architecture Map](../ARCHITECTURE-MAP.md).

## Agent Product Stack

```mermaid
flowchart TD
  AgentCLI["agent-cli\nlifecycle owner + assembly"]
  TuiTransport["agent-transport-tui\nTUI I/O adapter (terminal)"]
  Headless["agent-transport/headless\nprint-mode transport"]
  Commands["agent-command\nuser-visible commands"]
  Framework["agent-framework\nassembly layer — InteractiveSession,\ncommand contracts/common APIs\n(React-free)"]
  Preset["agent-preset\nnamed preset profiles + resolvePreset\n(option-data layer; depends on framework only)"]
  Sessions["agent-session\nconversation lifecycle"]
  Executor["agent-executor\nbackground task lifecycle"]
  Tools["agent-tools + agent-tool-mcp\ntools + sandbox ports + MCP integration"]
  Core["agent-core\nprovider/history/permission contracts\n(ZERO deps from other agent-* packages)"]
  Providers["agent-provider\nprovider definitions"]
  SubagentRunner["agent-subagent-runner\nChildProcessSubagentRunner + worker\n(optional — install only when needed)"]
  Plugins["agent-plugin\nplugin layer (event, logging, usage, etc.)"]
  IfaceTransport["agent-interface-transport\ntransport + session/storage/usage/workspace/command/event contracts (DATA-001)\n(type-only agent-core dep)"]
  IfaceTui["agent-interface-tui\nTUI type contracts (ZERO deps)"]

  AgentCLI --> TuiTransport
  AgentCLI --> Framework
  AgentCLI --> Commands
  AgentCLI --> Providers
  AgentCLI --> Headless
  AgentCLI --> SubagentRunner
  AgentCLI --> Preset
  Commands --> Preset
  Preset --> Framework
  TuiTransport --> Framework
  AgentCLI -. "consumer opt-in" .-> Plugins
  Headless --> Framework
  Commands --> Framework
  Commands --> Core
  Commands --> IfaceTransport
  SubagentRunner --> Framework
  SubagentRunner --> Executor
  SubagentRunner --> Providers
  Framework --> Sessions
  Framework --> Executor
  Framework --> Tools
  Framework --> Core
  Framework -. "consumer opt-in" .-> Plugins
  Providers --> Core
  Sessions --> Core
  Executor --> Core
  Tools --> Core
  Plugins --> Core
  Framework --> IfaceTransport
  TuiTransport --> IfaceTransport
  TuiTransport --> IfaceTui
```

Agent stack ownership:

| Concern                                           | Owner                                                   | Contract                                                                                                                                                                                                                                      |
| ------------------------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Terminal input/rendering                          | `agent-transport-tui`                                   | I/O adapter only — implements `IConfigurableTransport`.                                                                                                                                                                                       |
| CLI lifecycle + assembly                          | `agent-cli`                                             | Composes transports, providers, commands; owns `process.exit()`.                                                                                                                                                                              |
| Framework assembly layer                          | `agent-framework`                                       | Composes sessions/executor/tools/core. React-free.                                                                                                                                                                                            |
| Runtime host / session-construction seam          | `agent-framework`                                       | Owns `buildRuntimeSession` (single construction seam) + `startRuntimeHost` (build + start WS lifecycle). TUI, print, and `--serve` are three presentations over the one seam.                                                                 |
| Command contracts/common APIs                     | `agent-framework`                                       | Command packages consume these as third-party modules.                                                                                                                                                                                        |
| User-visible built-in command behavior            | `agent-command`                                         | CLI composes defaults; framework must not import them.                                                                                                                                                                                        |
| Provider defaults, setup metadata, model catalogs | `agent-provider` via `agent-core`                       | CLI must not hardcode provider branches.                                                                                                                                                                                                      |
| Session lifecycle and compaction                  | `agent-session`                                         | CLI consumes through framework facades only.                                                                                                                                                                                                  |
| Background/subagent lifecycle ports               | `agent-executor`                                        | CLI keeps concrete local process/worktree adapters.                                                                                                                                                                                           |
| Child-process subagent runner + worker            | `agent-subagent-runner` (opt-in)                        | CLI imports factory; pass workerPath from getDefaultSubagentWorkerPath().                                                                                                                                                                     |
| Background workspace/read model                   | `agent-framework` + `agent-executor`                    | CLI renders framework projections; keeps only ephemeral UI selection state.                                                                                                                                                                   |
| Named preset profiles / live preset switching     | `agent-preset` (data) + `agent-framework` (application) | Data owner `agent-preset` (`IPreset` + `resolvePreset` + built-in + external presets); application owner `agent-framework` (`applyPresetToSession`); command `agent-command/preset`; runtime state `agent-session`; UI `agent-transport-tui`. |

Provider profile identity is the settings profile key, not provider `type` or model uniqueness. See [commands-and-provider-flow.md](agent-cli/commands-and-provider-flow.md) for profile switching semantics.

**Plugin consumer opt-in**: `agent-plugin` packages are not imported by `agent-cli` or `agent-framework` production source. Plugins are registered by consuming applications at composition time. The dashed edges above (`consumer opt-in`) reflect this: no plugin imports exist in the CLI or framework assembly paths. Application consumers pass plugin instances to the framework assembly API.

## API Boundary

| Surface          | Owner  | Mutability | Purpose                                                                                                                           |
| ---------------- | ------ | ---------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Runtime API      | Robota | Stable     | Native execution contract (in-process provider + native `/v1/dag/*` server). Evolved deliberately, not pinned to an external API. |
| Orchestrator API | Robota | Modifiable | Cost, auth, retry, and routing policies live here.                                                                                |

## Agent CLI Detail Map

See [agent-cli-composition.md](agent-cli-composition.md) and [agent-cli/](agent-cli/) for the concrete CLI startup path, TUI hooks, command-layer inventory, and CLI audits.

## Agent Playground Stack

```mermaid
flowchart TD
  Browser["Browser"]
  AgentWeb["apps/agent-web\nNext.js product host"]
  AgentServer["apps/agent-server\nAI provider proxy + WebSocket"]
  ClientEntry["agent-playground/client\nbrowser-safe React entry"]
  Playground["agent-playground\nexecutor + hooks + components"]
  RemoteClient["agent-remote-client\nRemoteExecutor (API keys stay server-side)"]
  Core["agent-core / agent-tools"]
  Providers["agent-provider\nprovider adapters"]

  Browser --> AgentWeb
  AgentWeb --> AgentServer
  AgentWeb --> ClientEntry
  ClientEntry --> Playground
  Playground --> RemoteClient
  Playground --> Core
  RemoteClient --> Core
  AgentServer --> Providers
```

Data flow: `Browser → apps/agent-web → apps/agent-server → agent-provider → AI provider`. The
browser never holds API keys — all provider calls are proxied through `apps/agent-server`. The
playground package itself is a lightweight client UI; session management and server-side policy
live in `apps/agent-server`.

Playground ownership:

| Concern                                | Owner                     | Contract                                                                                                                                                |
| -------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Product route and deployment host      | `apps/agent-web`          | Imports browser-safe playground entry only.                                                                                                             |
| AI provider proxy + WebSocket host     | `apps/agent-server`       | API keys and server-side provider policy stay here; never in browser.                                                                                   |
| Browser-safe React package entry       | `agent-playground/client` | Must not expose Node-only services.                                                                                                                     |
| Executor, hooks, components, context   | `agent-playground`        | Internal modules under `src/lib/` and `src/components/`; see [packages/agent-playground/docs/SPEC.md](../../../packages/agent-playground/docs/SPEC.md). |
| Secure provider execution from browser | `agent-remote-client`     | API keys stay server-side through `RemoteExecutor`.                                                                                                     |

**No agent-framework session stack (intentional)**: `agent-playground` does not depend on
`agent-framework`, `agent-session`, or `agent-executor`. Session management and all server-side
policy run in `apps/agent-server`; the playground is a lightweight client UI only.
See [packages/agent-playground/docs/SPEC.md](../../../packages/agent-playground/docs/SPEC.md).

## Runtime Host / WS Sidecar Mode [Landed — RUNTIME-001 / GUI-005]

The sidecar is served by the shared runtime host, not a bespoke CLI server. `robota --serve`
(`serve-mode.ts`) runs `startRuntimeHost` (`agent-framework`), which builds the `InteractiveSession`
through the `buildRuntimeSession` seam and starts the loopback WS transport lifecycle. The desktop
Electron shell `apps/agent-app` spawns `robota --serve` and renders the shared GUI presentation core
`agent-transport-gui` over the transport-neutral `TServerMessage` stream; `apps/agent-web-monitor`
serves the same GUI core (monitor + Stage-D remote page) as a CLI-served SPA.

Sidecar mode spans these packages:

| Package                      | Role                                                                                                        | Status |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------- | ------ |
| `agent-framework`            | `buildRuntimeSession` construction seam + `startRuntimeHost` (build session + start WS transport lifecycle) | landed |
| `agent-cli`                  | `robota --serve` (`serve-mode.ts`) runs `startRuntimeHost` headless (no ink); alive until SIGTERM/SIGINT    | landed |
| `agent-transport-protocol`   | `createWsHandler({ session, send })` + `TServerMessage` — transport-neutral relay contract                  | landed |
| `agent-transport-ws`         | `WsTransport` — WebSocket adapter serving the relay over the loopback socket                                | landed |
| `agent-transport-gui`        | Shared GUI core: owns `SessionMonitor` + `useWsSession(url)` reducer + view components                      | landed |
| `agent-transport-webrtc-web` | Browser WebRTC peer (`RemoteClient`, `useRtcSession`) over the GUI core                                     | landed |
| `apps/agent-app`             | Desktop Electron shell; spawns `robota --serve` and renders the GUI core over the loopback WS sidecar       | landed |
| `apps/agent-web-monitor`     | CLI-served Vite SPA (monitor + remote page) over the GUI core                                               | landed |

> **Superseded design.** The earlier `--web` / `--web-port` flags and
> `startWebSidecarServer(interactiveSession, port)` were never built — neither the flags nor that
> function exist in the codebase. The landed seam is `robota --serve` → `startRuntimeHost`; the desktop
> GUI (`apps/agent-app`) supervises the sidecar process rather than a browser opened from `apps/agent-web`.

For the runtime-host sequence see [agent-cli/execution-modes.md](agent-cli/execution-modes.md).

## Multi-Agent Orchestration

The `agent-subagent-runner` package handles child-process subagent execution (opt-in, CLI only).

| Concern                          | Owner                   | Contract                                                                                  |
| -------------------------------- | ----------------------- | ----------------------------------------------------------------------------------------- |
| Child-process subagent runner    | `agent-subagent-runner` | Opt-in. CLI imports factory; forks worker via `child_process.fork()`.                     |
| Agent Command (spawn + delegate) | `agent-command`         | `robota_command_agent` tool — spawns background agent job via `agent-executor` contracts. |
