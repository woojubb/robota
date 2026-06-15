# Docs Audit Report — content/ core guides (2026-06-16)

Scope: content/getting-started, guide (~14), development, changelog, top-level content/\*.md. Excluded:
v2.0.0 (frozen), api-reference (generated), examples/integrations/plugins/ko (other agents).

## Summary

Reviewed 19 files. **8 stale**, 10 clean, 1 frozen snapshot accepted as-is.

## Findings

### HIGH

- **Transport split not reflected (widespread).** beta.76 split `agent-transport` into a lean core
  (only `./headless` + `./testing` remain) + standalone `@robota-sdk/agent-transport-{tui,http,ws,mcp}`.
  Docs still use old monolithic subpaths `agent-transport/{tui,http,ws,mcp}`:
  - `content/guide/architecture.md` — ~14 refs (Mermaid diagram, Package Roles, Dependency Flow,
    React/Ink table, Transport Layer table, "Changes from v2.0.0").
  - `content/guide/sdk.md` — transport table ~357–380 + "Assembly vs Direct Usage"; only
    `agent-transport/headless` still valid.
  - `content/guide/cli.md` — lines ~3, 5, 220 (`agent-transport/tui` → `@robota-sdk/agent-transport-tui`).
  - `content/README.md` — lines ~189, 213.
  - `content/development/README.md` — line ~50 monorepo tree.
- **Fictional plugin packages + non-existent API — `content/guide/cli.md` (~305–347).** Claims
  `@robota-sdk/plugin-{github,slack,jira,linear,notion}` with `GitHubPlugin` etc. via
  `agent.use(new GitHubPlugin())`. None exist; `Robota` has no `.use()`. Real: the 8 plugins in
  `@robota-sdk/agent-plugin`, registered via constructor `plugins: [...]`.
- **Incorrect quickstart — `content/quickstart.md` (~68–77).** `createAgentRuntime({ provider })`
  omits required `cwd`; `const response = await session.submit(...)` is wrong — `submit()` returns
  `Promise<void>` (interactive-session.ts). Reply comes via the `complete` event or `createQuery()`.

### MEDIUM

- **`content/guide/migration.md`** — presents non-existent `@robota-sdk/agent-team` as current 3.0.0
  (~26, 227–243) with `createTeam`/`TeamContainer`/`createAssignTaskRelayTool`/`agent.addTool()` +
  dead link to `packages/agent-team/docs/SPEC.md`. No such package.
- **`content/guide/local-llm.md` (~66–72)** — documents `ROBOTA_PROVIDER/BASE_URL/MODEL/API_KEY`
  env-var config that does not exist. Real config: `robota --configure` / settings.json.
- **`content/changelog/README.md`** — latest entry Beta 67 (2026-05-23); ground truth beta.76. Missing
  transport split + agent-session-analytics entries.
- **`agent-session-analytics` (new public package) undocumented** in README.md, architecture.md,
  development/README.md package lists/diagrams.

## Clean files (verified against source)

getting-started/README.md, guide/README.md, building-agents.md, providers.md, embedding.md,
plugins.md, error-handling.md (12 error classes confirmed), context-management.md,
permissions-and-hooks.md. `release-2026-05-02.md` is a frozen Beta 59 snapshot (old names historically
correct — accept).

## Caveat

Built `packages/*/src` is minified; some exact strings (SessionManager, `complete` payload field,
specific model IDs) couldn't be string-confirmed. Findings rest on package.json `exports`, package
existence/absence, and un-minified declarations.
