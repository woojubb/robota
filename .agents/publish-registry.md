# Publish Registry

Parent: [project-structure.md](project-structure.md)

Packages marked **publish: yes** are published to npm under `@robota-sdk/` scope.
All others must have `"private": true` in their package.json and MUST NOT be published until explicitly approved.

Last audited: 2026-05-25 (pre-release readiness audit, REL-007)

## Published Packages

| Package                             | npm tag | Notes                                                                          |
| ----------------------------------- | ------- | ------------------------------------------------------------------------------ |
| `@robota-sdk/agent-core`            | beta    | Foundation — zero @robota-sdk deps. Must stay zero-dep.                        |
| `@robota-sdk/agent-session`         | beta    | Session lifecycle: permissions, hooks, compaction                              |
| `@robota-sdk/agent-tools`           | beta    | Tool infrastructure + 8 built-in tools                                         |
| `@robota-sdk/agent-provider`        | beta    | Consolidated providers — sub-paths: /anthropic, /openai, /gemini, /deepseek, … |
| `@robota-sdk/agent-executor`        | —       | **private: true** — internal background-task primitives                        |
| `@robota-sdk/agent-framework`       | beta    | Assembly layer: InteractiveSession, createQuery(), config/context loading      |
| `@robota-sdk/agent-preset`          | beta    | Preset contract (IPreset) + resolvePreset + built-in presets                   |
| `@robota-sdk/agent-command`         | beta    | Slash command modules (/agent, /help, /provider, /skills, …)                   |
| `@robota-sdk/agent-transport`       | beta    | Consolidated transport: /tui, /headless, /http, /ws, /mcp                      |
| `@robota-sdk/agent-subagent-runner` | beta    | Opt-in child-process subagent runner                                           |
| `@robota-sdk/agent-cli`             | beta    | CLI binary (`robota` command)                                                  |
| `@robota-sdk/agent-plugin`          | beta    | Plugin infrastructure for bundle plugins                                       |
| `@robota-sdk/plugin-github`         | beta    | GitHub integration plugin                                                      |
| `@robota-sdk/plugin-jira`           | beta    | Jira integration plugin                                                        |
| `@robota-sdk/plugin-linear`         | beta    | Linear integration plugin                                                      |
| `@robota-sdk/plugin-notion`         | beta    | Notion integration plugin                                                      |
| `@robota-sdk/plugin-slack`          | beta    | Slack integration plugin                                                       |

## Private Packages (must NOT be published)

| Package                                 | Reason                                                    |
| --------------------------------------- | --------------------------------------------------------- |
| `@robota-sdk/agent-executor`            | Internal background-task primitives, not consumer-facing  |
| `@robota-sdk/agent-interface-transport` | Internal interface layer, superseded by agent-transport   |
| `@robota-sdk/agent-interface-tui`       | Internal TUI interface, superseded by agent-transport/tui |
| `@robota-sdk/agent-web-ui`              | Internal web UI components, not standalone                |
| `@robota-sdk/agent-playground`          | Development playground app                                |
| `@robota-sdk/agent-remote-client`       | Internal remote client                                    |
| `@robota-sdk/agent-tool-mcp`            | Experimental MCP tool adapter                             |

## Rules

- Only packages in the **Published Packages** table may be published. Adding a new package requires explicit user approval.
- Published packages must have `"private"` absent or `false`, and `"publishConfig": { "access": "public" }` in package.json.
- Private packages must have `"private": true`.
- Use `pnpm publish:beta` for batch publishing (never `npm publish` or `pnpm -r publish` directly).
- Always run a dry-run (`pnpm publish:beta --dry-run`) before the real publish to verify the package list.
