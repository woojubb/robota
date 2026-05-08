# Agent System Architecture

Agent product stack, playground stack, command/provider/runtime ownership, and profile identity rules.

Back to [System Architecture Map](../ARCHITECTURE-MAP.md).

## Agent Product Stack

The agent stack is part of the routed architecture map. The package-local
`packages/agent-cli/docs/ARCHITECTURE-MAP.md` remains a stable entrypoint that routes to the
grouped CLI startup path, class inventory, TUI hooks, and command-layer audit.

```mermaid
flowchart TD
  AgentCLI["agent-cli\nterminal UI + local adapters"]
  Headless["agent-transport-headless\nprint-mode transport"]
  Commands["agent-command-*\nuser-visible commands"]
  SDK["agent-sdk\nInteractiveSession + command contracts/common APIs"]
  Sessions["agent-sessions\nconversation lifecycle"]
  Runtime["agent-runtime\nbackground/subagent lifecycle"]
  Tools["agent-tools\ntools + sandbox ports"]
  Core["agent-core\nprovider/history/permission contracts"]
  Providers["agent-provider-*\nprovider definitions + transports"]

  AgentCLI --> SDK
  AgentCLI --> Commands
  AgentCLI --> Providers
  AgentCLI --> Headless
  Headless --> SDK
  Commands --> SDK
  Commands --> Core
  SDK --> Sessions
  SDK --> Runtime
  SDK --> Tools
  SDK --> Core
  Providers --> Core
  Sessions --> Core
  Runtime --> Core
  Tools --> Core
```

Agent stack ownership:

| Concern                                           | Owner                                             | Notes                                                                                                                                               |
| ------------------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Terminal input/rendering and host adapters        | `agent-cli`                                       | Thin product shell only; visible CLI features still need reusable SDK/runtime/command/provider ownership for non-UI behavior.                       |
| Command contracts/common APIs                     | `agent-sdk`                                       | Command packages consume these like third-party modules.                                                                                            |
| Model command tool projection                     | `agent-sdk`                                       | Projects model-invocable command descriptors into provider-safe `robota_command_*` tools and reverse maps them to slash-free command ids.           |
| User-visible built-in command behavior            | `agent-command-*`                                 | CLI composes default modules; SDK must not import them.                                                                                             |
| Skill discovery, activation, and audit events     | `agent-sdk` common APIs + `agent-command-skills`  | `skills` command activation and `skill_activation` distinguish real activation from prompt-only mimicry; `/skills` is UI input/display syntax only. |
| Skill-spawned agents and background task spawning | `agent-sdk` + `agent-runtime`                     | Skills consume SDK-owned spawning ports; CLI renders resulting task/workspace projections only.                                                     |
| Provider profile settings/setup helpers           | `agent-sdk` command-api                           | Includes profile validation, setup flow, generated profile-name suggestions, and probe helpers.                                                     |
| Provider defaults, setup metadata, model catalogs | `agent-provider-*` through `agent-core` contracts | CLI must not hardcode provider branches.                                                                                                            |
| Session lifecycle and compaction                  | `agent-sessions`                                  | CLI consumes through SDK facades, not direct imports.                                                                                               |
| Background/subagent lifecycle ports               | `agent-runtime`                                   | CLI keeps concrete local process/worktree adapters.                                                                                                 |
| Background workspace/read model                   | `agent-sdk` + `agent-runtime`                     | CLI keeps only ephemeral selected-entry UI state and renders SDK-owned projections.                                                                 |

Provider profile identity is the settings profile key, not provider `type` or model uniqueness.
Generated interactive setup keys are model-derived SDK suggestions with numeric duplicate suffixes;
credential details must stay out of profile names. `agent-cli` may display the active profile key,
provider type, and model in the status area, but profile creation and switching semantics stay in SDK
common APIs and the `agent-command-provider` module.

## Agent CLI Detail Map

The concrete `agent-cli` startup path, TUI hooks, execution modes, class inventory, and CLI layer
audit are routed through [agent-cli-composition.md](agent-cli-composition.md) and split under
[agent-cli/](agent-cli/). The package-local entrypoint at
[../../../packages/agent-cli/docs/ARCHITECTURE-MAP.md](../../../packages/agent-cli/docs/ARCHITECTURE-MAP.md)
routes readers to that detail map while preserving the package docs link.

## Agent Playground Stack

