# Tasks — SCREEN-001: TUI input area border cleanup

Spec: `.agents/spec-docs/active/SCREEN-001-tui-input-border-cleanup.md`
Test Plan SSOT: the spec's TC table.

NOTE: this work shipped in 3.0.0-beta.73 (the GATE-APPROVAL was passed 2026-06-05 but the
tasks file was never created — a pipeline-bookkeeping gap). Closure is retroactive: the
current code already satisfies every TC; this file records that mapping for GATE-VERIFY/
GATE-COMPLETE. No code change.

- [x] T1 (TC-01): InputArea side borders removed — `BORDER_HORIZONTAL = 0`,
      `borderLeft={false} borderRight={false}` (InputArea.tsx).
- [x] T2 (TC-02): StatusBar root `<Box>` has no `borderStyle` — single plain line.
- [x] T3 (TC-03): `pnpm --filter @robota-sdk/agent-transport typecheck` exits 0 (CI-green on develop).
- [x] T4 (TC-04): `pnpm --filter @robota-sdk/agent-transport test` exits 0 (473 tests green).
- [x] T5 (TC-05): `pnpm --filter @robota-sdk/agent-transport build` exits 0.
- [x] T6 (TC-06): full-width borders at 60 cols — `innerWidth = terminalColumns - 0`; PTY
      evidence at 60 cols in CLI-B13 closure.
- [x] T7: wrap-up — spec → done; tasks archived.

## Test Plan

Authoritative TC table: the spec's `## Test Plan`. Manual TC-01/02/06 are corroborated by
the real-PTY evidence recorded in `.agents/backlog/completed/CLI-B13-tui-input-border-cleanup.md`;
TC-03/04/05 by develop CI green.
