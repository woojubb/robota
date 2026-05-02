# @robota-sdk/agent-command-agent

Composable `/agent` command module for Robota sessions.

This package contributes command metadata and execution for agent job control. It is intentionally outside `@robota-sdk/agent-sdk` so SDK consumers can choose whether to compose the command.

## Scope

- Parses `/agent` command input into job-control operations.
- Provides command metadata for SDK/CLI command registries.
- Delegates lifecycle work to runtime/SDK subagent managers instead of owning process execution directly.
- Complements the model-visible Agent tool: slash commands are user-invoked control flow, while `Agent({ jobs })` is the deterministic model-invoked batch path for explicit parallel requests.

## Typical Composition

`@robota-sdk/agent-sdk` can compose this module into an `InteractiveSession` command registry. The CLI renders it like any other SDK command and does not need package-specific command ownership.
