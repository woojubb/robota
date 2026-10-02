# Examples

Short walkthroughs, each focused on one task with the Robota libraries or the `__PRODUCT_CLI_NAME__` CLI. Every
snippet uses the packages' current public APIs. For complete projects you can clone and run (web
servers, bots, scripts, single-capability demos), see [examples/](../../examples/README.md) in the
repository.

## Agent core

- [Basic Conversation](./basic-conversation.md) — an agent that keeps conversation history across runs
- [Tool Calling](./tool-calling.md) — Zod-validated function tools, built-in file and shell tools, and
  sandboxed tools
- [Multi-Provider](./multi-provider.md) — registering Anthropic, OpenAI, DeepSeek, Gemini, Gemma and
  Qwen on one agent and switching between them
- [Streaming](./streaming.md) — text as the model generates it

## Sessions

- [One-Shot Query](./one-shot-query.md) — a prompt-in, answer-out function with `createQuery()`
- [Session Management](./session-management.md) — `InteractiveSession` events, persistence, resume and
  fork

## CLI

- [Interactive Mode](./interactive-mode.md) — the terminal UI: slash commands, permission prompts,
  status line
- [Print Mode](./print-mode.md) — `__PRODUCT_CLI_NAME__ -p` for scripts and pipelines

## Transports

- [HTTP Transport](./http-transport.md) — a session behind REST endpoints with SSE streaming
- [WebSocket Transport](./ws-transport.md) — a session over a WebSocket connection
- [MCP Transport](./mcp-transport.md) — a session as a Model Context Protocol server
