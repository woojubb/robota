# Agent System Architecture

Agent product stack, playground stack, command/provider/runtime ownership, and profile identity rules.

Back to [System Architecture Map](../ARCHITECTURE-MAP.md).

## Agent Product Stack

```mermaid
flowchart TD
  AgentCLI["agent-cli\nlifecycle owner + assembly"]
  TuiTransport["agent-transport/tui\nTUI I/O adapter (terminal)"]
  Headless["agent-transport/headless\nprint-mode transport"]
  Commands["agent-command\nuser-visible commands"]
  Framework["agent-framework\nassembly layer — InteractiveSession,\ncommand contracts/common APIs\n(React-free)"]
  Sessions["agent-session\nconversation lifecycle"]
  Executor["agent-executor\nbackground task lifecycle"]
  Tools["agent-tools + agent-tool-mcp\ntools + sandbox ports + MCP integration"]
  Core["agent-core\nprovider/history/permission contracts\n(ZERO deps from other agent-* packages)"]
  Providers["agent-provider\nprovider definitions + transports"]
  SubagentRunner["agent-subagent-runner\nChildProcessSubagentRunner + worker\n(optional — install only when needed)"]
  Plugins["agent-plugin\nplugin layer (event, logging, usage, etc.)"]
  IfaceTransport["agent-interface-transport\nITransportAdapter · IConfigurableTransport\ntype contracts only"]
  IfaceTui["agent-interface-tui\nITuiCommandInteraction · ITuiCliAdapter\ntype contracts only"]

  AgentCLI --> TuiTransport
  AgentCLI --> Framework
  AgentCLI --> Commands
  AgentCLI --> Providers
  AgentCLI --> Headless
  AgentCLI --> SubagentRunner
  TuiTransport --> Framework
  TuiTransport --> IfaceTui
  AgentCLI -. "consumer opt-in" .-> Plugins
  Headless --> Framework
  Commands --> Framework
  Commands --> Core
  SubagentRunner --> Framework
  SubagentRunner --> Executor
  SubagentRunner --> Providers
  Framework --> Sessions
  Framework --> Executor
  Framework --> Tools
  Framework --> Core
  Framework --> IfaceTransport
  Framework -. "consumer opt-in" .-> Plugins
  Providers --> Core
  Sessions --> Core
  Executor --> Core
  Tools --> Core
  Plugins --> Core
  IfaceTransport --> Core
  IfaceTui --> Core
```

Agent stack ownership:

| Concern                                           | Owner                                | Contract                                                                         |
| ------------------------------------------------- | ------------------------------------ | -------------------------------------------------------------------------------- |
| Terminal input/rendering                          | `agent-transport/tui`                | I/O adapter only — implements `IConfigurableTransport`.                          |
| CLI lifecycle + assembly                          | `agent-cli`                          | Composes transports, providers, commands; owns `process.exit()`.                 |
| Framework assembly layer                          | `agent-framework`                    | Composes sessions/executor/tools/core. React-free.                               |
| Command contracts/common APIs                     | `agent-framework`                    | Command packages consume these as third-party modules.                           |
| User-visible built-in command behavior            | `agent-command`                      | CLI composes defaults; framework must not import them.                           |
| Provider defaults, setup metadata, model catalogs | `agent-provider` via `agent-core`    | CLI must not hardcode provider branches.                                         |
| Session lifecycle and compaction                  | `agent-session`                      | CLI consumes through framework facades only.                                     |
| Background/subagent lifecycle ports               | `agent-executor`                     | CLI keeps concrete local process/worktree adapters.                              |
| Child-process subagent runner + worker            | `agent-subagent-runner` (opt-in)     | CLI imports factory; pass workerPath from getDefaultSubagentWorkerPath().        |
| Background workspace/read model                   | `agent-framework` + `agent-executor` | CLI renders framework projections; keeps only ephemeral UI selection state.      |
| Transport adapter type contracts                  | `agent-interface-transport`          | `ITransportAdapter`, `IConfigurableTransport` — no runtime deps.                 |
| TUI interaction type contracts                    | `agent-interface-tui`                | `ITuiCommandInteraction`, `ITuiCliAdapter`, `ITerminalOutput` — no runtime deps. |