```mermaid
flowchart TD
  AgentWeb["agent-web playground pages\nproduct host"]
  ClientEntry["agent-playground/client\nbrowser-safe React entry"]
  RootEntry["agent-playground root entry\nservices + components"]
  Components["playground React components\neditor, gallery, panels, visualizers"]
  ComponentModules["component modules\nindividual-plugin-block,\nchat-interface,\nproject-browser,\nagent-configuration-block,\nexecution-tree-visualizer,\nexecution-tree-debug,\nusage-monitor,\nagent-container-block,\nblock-tree,\nblock-visualization-panel,\ntool-container-block,\nerror-panel"]
  ComponentData["component data modules\ncode-editor-templates,\ntemplate-gallery-data"]
  UiPrimitives["shared UI primitives\naccessibility + controls"]
  DemoData["demo execution data module\nscenario + timeline offsets"]
  ProjectManager["project manager module\nstorage + metadata"]
  BlockHooks["block tracking hooks module\nhandlers + block messages"]
  ExecutionSubscriber["execution subscriber module\nSDK events + realtime blocks"]
  WebSocketClient["websocket client module\nconnection + auth routing"]
  ChatInputHook["chat input hook module\ninput state + validation + focus"]
  RobotaExecutionHook["robota execution hook module\nstate + history + actions"]
  WebSocketHook["websocket connection hook module\nstate + uptime + handlers"]
  Hooks["playground hooks\ninput, websocket, execution, stats"]
  Context["playground context module\nprovider + hooks + actions"]
  Reducer["playground reducer\nstate transitions"]
  Executor["PlaygroundExecutor\nbrowser execution facade"]
  ExecutorModule["robota executor module\nagent session + remote providers + tool normalization"]
  RemoteInjection["code executor + remote injection\nsandboxed user-code path"]
  CodeAnalyzer["code analyzer module\nanalysis + parser + env checks"]
  RemoteClient["agent-remote-client\nRemoteExecutor"]
  Core["agent-core / agent-tools\nRobota, tools, contracts"]
  Providers["agent-provider-openai / anthropic\nprovider adapters"]

  AgentWeb --> ClientEntry
  ClientEntry --> Components
  RootEntry --> Components
  RootEntry --> Executor
  RootEntry --> BlockHooks
  RootEntry --> ExecutionSubscriber
  RootEntry --> WebSocketClient
  Components --> ComponentModules
  Components --> ComponentData
  Components --> UiPrimitives
  Components --> DemoData
  Components --> ProjectManager
  Components --> Hooks
  Components --> Context
  Context --> Reducer
  Hooks --> ChatInputHook
  Hooks --> RobotaExecutionHook
  Hooks --> WebSocketHook
  Hooks --> Executor
  Hooks --> WebSocketClient
  WebSocketHook --> Context
  WebSocketHook --> WebSocketClient
  RemoteInjection --> CodeAnalyzer
  Executor --> WebSocketClient
  Executor --> ExecutorModule
  ExecutorModule --> RemoteClient
  ExecutorModule --> Core
  ExecutorModule --> Providers
  ExecutionSubscriber --> Core
  RemoteInjection --> RemoteClient
  RemoteInjection --> Core
```

Playground ownership:

| Concern                                            | Owner                      | Notes                                                                                        |
| -------------------------------------------------- | -------------------------- | -------------------------------------------------------------------------------------------- |
| Product route and deployment host                  | `agent-web`                | Imports the browser-safe playground entry only.                                              |
| Browser-safe React package entry                   | `agent-playground/client`  | Must not expose Node-only services to browser consumers.                                     |
| Reusable playground services and public root API   | `agent-playground` root    | Owns executor and service exports for runtime consumers.                                     |
| React composition, panels, visualizers, UI state   | `agent-playground`         | Hooks and context remain package-internal unless explicitly exported.                        |
| Playground component modules                       | `agent-playground`         | Keep repeated/complex component internals split behind stable directory `index.ts` modules.  |
| Static template/example catalogs                   | `agent-playground`         | Keep import paths stable through directory `index.ts` modules.                               |
| Shared UI primitives                               | `agent-playground`         | Keep import paths stable through directory `index.ts` modules.                               |
| Playground project storage and metadata            | `agent-playground`         | LocalStorage-backed service; keep import path stable through `index.ts`.                     |
| Block tracking hook factories                      | `agent-playground`         | Keep hook factories thin; handlers and block messages stay internal.                         |
| SDK event subscription and real-time block updates | `agent-playground`         | Keep event guards and handlers internal to the execution subscriber module.                  |
| Playground WebSocket client                        | `agent-playground`         | Keep connection state in the client class; message/auth helpers stay internal.               |
| Playground chat input hook                         | `agent-playground`         | Keep input state calculation, validation, focus wiring, and constants internal.              |
| Playground Robota execution hook                   | `agent-playground`         | Keep execution state, history metrics, timeout, and action wiring behind `index.ts`.         |
| Playground WebSocket connection hook               | `agent-playground`         | Keep state math, uptime effects, constants, and handler registry internal.                   |
| Playground context provider                        | `agent-playground`         | Keep provider composition thin; lifecycle, refs, actions, and result shaping stay internal.  |
| Playground executor facade                         | `agent-playground`         | Keep agent session, remote provider wiring, tool normalization, and result shaping internal. |
| User-code diagnostics and config parsing           | `agent-playground`         | Code analyzer remains package-internal and feeds playground execution.                       |
| Secure provider execution from browser playground  | `agent-remote-client` edge | API keys stay server-side through `RemoteExecutor`/remote injection.                         |
