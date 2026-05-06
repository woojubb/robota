# @robota-sdk/agent-command-agent

Composable `agent` command module for Robota sessions. User-facing shells render and parse it as `/agent`; SDK command identity remains `agent`.

This package contributes command metadata and execution for agent job control. It is intentionally outside `@robota-sdk/agent-sdk` so SDK consumers can choose whether to compose the command.

## Scope

- Parses `agent` command input into job-control operations after a shell strips the user-facing slash.
- Provides command metadata for SDK/CLI command registries.
- Delegates lifecycle work to runtime/SDK subagent managers instead of owning process execution directly.
- Provides the model-visible `agent` command through the standard `ExecuteCommand` route. There is no parallel model-visible `Agent` tool route.

## Typical Composition

`@robota-sdk/agent-sdk` can compose this module into an `InteractiveSession` command registry. The CLI renders it like any other SDK command and does not need package-specific command ownership.
