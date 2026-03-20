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

## Publish Registry

Packages marked **publish** are published to npm under `@robota-sdk/` scope. All others are `private: true` and must NOT be published until explicitly approved.

| Package                   | Publish | npm tag | Notes                              |
| ------------------------- | ------- | ------- | ---------------------------------- |
| agent-core                | yes     | beta    | Foundation — zero @robota-sdk deps |
| agent-sessions            | yes     | beta    | Session management                 |
| agent-tools               | yes     | beta    | Built-in tool implementations      |
| agent-provider-anthropic  | yes     | beta    | Anthropic provider                 |
| agent-sdk                 | yes     | beta    | Assembly layer for CLI             |
| agent-cli                 | yes     | beta    | CLI binary (`robota` command)      |
| agent-event-service       | no      | —       | private: true                      |
| agent-plugin-\* (11 pkgs) | no      | —       | private: true, unused by CLI       |
| agent-provider-bytedance  | no      | —       | private: true                      |
| agent-provider-google     | no      | —       | private: true                      |
| agent-provider-openai     | no      | —       | private: true                      |
| agent-remote              | no      | —       | private: true                      |
| agent-remote-server-core  | no      | —       | private: true                      |
| agent-team                | no      | —       | private: true                      |
| agent-playground          | no      | —       | private: true                      |
| agent-tool-mcp            | no      | —       | private: true                      |
| dag-\* (all)              | no      | —       | private: true                      |
| dag-nodes/\* (10 pkgs)    | no      | —       | private: true                      |

**Rules:**

- Only packages in the **publish=yes** list may be published. Adding a new package to this list requires explicit user approval.
- Published packages must have `"private": false` and `"publishConfig": { "access": "public" }` in package.json.
- Non-published packages must have `"private": true`.
- Use `pnpm publish -r --tag <tag>` for batch publishing (never `npm publish`).

## DAG Dependency Direction

**Allowed dependency flow (strictly one-way, no cycles):**

```
dag-core  (contracts: interfaces, types, state machines, execution engine)
  ↑
dag-cost  (cost domain: CEL evaluator, cost meta types, storage port)
dag-adapters-local  (local adapters: in-memory ports + file-based storage; depends on dag-core + dag-cost)
dag-node  (node infrastructure: base class, IO, registries, schemas)
  ↑
dag-nodes/*  (concrete node implementations)
dag-orchestrator  (orchestration layer; depends on dag-core + dag-cost)
```

**Rules:**

- `dag-core` is the SSOT contract package. It defines interfaces and types only. It must NOT depend on `dag-node` or any implementation package in production dependencies.
- `dag-adapters-local` depends on `dag-core` and `dag-cost`. It provides lightweight local implementations (in-memory and file-based) of port interfaces for testing, local development, and demos.
- `dag-node` depends on `dag-core` for type imports. It provides node authoring infrastructure (classes, factories, registries).
- `dag-nodes/*` depend on both `dag-node` (infrastructure) and `dag-core` (types).
- All other dag packages (`dag-runtime`, `dag-worker`, `dag-scheduler`, `dag-projection`, `dag-api`, `dag-designer`) depend on `dag-core` for contracts.
- `dag-designer` must NOT import runtime, worker, or scheduler implementations directly.
- `dag-designer` has devDependencies on `dag-node-*` packages for testing node catalog and port definitions. These are not production dependencies.
- **Bidirectional dependencies are prohibited.** If package A depends on package B in production dependencies, B must NOT depend on A.
- devDependencies for testing (e.g., using implementation fixtures in contract tests) are allowed and do not constitute a production dependency cycle.
- Pass-through re-exports (`export * from '@robota-sdk/other-package'`) from lower-level to higher-level packages are prohibited. Consumers must import from the owning package directly.
