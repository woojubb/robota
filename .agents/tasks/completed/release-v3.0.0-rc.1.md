# Release v3.0.0-rc.1

## Status: in_progress

## Publish Manifest

First npm publish for the Robota SDK. Only packages in the agent-sdk/cli dependency chain are published. All others are deferred until they are integrated and ready.

### Packages to Publish

| #   | Package                                | Version    | Status      | Reason                                               |
| --- | -------------------------------------- | ---------- | ----------- | ---------------------------------------------------- |
| 1   | `@robota-sdk/agent-core`               | 3.0.0-rc.1 | **PUBLISH** | Foundation — permissions, hooks, context types added |
| 2   | `@robota-sdk/agent-tools`              | 3.0.0-rc.1 | **PUBLISH** | 6 built-in tools, TToolResult, tool infra            |
| 3   | `@robota-sdk/agent-provider-anthropic` | 3.0.0-rc.1 | **PUBLISH** | Streaming, multi-block content support               |
| 4   | `@robota-sdk/agent-sessions`           | 3.0.0-rc.1 | **PUBLISH** | Session, SessionStore, context management            |
| 5   | `@robota-sdk/agent-sdk`                | 3.0.0-rc.1 | **PUBLISH** | query() entry point, config/context loading          |
| 6   | `@robota-sdk/agent-cli`                | 3.0.0-rc.1 | **PUBLISH** | Ink TUI, slash commands, permission prompt           |

### Packages Deferred (not published in this release)

| Package                                   | Reason                             |
| ----------------------------------------- | ---------------------------------- |
| `@robota-sdk/agent-event-service`         | Not yet connected to agent-sdk     |
| `@robota-sdk/agent-team`                  | Not yet connected to agent-sdk     |
| `@robota-sdk/agent-tool-mcp`              | Not yet connected to agent-sdk     |
| `@robota-sdk/agent-remote`                | Playground/server use only         |
| `@robota-sdk/agent-remote-server-core`    | Server infrastructure              |
| `@robota-sdk/agent-playground`            | Browser UI, separate concern       |
| `@robota-sdk/agent-plugin-*` (8 packages) | Not yet connected to agent-sdk     |
| `@robota-sdk/agent-provider-openai`       | Not used by agent-sdk yet          |
| `@robota-sdk/agent-provider-google`       | Not used by agent-sdk yet          |
| `@robota-sdk/agent-provider-bytedance`    | Not used by agent-sdk yet          |
| `@robota-sdk/dag-*` (7 packages)          | DAG system, separate release cycle |

### Publish Order (dependency order)

```
1. agent-core           (no workspace deps)
2. agent-tools          (depends on agent-core)
3. agent-provider-anthropic (depends on agent-core)
4. agent-sessions       (depends on agent-core, agent-tools, agent-provider-anthropic)
5. agent-sdk            (depends on agent-sessions, agent-core, agent-tools, agent-provider-anthropic)
6. agent-cli            (depends on agent-sdk)
```

### Pre-Publish Checklist

- [ ] All 6 package versions set to 3.0.0-rc.1
- [ ] `pnpm build` passes
- [ ] `pnpm test` passes
- [ ] `pnpm typecheck` passes
- [ ] `pnpm lint` passes
- [ ] `pnpm pre-publish:check` passes (README, SPEC, description, license)
- [ ] `publish --dry-run` passes for each package
- [ ] User confirmed publish manifest (this document)

### Decision Record

- All 35 packages have never been published to npm (confirmed 2026-03-20)
- Only the agent-sdk/cli dependency chain (6 packages) is ready for first publish
- Deferred packages will be published when integrated into agent-sdk
- RC release is tagged `3.0.0-rc.1` (pre-release, not latest on npm)
