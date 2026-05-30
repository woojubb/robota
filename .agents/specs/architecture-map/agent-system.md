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

  AgentCLI --> TuiTransport
  AgentCLI --> Framework
  AgentCLI --> Commands
  AgentCLI --> Providers
  AgentCLI --> Headless
  AgentCLI --> SubagentRunner
  TuiTransport --> Framework
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

| Concern                                           | Owner                                | Contract                                                                    |
| ------------------------------------------------- | ------------------------------------ | --------------------------------------------------------------------------- |
| Terminal input/rendering                          | `agent-transport/tui`                | I/O adapter only — implements `IConfigurableTransport`.                     |
| CLI lifecycle + assembly                          | `agent-cli`                          | Composes transports, providers, commands; owns `process.exit()`.            |
| Framework assembly layer                          | `agent-framework`                    | Composes sessions/executor/tools/core. React-free.                          |
| Command contracts/common APIs                     | `agent-framework`                    | Command packages consume these as third-party modules.                      |
| User-visible built-in command behavior            | `agent-command`                      | CLI composes defaults; framework must not import them.                      |
| Provider defaults, setup metadata, model catalogs | `agent-provider` via `agent-core`    | CLI must not hardcode provider branches.                                    |
| Session lifecycle and compaction                  | `agent-session`                      | CLI consumes through framework facades only.                                |
| Background/subagent lifecycle ports               | `agent-executor`                     | CLI keeps concrete local process/worktree adapters.                         |
| Child-process subagent runner + worker            | `agent-subagent-runner` (opt-in)     | CLI imports factory; pass workerPath from getDefaultSubagentWorkerPath().   |
| Background workspace/read model                   | `agent-framework` + `agent-executor` | CLI renders framework projections; keeps only ephemeral UI selection state. |

Provider profile identity is the settings profile key, not provider `type` or model uniqueness. See [commands-and-provider-flow.md](agent-cli/commands-and-provider-flow.md) for profile switching semantics.

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
  RemoteClient["agent-remote-client\nRemoteExecutor (API keys stay server-side)"]
  Core["agent-core / agent-tools"]
  Providers["agent-provider\nprovider adapters"]

  Browser --> AgentWeb
  AgentWeb --> AgentServer
  AgentWeb --> ClientEntry
  ClientEntry --> Playground
  Playground --> RemoteClient
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

The `agent-subagent-runner` package handles child-process subagent execution (opt-in, CLI only).

| Concern                          | Owner                   | Contract                                                                                  |
| -------------------------------- | ----------------------- | ----------------------------------------------------------------------------------------- |
| Child-process subagent runner    | `agent-subagent-runner` | Opt-in. CLI imports factory; forks worker via `child_process.fork()`.                     |
| Agent Command (spawn + delegate) | `agent-command`         | `robota_command_agent` tool — spawns background agent job via `agent-executor` contracts. |
