# agent-tools Docs

`@robota-sdk/agent-tools` owns the Robota SDK's tool implementations: the Zod tool factories, the
built-in tools (Shell, Read, Write, Edit, Glob, Grep, WebFetch, AskUserQuestion,
ToolSearch), codebase retrieval and computer-use tools, and the sandbox clients and workspace
manifests, and the SDK's default tool set on the Node-only `./defaults` entry. The tool contract
(`FunctionTool`, `ToolRegistry`) belongs to `@robota-sdk/agent-core`.

## Documents

- [Package README](../README.md) — usage, the built-in tools and the sandbox clients.
- [SPEC.md](./SPEC.md) — package contract, containment rules and design decisions.
- [defaults.md](./defaults.md) — the default tool set: usage, the tool table and the options.
