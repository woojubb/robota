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
├── agent-command-*/             # Command modules: agent, background, compact, context, exit, help, language, memory, mode, model, permissions, plugin, provider, reset, rewind, session, skills, statusline, user-local
├── agent-cli/                   # Terminal UI and local runtime adapters
├── agent-provider-*/            # Provider packages: anthropic, openai, openai-compatible, deepseek, gemma, qwen, gemini, google, bytedance
├── agent-team/                  # Team collaboration (assignTask relay tools)
├── agent-playground/            # Playground UI package
├── agent-remote-client/         # Remote execution client
├── agent-transport-*/           # Transports: headless, http, mcp, ws
└── agent-plugin-*/              # Plugins: conversation-history, logging, usage, performance, execution-analytics, error-handling, limits, event-emitter, webhook
apps/
├── agent-web/              # Web application (Agent Playground)
├── blog/                   # Blog/content application
├── docs/                   # Documentation site
└── agent-server/           # AI provider proxy + Playground WebSocket
```

## Related Documents

| Document                                                                                         | Content                                   |
| ------------------------------------------------------------------------------------------------ | ----------------------------------------- |
| [specs/ARCHITECTURE-MAP.md](specs/ARCHITECTURE-MAP.md)                                           | Repository-level architecture map router  |
| [specs/architecture-map/README.md](specs/architecture-map/README.md)                             | Architecture-map document tree            |
| [publish-registry.md](publish-registry.md)                                                       | npm publish rules, package registry table |
| [../packages/agent-cli/docs/ARCHITECTURE-MAP.md](../packages/agent-cli/docs/ARCHITECTURE-MAP.md) | CLI architecture map router               |

## Command Package Rule

User-visible internal commands belong in `agent-command-*` packages or command-module owners that consume `@robota-sdk/agent-sdk` command contracts. `agent-sdk` owns command infrastructure and reusable common APIs; `agent-cli` composes selected modules and renders generic UI.
