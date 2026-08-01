# BEHAVIOR-004: Document the FLOW wake/schedule/monitor contracts

> Spec: `.agents/spec-docs/todo/BEHAVIOR-004-document-wake-schedule-contracts.md`
> Closes INFRA-002 audit findings AF-07 (P1) + AF-09 (P1). Documentation-only change.

## Tasks

- [x] **TC-01 — Fix stale AF-07 WS Sidecar banner**
      Rewrite the WebSocket Sidecar Mode section in
      `.agents/specs/architecture-map/agent-system.md` (currently lines ~129-139). Remove the
      "[Planned — not yet implemented]" claim and the assertion that `createWsHandler` /
      `useWsSession` "do not exist". State that they are implemented with real `file:line`
      references (`packages/agent-transport/src/ws/ws-handler.ts:51`,
      `packages/agent-web-ui/src/hooks/useWsSession.ts:43`) and scope the remaining work to the
      CLI `--web` / `--web-port` flags + `startWebSidecarServer()`.

- [x] **TC-02 — Document the wake/schedule/monitor contracts (AF-09)**
  - Add a "Wake & Scheduling" section to `.agents/specs/background-task-layer.md` covering
    the scheduled-task-runner (cron / one-shot agent wake), the managed-shell-process
    monitor + line-wake-matcher, and the `background_task_waking` event.
  - Add `/schedule` and `/monitor` rows to `.agents/specs/command-inventory.md`.
  - Add the `spawnScheduledWake` / `spawnMonitorWake` host-context bridges
    (`packages/agent-framework/src/command-api/host-context.ts:152,161`) to
    `.agents/specs/architecture-map/cross-cutting-contracts.md`.

- [x] **TC-03 — Verify harness scan passes**
      Run `pnpm harness:scan` and confirm it exits 0 (including the conformance check) after the
      documentation edits above.

## Test Plan

This is a documentation-only change touching four architecture spec docs; no `packages/*`
production source is modified. Verification is mechanical via `rg` content checks and the
`pnpm harness:scan` gate (consistency + specs + docs structure + conformance, exit 0).

| TC-ID | Test Type              | Tool / Approach                                                       | Notes           |
| ----- | ---------------------- | --------------------------------------------------------------------- | --------------- |
| TC-01 | CI pipeline smoke test | `rg` over agent-system.md (no "do not exist"; partial-impl statement) | Command-form    |
| TC-02 | CI pipeline smoke test | `rg` over background-task-layer / command-inventory / cross-cutting   | Command-form    |
| TC-03 | CI pipeline smoke test | `pnpm harness:scan` exit 0                                            | doc-only change |