Provider profile identity is the settings profile key, not provider `type` or model uniqueness. See [commands-and-provider-flow.md](agent-cli/commands-and-provider-flow.md) for profile switching semantics.

**MCP dual role**: `agent-tool-mcp` and `agent-transport/mcp` serve opposite MCP directions. `agent-tool-mcp` is a **client adapter** — the agent calls external MCP tool servers. `agent-transport/mcp` is a **server adapter** — external MCP clients connect to a Robota session. These two packages have no dependency on each other. See [transport-architecture.md](transport-architecture.md) for the full MCP disambiguation table.

**Plugin consumer opt-in**: `agent-plugin` packages are not imported by `agent-cli` or `agent-framework` production source. Plugins are registered by consuming applications at composition time. The dashed edges above (`consumer opt-in`) reflect this: no plugin imports exist in the CLI or framework assembly paths. Application consumers pass plugin instances to the framework assembly API.

## API Boundary

| Surface          | Owner    | Mutability | Purpose                                              |
| ---------------- | -------- | ---------- | ---------------------------------------------------- |
| Runtime API      | External | Immutable  | ComfyUI-compatible prompt API. Must not be modified. |
| Orchestrator API | Robota   | Modifiable | Cost, auth, retry, and routing policies live here.   |

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
  Team["agent-team\nmulti-agent task delegation"]
  RemoteClient["agent-remote-client\nRemoteExecutor (API keys stay server-side)"]
  Core["agent-core / agent-tools"]
  Providers["agent-provider\nprovider adapters"]

  Browser --> AgentWeb
  AgentWeb --> AgentServer
  AgentWeb --> ClientEntry
  ClientEntry --> Playground
  Playground --> RemoteClient
  Playground --> Team
  Playground --> Core
  Playground --> Providers
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
| Multi-agent task delegation            | `agent-team`              | `agent-playground` is the sole consumer. See [agent-team.md](agent-team.md).                                                                            |
| Secure provider execution from browser | `agent-remote-client`     | API keys stay server-side through `RemoteExecutor`.                                                                                                     |

**No agent-framework session stack (intentional)**: `agent-playground` does not depend on
`agent-framework`, `agent-session`, or `agent-executor`. Session management and all server-side
policy run in `apps/agent-server`; the playground is a lightweight client UI only.
See [packages/agent-playground/docs/SPEC.md](../../../packages/agent-playground/docs/SPEC.md).

## WebSocket Sidecar Mode [Planned]

> **[Planned — not yet implemented]** The `--web` / `--web-port` flags and `startWebSidecarServer()` do not exist in the codebase. This section documents the intended design only.

When implemented, sidecar mode will span four packages:

| Package              | Role                                                                        |
| -------------------- | --------------------------------------------------------------------------- |
| `agent-cli`          | Launch `--web` flag; host `startWebSidecarServer(interactiveSession, port)` |
| `agent-transport/ws` | `createWsHandler({ session, send })` — real-time session event relay        |
| `agent-web-ui`       | Browser React components; `useWsSession(url)` hook for WebSocket connection |
| `apps/agent-web`     | Deployment host; opens monitor URL in browser                               |

For the intended sequence diagram see [agent-cli/execution-modes.md](agent-cli/execution-modes.md).

## Multi-Agent Orchestration

`agent-team` owns multi-agent task delegation and coordination. It sits in the orchestration layer
between assembly and domain — below `agent-framework` but above `agent-core`. It consumes
`agent-core` contracts and provider adapters but does not own session persistence or UI.

See [agent-team.md](agent-team.md) for the full architecture: delegation model, owner-path
propagation, template registry, and distinction from `agent-subagent-runner` (child-process mode).

| Concern                                 | Owner        | Contract                                                                         |
| --------------------------------------- | ------------ | -------------------------------------------------------------------------------- |
| Multi-agent task delegation and routing | `agent-team` | Coordinates sub-agents through `agent-core` contracts; no TUI or CLI dependency. |
