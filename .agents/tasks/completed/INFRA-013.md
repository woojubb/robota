# INFRA-013 — Enforce the interface-import rule + migrate the last consumer (INFRA-010 L3)

Spec: `.agents/spec-docs/todo/INFRA-013-enforce-interface-import-rule.md`
Type: RULE · Status: approved → in-progress

## Tasks

### TC-01 — Migrate agent-command moved-type imports to agent-interface-transport

- [x] Add `@robota-sdk/agent-interface-transport: workspace:*` to `packages/agent-command/package.json` dependencies
- [x] Add the matching `dependencies:` block to `pnpm-lock.yaml` surgically (`link:../agent-interface-transport`)
- [x] Repoint the 15 moved interface types in `agent-command/src/**` (`ICommandResult`, `ICommand`, `ICommandInteraction`, `ICommandListEntry`, `ICommandPluginAdapter`, `ICommandSource`, `IContextReferenceItem`, `IMemoryEvent`, `TCommandInteractionPrompt`, `TPluginInstallScope`, `TStatusLineCommandSettingsPatch`, …) from `@robota-sdk/agent-framework` to `@robota-sdk/agent-interface-transport`
- [x] Keep runtime values + `TInteractiveSessionOptions` importing from agent-framework (as in L2)
- [x] Verify: `rg` for the moved types imported from `@robota-sdk/agent-framework` in `agent-command/src` returns nothing

### TC-02 — Add and wire the interface-import guard

- [x] Create `scripts/harness/check-interface-imports.mjs` (or extend `check-architecture-conformance.mjs`): compute the `agent-interface-transport` export set; for every package except `agent-framework` and `agent-interface-*`, fail if a `src/**` file imports any of those names from `@robota-sdk/agent-framework`
- [x] Wire the guard into the conformance gate (`check-architecture-conformance.mjs`) and/or `run-all-scans.mjs`
- [x] Run the guard → must report PASS (0 violations) after TC-01
- [x] Confirm the guard logic mechanically flags a moved-type framework import in any package (negative-case demonstration)

### TC-03 — Full green gate + rule prose update

- [x] `pnpm build` green
- [x] `pnpm typecheck` green
- [x] `pnpm test` green
- [x] `pnpm harness:scan` exit 0 (including the new guard + conformance)
- [x] `pnpm install --frozen-lockfile` passes
- [x] Update `.agents/project-structure.md` Interface Package Rule prose to state the enforced reality and name the guard

## Test Plan

Each Completion Criterion is verified by command-form evidence captured at GATE-VERIFY/GATE-COMPLETE.

| TC-ID | Test Type                     | Tool / Approach                                                                        | Notes           |
| ----- | ----------------------------- | -------------------------------------------------------------------------------------- | --------------- |
| TC-01 | CI pipeline smoke test        | `rg` over `agent-command/src` confirms zero moved-type imports from agent-framework    | Command-form    |
| TC-02 | CI pipeline smoke test        | Run the new guard → exit 0; inspect logic that flags framework imports of moved types  | Command-form    |
| TC-03 | CI pipeline smoke + dep check | `pnpm build`/`typecheck`/`test`; `pnpm harness:scan`; `pnpm install --frozen-lockfile` | Full green gate |
