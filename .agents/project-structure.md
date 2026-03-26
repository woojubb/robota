# Project Structure

```text
packages/
├── agents/                      # Core agent functionality (Robota class, DI, AI providers)
├── event-service/               # Event bus: interfaces, ObservableEventService, StructuredEventService
├── tools/                       # Tool implementations: FunctionTool, OpenAPITool, ToolRegistry
├── tool-mcp/                    # MCP tool implementations: MCPTool, RelayMcpTool
├── plugin-conversation-history/ # Plugin: conversation history tracking
├── plugin-logging/              # Plugin: structured logging
├── plugin-usage/                # Plugin: token/cost usage tracking
├── plugin-performance/          # Plugin: execution performance metrics
├── plugin-execution-analytics/  # Plugin: execution analytics and reporting
├── plugin-error-handling/       # Plugin: error handling and recovery
├── plugin-limits/               # Plugin: rate limiting and resource control
├── plugin-event-emitter/        # Plugin: event emission bridge
├── plugin-webhook/              # Plugin: webhook delivery
├── anthropic/                   # Anthropic provider
├── openai/                      # OpenAI provider
├── google/                      # Google provider
├── bytedance/                   # ByteDance provider
├── sessions/                    # Session management
├── team/                        # Team collaboration (assignTask relay tools)
├── playground/                  # Playground UI package
├── remote/                      # Remote execution client
├── remote-server-core/          # Remote execution server core
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
├── web/                    # Web application (Agent Playground)
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
