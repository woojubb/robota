---
title: 'CLI-077: decouple agent-cli from the unpublished workflow/DAG chain — optional /workflows'
status: done
created: 2026-07-05
completed: 2026-07-05
priority: high
urgency: now
area: packages/agent-cli, packages/agent-command-workflows, packages/dag-*
depends_on: []
---

# Decouple agent-cli from the unpublished workflow/DAG chain (optional /workflows)

Release-blocking for beta.77. `agent-cli` hard-imports `createWorkflowsCommandModule` from
`@robota-sdk/agent-command-workflows` (a `dependencies` entry), which transitively requires
`dag-builder`/`dag-core`/`dag-framework` and the wider DAG subsystem (21-package runtime closure).
The DAG/workflow track is in-progress and must stay unpublished (`private: true`). Publishing
`agent-cli@beta.77` with that hard dep would ship an uninstallable package (its `workspace:*` deps
resolve to versions that are not on npm).

## What

1. Make the `/workflows` command an **optional** module: load `@robota-sdk/agent-command-workflows`
   through a guarded `createRequire` in `command-setup.ts`; when the package is absent (default
   published install) omit the command, when present (monorepo dev / a user who installed it) register
   it. No hard static import.
2. Move `@robota-sdk/agent-command-workflows` from `dependencies` → `devDependencies` in agent-cli so
   the published package has no runtime edge into the DAG chain, while dev/tests still resolve it.
3. Mark the entire unpublished DAG/workflow subsystem `private: true` (per owner instruction, kept
   private until separately released): `agent-command-workflows`, `agent-testing` (never published,
   devDep-only test util), all `dag-*` (15), all `dag-node-*` (22).
4. SPEC: agent-cli — document `/workflows` as an optional, dynamically-loaded module.

The completion of the `/workflows` track (making it a first-class published capability) is tracked
separately — see the follow-on workflow-completion backlog.

## Test Plan

- `buildCommandSetup` registers `/workflows` when the module loads and omits it (no throw) when the
  loader returns undefined; the rest of the command modules are unaffected either way.

Also decoupled the sibling case found during the same audit: `agent-cli` hard-imported
`createReplayProviderFromLogFile` from `@robota-sdk/agent-provider-replay` (a `private` INFRA-017
test/replay util) for `--session-log`. Same treatment — `cli.ts` `loadReplayProvider` guarded load +
devDependency. After both moves the published `agent-cli` runtime closure contains no `private`/
unpublished package.

Privatized (per owner instruction, kept private until separately released): `agent-command-workflows`,
`agent-testing`, all `dag-*` (15) and `dag-nodes/*` (22) — 38 packages set `private: true`. Final
publishable set = the 19 previously-published agent-line packages + `agent-process` = exactly 20.

## Test Plan

- `buildCommandSetup` builds a non-empty module set without throwing regardless of the optional
  package; includes the workflows module iff its package resolves (never a partial/stub entry).
- Regression: agent-cli suite 155 passed; typecheck + lint (0 errors).

## User Execution Test Scenarios

- agent-executable. Built CLI (PTY) boots and reaches the prompt; `/workflows` present in dev, absent
  in the published shape.
- Evidence (2026-07-05, built CLI `packages/agent-cli/bin/robota.cjs` in a real PTY; driver was a
  disposable gitignored scratch script — superseded for regression by the git-tracked
  `command-setup-optional-workflows.test.ts`):
  - **Published-dependency proof (decisive):** `pnpm pack` of agent-cli → the published `package.json`
    lists 11 `@robota-sdk` runtime deps, ALL in the 20-package publish set; **zero** `private`/`dag-*`/
    `agent-command-workflows`/`agent-provider-replay` deps. `npm install @robota-sdk/agent-cli` resolves.
  - UE-1 (dev): built CLI boots to the prompt; `/workflows` is recognized (optional package resolvable).
  - UE-2 (published shape): with `agent-command-workflows/dist` hidden so `createRequire` fails, the
    built CLI still **boots gracefully** to the prompt and `/workflows` is absent (no crash).
  - Direct check: `createRequire(cli/dist).('@robota-sdk/agent-command-workflows').createWorkflowsCommandModule()`
    loads (`systemCommands: workflows`) — confirming the guarded load path is exercised, not dead.
