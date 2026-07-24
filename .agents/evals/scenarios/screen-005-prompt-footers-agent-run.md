# SCREEN-005 — TUI prompt footers & key-hint affordance (agent-run)

**Spec:** `.agents/spec-docs/done/SCREEN-005-tui-prompt-footers-and-affordance.md` (renumbered from
SCREEN-004 — that ID was taken by the done activity-count-separator spec).
**Type:** agent-executable — the agent builds the CLI and drives the three User Execution Test
Scenarios on the **built `robota` binary in a real PTY**; no owner terminal smoke.

Before SCREEN-005, three incompatible footer dialects coexisted across nine call sites (two-space
keycap pairs, single-space run-on, prose), the confirm/permission prompts described the same reducer
with different words ("arrow keys" vs "left/right"), and the deliberate Esc hard-stop on
confirm/permission prompts was undocumented. SCREEN-005 introduces the package-local SSOT
(`packages/agent-transport-tui/src/key-hint-footer.tsx`: `IKeyHint`, `formatKeyHints`,
`KeyHintFooter`, `KEY_HINT_SEPARATOR = ' · '`, `SELECTION_INDICATOR`/`_NONE`) and migrates every
footer/indicator call site onto it.

## Scenario

```bash
pnpm build:deps   # built robota binary for the PTY suite

# The three User Execution Test Scenarios, on the real binary in a real PTY:
pnpm --filter @robota-sdk/agent-transport-tui test:pty   # includes screen-005-prompt-footers.ptytest.ts

# Anti-drift floor + per-component footer assertions (default suite):
pnpm --filter @robota-sdk/agent-transport-tui test
```

**Expected:** S1 — typing `/` shows `↑↓ Navigate · Tab Complete · Enter Select · Esc Close` and the
`> ` indicator on the selected row. S2 — a replayed model turn drives a CMD-004 ask in all three
shapes; every footer shares the grammar; the multi-select shows `Enter Confirm (min 1)` until a
toggle satisfies it. S3 — a replayed Shell call opens the permission prompt with
`←→ Navigate · Enter Confirm` (no Esc listed); pressing Esc resolves nothing; `y` resolves it and
the turn continues.

## Observed (2026-07-24)

`src/__tests__/pty/screen-005-prompt-footers.ptytest.ts` against the built binary:

```
✓ S1: slash autocomplete shows the unified footer and the > indicator on the selected row  647ms
✓ S2: single-select, multi-select (dynamic min segment), and free-text asks share the grammar  1865ms
✓ S3: permission prompt names the real keys and Esc resolves nothing (explicit hard-stop)  1511ms
Test Files  1 passed (1) / Tests  3 passed (3)
```

Full PTY suite (no regressions on the shared binary): `Test Files 9 passed (9) / Tests 14 passed (14)`.
Default suite incl. the `key-hint-consistency` anti-drift guard (full footer inventory round-trips
through `formatKeyHints` in navigate → modify → primary → dismiss order; Confirm/Permission footers
identical and Esc-free): `Test Files 61 passed (61) / Tests 465 passed (465)`.

Red-before-green (HARNESS-041): the per-component footer assertions were run against the
pre-migration literals first — `Tests 8 failed | 51 passed` (ListPicker, MenuSelect normal + error
hint, PendingActionPrompt multi-select, SlashAutocomplete, TextPrompt, ConfirmPrompt,
ExecutionWorkspaceSwitcher) — then went green only after the components migrated to the SSOT.

✅ PASS — all three User Execution Test Scenarios verified agent-run on the real binary; the
mechanical anti-drift floor is in place so a fourth footer dialect cannot re-appear silently.
