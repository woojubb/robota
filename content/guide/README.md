# Guide

Task-oriented guides for building agents with the Robota libraries and for using the `robota` CLI.

## Contents

- [Architecture](./architecture.md) — The package layers, why they are separate, and how a request moves through them
- [Building Agents](./building-agents.md) — The `Robota` agent class in `agent-core`: providers, tools, plugins, streaming, structured output
- [Using the SDK](./sdk.md) — `agent-framework` sessions: `InteractiveSession`, `createQuery()`, built-in tools, transports
- [CLI Reference](./cli.md) — Every `robota` option, subcommand and slash command
- [Sessions, Background Sessions and the Daemon](./sessions-and-daemon.md) — Sessions that outlive the terminal, attaching, one daemon per workspace, workspace trust
- [TUI Keybindings](./keybindings.md) — Contextual shortcuts, hot reload, chords, and terminal limits
- [Local LLM Setup](./local-llm.md) — Ollama, LM Studio and llama.cpp with no API key
- [Providers](./providers.md) — Every provider package, its options, and switching between them
- [Model Context Protocol (MCP)](./mcp.md) — Connecting to MCP servers, OAuth sign-in, `robota mcp serve`, external events
- [Embedding agent-framework](./embedding.md) — HTTP servers, bots, serverless functions and batch pipelines
- [Permissions and Hooks](./permissions-and-hooks.md) — Permission modes and rules, the OS sandbox, and lifecycle hooks
- [Devices, Peers and Remote Control](./devices-and-remote.md) — Messaging other sessions, linking your devices, handoff, co-driving from a browser
- [Context Management](./context-management.md) — Token tracking, compaction, and streaming
- [Error Handling](./error-handling.md) — The typed error hierarchy and how to handle provider failures
- [Plugins](./plugins.md) — Runtime plugins for the `Robota` class and CLI plugins for `robota`
- [Deployment](./deployment.md) — One session served over many channels through the transport registry
- [Migrating to 3.0](./migration.md) — Package and API changes from the 2.x packages and between 3.0 betas
