# Project Structure

```text
packages/
├── auth/                        # Auth contracts, verifier ports, scope policy
├── credits/                     # Credit account, reservation, and settlement contracts
├── agent-core/                  # Foundation contracts, engine, events, hooks, permissions
├── agent-runtime/               # Reusable background task and subagent lifecycle/state/ports
├── agent-sessions/              # Session lifecycle and persistence
├── agent-tools/                 # Tool implementations: FunctionTool, built-ins, schema helpers, sandbox ports/manifests
├── agent-tool-mcp/              # MCP tool implementations
├── agent-sdk/                   # SDK assembly layer: InteractiveSession, command contracts/common APIs
├── agent-command-*/             # Command modules: agent, background, compact, context, exit, help, language, memory, mode, model, permissions, plugin, provider, reset, rewind, session, skills, statusline
├── agent-cli/                   # Terminal UI and local runtime adapters
├── agent-event-service/         # Compatibility re-export package for event service APIs
├── agent-provider-*/            # Provider packages: anthropic, openai, openai-compatible, gemma, qwen, gemini, google, bytedance
├── agent-team/                  # Team collaboration (assignTask relay tools)
├── agent-playground/            # Playground UI package
├── agent-remote-client/         # Remote execution client
├── agent-transport-*/           # Transports: headless, http, mcp, ws
├── agent-plugin-*/              # Plugins: conversation-history, logging, usage, performance, execution-analytics, error-handling, limits, event-emitter, webhook
├── dag-core/                    # DAG domain contracts and state rules (SSOT)
├── dag-cost/                    # Cost domain (CEL evaluator, cost meta types, storage port)
├── dag-adapters-local/          # Local adapters (in-memory ports + file-based storage)
├── dag-node/                    # Node authoring infrastructure (base class, IO, registries)
├── dag-runtime/                 # DAG orchestration runtime
├── dag-worker/                  # DAG worker execution layer
├── dag-scheduler/               # DAG scheduler layer
├── dag-projection/              # DAG projection/read-model layer
├── dag-api/                     # DAG API/composition layer
├── dag-orchestration-client/    # DAG orchestration HTTP client contracts
├── dag-cli/                     # JSON-first CLI client for DAG orchestration APIs
├── dag-mcp-server/              # MCP server for DAG orchestration APIs
├── dag-designer/                # DAG web designer layer
├── dag-orchestrator/            # DAG orchestration layer
└── dag-nodes/                   # DAG node implementations
apps/
├── agent-web/              # Web application (Agent Playground)
├── blog/                   # Blog/content application
├── dag-studio/             # DAG Designer application
├── docs/                   # Documentation site
├── agent-server/           # AI provider proxy + Playground WebSocket
├── dag-runtime-server/     # DAG execution server (ComfyUI-compatible)
└── dag-orchestrator-server/ # Orchestration gateway (cost/auth/retry)
```

## Related Documents

| Document                                                                                         | Content                                   |
| ------------------------------------------------------------------------------------------------ | ----------------------------------------- |
| [specs/ARCHITECTURE-MAP.md](specs/ARCHITECTURE-MAP.md)                                           | Repository-level architecture map         |
| [publish-registry.md](publish-registry.md)                                                       | npm publish rules, package registry table |
| [dag-dependency-direction.md](dag-dependency-direction.md)                                       | DAG package dependency flow and rules     |
| [../packages/agent-cli/docs/ARCHITECTURE-MAP.md](../packages/agent-cli/docs/ARCHITECTURE-MAP.md) | CLI composition map and layer audit       |

## Command Package Rule

User-visible internal commands belong in `agent-command-*` packages or command-module owners that consume `@robota-sdk/agent-sdk` command contracts. `agent-sdk` owns command infrastructure and reusable common APIs; `agent-cli` composes selected modules and renders generic UI.
