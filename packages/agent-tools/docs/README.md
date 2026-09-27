# agent-tools Docs

`@robota-sdk/agent-tools` owns the Robota SDK's tool implementations: the Zod tool factories, the
built-in tools (Shell, Read, Write, Edit, Glob, Grep, WebFetch, WebSearch, AskUserQuestion,
ToolSearch), codebase retrieval and computer-use tools, and the sandbox clients and workspace
manifests. The tool contract (`FunctionTool`, `ToolRegistry`) belongs to `@robota-sdk/agent-core`.

## Documents

- [Package README](../README.md) — usage, the built-in tools and the sandbox clients.
- [SPEC.md](./SPEC.md) — package contract, containment rules and design decisions.
