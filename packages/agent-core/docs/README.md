# Agents Docs Index

`@robota-sdk/agent-core` is the foundation package for Robota execution, provider contracts, tools, history, usage metadata, and plugin hooks. It has no `@robota-sdk/agent-*` dependencies.

## Current Capabilities

- Provider request/response execution contracts and normalized history entries.
- Tool batch execution event plumbing for provider-requested tool calls.
- Execution usage metadata for provider token/cost summaries.
- Replay-oriented execution events for provider request boundaries, assistant commits, tool batches, tool requests, and tool results.

## Document Structure

- `SPEC.md`: Package scope, ownership boundaries, and canonical responsibilities.
- `ARCHITECTURE.md`: Architectural layers and design boundaries.
- `DEVELOPMENT.md`: Development workflow and quality expectations.
- `PLUGINS.md`: Plugin behavior/configuration guide (merged).
- `TYPE-OWNERSHIP-SPEC.md`: SSOT ownership rules.
- `TYPE-OWNERSHIP-INVENTORY.md`: SSOT audit inventory summary.

## Documentation Rules

- Use uppercase file names for canonical docs.
- Keep one topic per file and avoid duplicate guides.
- Move historical checklists to open-tasks/history docs, not package docs.
