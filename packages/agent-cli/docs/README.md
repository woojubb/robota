# Agent CLI Docs

`@robota-sdk/agent-cli` provides `__PRODUCT_CLI_NAME__`, an AI coding assistant for the terminal and the
maintained agent interface built from the Robota libraries. The CLI owns argument parsing, the choice of
presentation — the terminal UI, print mode (`-p`), the headless runtime behind `--serve` and the
desktop app, and `__PRODUCT_CLI_NAME__ mcp serve` — and the local host adapters those need. Sessions, commands,
tools and permissions live in the SDK packages below it, chiefly `@robota-sdk/agent-framework`; the
terminal UI itself is `@robota-sdk/agent-ui-terminal`.

For installation and a tour of what the CLI does, see the [package README](../README.md).

## Documents

- [SPEC.md](./SPEC.md) — what the CLI owns, what it must not own, and the guarantees it keeps.
- [README-KO.md](./README-KO.md) — Korean translation of the package README.
- [DEMO-SCRIPT.md](./DEMO-SCRIPT.md) — how the demo GIF in the README is recorded and regenerated.

### Design notes

These describe internals for contributors; nothing in them is a promise to users.

- [design/command-registry.md](./design/command-registry.md) — how a slash command or skill travels
  from an input line to the prompt the model runs.
- [design/composition.md](./design/composition.md) — how one `__PRODUCT_CLI_NAME__` run assembles the product,
  binds it to a mode and registers transports.
- [design/internal-structure.md](./design/internal-structure.md) — a map of the CLI's source.
- [design/message-architecture.md](./design/message-architecture.md) — which message type the
  terminal UI's message list holds and how tool messages are told apart.
- [design/session-ownership.md](./design/session-ownership.md) — which object holds the live session
  in the terminal UI, and how the UI reaches it.
- [design/subagent-wiring.md](./design/subagent-wiring.md) — the process adapters the CLI injects for
  background shells and child-process subagents.
