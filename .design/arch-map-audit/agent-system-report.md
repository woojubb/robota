# Audit Report: agent-system.md

File audited: `.agents/specs/architecture-map/agent-system.md`
Date: 2026-05-18

## Stale References

| Line | Current text                                                        | Correct text                                                 | Reason                                                                                                                                                                                                                                                                                                                                                                               |
| ---- | ------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 85   | `AgentWeb["agent-web\nNext.js product host"]`                       | `AgentWeb["apps/agent-web\nNext.js product host"]`           | The package formerly named `agent-web` was renamed to `agent-web-ui`. The app directory is `apps/agent-web` (its package.json name is `@robota-sdk/agent-web-ui`). The diagram should either use `apps/agent-web` to distinguish the app from the package, or update to `agent-web-ui`. Using the app path (`apps/agent-web`) is clearest since the diagram is showing the app host. |
| 90   | `Providers["agent-provider-openai / anthropic\nprovider adapters"]` | `Providers["agent-provider\nprovider adapters"]`             | `agent-provider-openai` and `agent-provider-anthropic` (and all other per-provider packages) have been consolidated into the single `agent-provider` package. Listing individual split packages is stale.                                                                                                                                                                            |
| 105  | `\| Product route and deployment host \| \`agent-web\``             | `\| Product route and deployment host \| \`apps/agent-web\`` | Same rename as line 85 — `agent-web` is now `agent-web-ui`. The app host lives in `apps/agent-web`; the label should reflect either the app directory name or the new package name `agent-web-ui`.                                                                                                                                                                                   |

## Missing References

The following packages exist in `packages/` but are not mentioned anywhere in `agent-system.md`:

- **`agent-interface-transport`** — Transport contract interfaces (`ITransportAdapter`, `IConfigurableTransport`, `ITransportConfig`). This is a contract/interface package that sits between `agent-transport` and its consumers. Its absence from the architecture map leaves the interface layer implicit.
- **`agent-interface-tui`** — TUI interaction contract interfaces (`ITuiPickerItem`, `ITuiCommandInteraction`, etc.). Same situation as `agent-interface-transport` — the interface layer is not represented.
- **`agent-team`** — Multi-agent teamwork / dynamic agent coordination. Omitted entirely from both the Agent Product Stack diagram and the ownership table.

## Summary

Three stale references were found:

1. `agent-web` appears twice (diagram node line 85, ownership table line 105) but should be `apps/agent-web` (or `agent-web-ui`) — the package was renamed from `agent-web` to `agent-web-ui`.
2. `agent-provider-openai / anthropic` in the Playground stack diagram (line 90) lists split provider package names that no longer exist; the consolidated `agent-provider` should be used instead.

Three packages are entirely absent from the architecture map:

- `agent-interface-transport` and `agent-interface-tui` — interface/contract packages that define the boundaries between transport implementations and their consumers.
- `agent-team` — multi-agent coordination package with no entry in either stack diagram or ownership table.

No structural diagram logic errors were found beyond the naming issues above. The dependency edges and ownership table entries that do exist are consistent with the current package structure.
