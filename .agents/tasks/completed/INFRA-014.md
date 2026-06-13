# INFRA-014 — Migrate apps/agent-server interface-type imports + extend the guard to apps

Spec: `.agents/spec-docs/todo/INFRA-014-agent-server-interface-imports.md`
Type: INFRA · Status: approved → in-progress

## Tasks

### TC-01 — Migrate agent-server moved-type imports to agent-interface-transport

- [x] Add `@robota-sdk/agent-interface-transport: workspace:*` to `apps/agent-server/package.json` dependencies
- [x] Add the matching surgical `pnpm-lock.yaml` entry (`link:../../packages/agent-interface-transport`, mirroring DATA-001/INFRA-013)
- [x] Repoint `IInteractiveSessionStore` in `apps/agent-server/src/session/persistent-session-store.ts:3` from `@robota-sdk/agent-framework` to `@robota-sdk/agent-interface-transport`
- [x] Repoint `IToolState` in `apps/agent-server/src/routes/handlers/playground-session-submit.ts:3` from `@robota-sdk/agent-framework` to `@robota-sdk/agent-interface-transport`
- [x] Keep `TBackgroundTaskEvent` importing from its current/correct (agent-executor-owned) source
- [x] Verify: `rg` for the moved types imported from `@robota-sdk/agent-framework` in `apps/agent-server/src` returns nothing

### TC-02 — Extend the interface-import guard to scan apps

- [x] Extend `scripts/harness/check-interface-imports.mjs` scan domain to also cover `apps/*/src/**`
- [x] Run the guard → must report PASS (0 violations) across packages AND apps after TC-01
- [x] Confirm the guard mechanically flags a moved-type framework import in an app (negative-case demonstration)

### TC-03 — Full green gate + frozen lockfile

- [x] `pnpm build` green (affected packages)
- [x] `pnpm typecheck` green (affected packages)
- [x] `pnpm test` green (affected packages)
- [x] `pnpm harness:scan` exit 0 (including the extended guard)
- [x] `pnpm install --frozen-lockfile` passes

## Test Plan

Each Completion Criterion is verified by command-form evidence captured at GATE-VERIFY/GATE-COMPLETE. TC-01 confirms the two app imports now resolve to agent-interface-transport; TC-02 confirms the guard now enforces the rule for apps too; TC-03 confirms the full build/typecheck/test/scan/frozen-lockfile gate stays green.

| TC-ID | Test Type                     | Tool / Approach                                                                         | Notes           |
| ----- | ----------------------------- | --------------------------------------------------------------------------------------- | --------------- |
| TC-01 | CI pipeline smoke test        | `rg` over `apps/agent-server/src` confirms zero moved-type imports from agent-framework | Command-form    |
| TC-02 | CI pipeline smoke test        | Run the guard (now incl. apps) → exit 0; inspect logic that flags app framework imports | Command-form    |
| TC-03 | CI pipeline smoke + dep check | `pnpm build`/`typecheck`/`test`; `pnpm harness:scan`; `pnpm install --frozen-lockfile`  | Full green gate |
