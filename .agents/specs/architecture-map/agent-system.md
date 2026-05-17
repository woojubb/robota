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
  AgentWeb["agent-web\nNext.js product host"]
  ClientEntry["agent-playground/client\nbrowser-safe React entry"]
  Playground["agent-playground\nexecutor + hooks + components"]
  RemoteClient["agent-remote-client\nRemoteExecutor (API keys stay server-side)"]
  Core["agent-core / agent-tools"]
  Providers["agent-provider-openai / anthropic\nprovider adapters"]

  Browser --> AgentWeb
  AgentWeb --> ClientEntry
  ClientEntry --> Playground
  Playground --> RemoteClient
  Playground --> Core
  Playground --> Providers
  RemoteClient --> Core
```

Playground ownership:

| Concern                                | Owner                     | Contract                                                                                                                                                |
| -------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Product route and deployment host      | `agent-web`               | Imports browser-safe playground entry only.                                                                                                             |
| Browser-safe React package entry       | `agent-playground/client` | Must not expose Node-only services.                                                                                                                     |
| Executor, hooks, components, context   | `agent-playground`        | Internal modules under `src/lib/` and `src/components/`; see [packages/agent-playground/docs/SPEC.md](../../../packages/agent-playground/docs/SPEC.md). |
| Secure provider execution from browser | `agent-remote-client`     | API keys stay server-side through `RemoteExecutor`.                                                                                                     |

**No agent-framework session stack (intentional)**: `agent-playground` does not depend on
`agent-framework`, `agent-session`, or `agent-executor`. Session management and all server-side
policy run in `apps/agent-server`; the playground is a lightweight client UI only.
See [packages/agent-playground/docs/SPEC.md](../../../packages/agent-playground/docs/SPEC.md).
