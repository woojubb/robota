# Tasks — SCREEN-002: TUI status bar below input

Spec: `.agents/spec-docs/active/SCREEN-002-tui-statusbar-below-input.md`
Test Plan SSOT: the spec's TC table.

NOTE: shipped in 3.0.0-beta.73; GATE-APPROVAL passed 2026-06-05, tasks file never created.
Retroactive closure — current code satisfies every TC. No code change.

- [x] T1 (TC-01): status bar renders below the input box — `App.tsx` renders `<InputArea>`
      before `<SessionStatusBar>` in the `flexDirection="column"` tree.
- [x] T2 (TC-02): no gap/overlap between input box and status bar (adjacent children).
- [x] T3 (TC-03): typecheck exits 0 (CI-green on develop).
- [x] T4 (TC-04): test exits 0 (473 tests green).
- [x] T5 (TC-05): build exits 0.
- [x] T6: wrap-up — spec → done; tasks archived.

## Test Plan

Authoritative TC table: the spec's `## Test Plan`. Manual TC-01/02 corroborated by the
real-PTY evidence in `.agents/backlog/completed/CLI-B13-tui-input-border-cleanup.md`
(status bar renders as a single plain line directly below the input bottom border);
TC-03/04/05 by develop CI green.
