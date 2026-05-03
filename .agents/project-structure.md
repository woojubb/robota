# Project Structure

```text
packages/
├── agent-core/                  # Foundation contracts, engine, events, hooks, permissions
├── agent-runtime/               # Reusable background task and subagent lifecycle/state/ports
├── agent-sessions/              # Session lifecycle and persistence
├── agent-tools/                 # Tool implementations: FunctionTool, built-ins, schema helpers
├── agent-tool-mcp/              # MCP tool implementations
├── agent-sdk/                   # SDK assembly layer: InteractiveSession, command contracts/common APIs
├── agent-command-agent/         # Command module that contributes /agent
├── agent-command-compact/       # Command module that contributes /compact
├── agent-command-context/       # Command module that contributes /context
├── agent-command-language/      # Command module that contributes /language
├── agent-command-mode/          # Command module that contributes /mode
├── agent-command-model/         # Command module that contributes /model
├── agent-command-permissions/   # Command module that contributes /permissions
├── agent-command-provider/      # Command module that contributes /provider
├── agent-cli/                   # Terminal UI and local runtime adapters
├── agent-event-service/         # Compatibility re-export package for event service APIs
├── agent-provider-anthropic/    # Anthropic provider
├── agent-provider-openai/       # OpenAI provider shell
├── agent-provider-openai-compatible/ # Reusable OpenAI-compatible transport primitives
├── agent-provider-gemma/        # Gemma provider shell using OpenAI-compatible endpoints
├── agent-provider-qwen/         # Qwen provider shell using Model Studio OpenAI-compatible endpoints
├── agent-provider-gemini/       # Gemini API provider using Google GenAI SDK
├── agent-provider-google/       # Compatibility wrapper for agent-provider-gemini
├── agent-provider-bytedance/    # ByteDance provider
├── agent-team/                  # Team collaboration (assignTask relay tools)
├── agent-playground/            # Playground UI package
├── agent-remote-client/         # Remote execution client
├── agent-transport-headless/    # Headless transport
├── agent-transport-http/        # HTTP transport
├── agent-transport-mcp/         # MCP transport
├── agent-transport-ws/          # WebSocket transport
├── agent-plugin-conversation-history/ # Plugin: conversation history tracking
├── agent-plugin-logging/        # Plugin: structured logging
├── agent-plugin-usage/          # Plugin: token/cost usage tracking
├── agent-plugin-performance/    # Plugin: execution performance metrics
├── agent-plugin-execution-analytics/ # Plugin: execution analytics and reporting
├── agent-plugin-error-handling/ # Plugin: error handling and recovery
├── agent-plugin-limits/         # Plugin: rate limiting and resource control
├── agent-plugin-event-emitter/  # Plugin: event emission bridge
├── agent-plugin-webhook/        # Plugin: webhook delivery
├── dag-core/                    # DAG domain contracts and state rules (SSOT)
├── dag-cost/                    # Cost domain (CEL evaluator, cost meta types, storage port)
├── dag-adapters-local/          # Local adapters (in-memory ports + file-based storage)
├── dag-node/                    # Node authoring infrastructure (base class, IO, registries)
├── dag-runtime/                 # DAG orchestration runtime
├── dag-worker/                  # DAG worker execution layer
├── dag-scheduler/               # DAG scheduler layer
├── dag-projection/              # DAG projection/read-model layer
├── dag-api/                     # DAG API/composition layer
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

| Document                                                   | Content                                   |
| ---------------------------------------------------------- | ----------------------------------------- |
| [publish-registry.md](publish-registry.md)                 | npm publish rules, package registry table |
| [dag-dependency-direction.md](dag-dependency-direction.md) | DAG package dependency flow and rules     |

## Command Package Rule

User-visible internal commands belong in `agent-command-*` packages or command-module owners that consume `@robota-sdk/agent-sdk` command contracts. `agent-sdk` owns command infrastructure and reusable common APIs; `agent-cli` composes selected modules and renders generic UI.
