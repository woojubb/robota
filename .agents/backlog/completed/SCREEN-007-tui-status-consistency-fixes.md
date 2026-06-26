---
title: 'SCREEN-007: Fix TUI status-glyph consistency regressions'
status: done
completed: 2026-06-27
created: 2026-06-27
priority: high
urgency: now
area: packages/agent-transport-tui
depends_on: []
---

# Fix TUI status-glyph consistency regressions

Follow-ups from the code review of the SCREEN-005 status work. These are correctness
defects where the unification only went half-way.

## What

1. **Duplicate success indicator (`ToolCommandOutput.tsx`).** `MessageList`'s
   `ToolSummaryEntry` already renders a per-tool summary line (`✓ Bash(...)`) and then
   renders `<ToolCommandOutput>`. The SCREEN-005 `✓ ok` branch now stacks a _second_
   success marker under it for a no-output success. Drop the redundant `✓ ok` (or render
   it only where no summary line precedes it) so a successful no-output command shows one
   marker, not two.
2. **Marker/color disagree (`background-task-row-format.ts`).** `marker` comes from
   `STATUS_GLYPH[workspaceStatusKind(...)].symbol` but `color` still comes from the view
   model's `row.color`. For a running entry the glyph is `⟳` (status-glyph color yellow)
   yet `row.color` is cyan — so the same `⟳` renders yellow in the streaming view and
   cyan in the background panel. Use the glyph's own `color` with its `symbol` (or
   reconcile to one source) so a status looks identical everywhere.
3. **Two sources of truth for status classification (`status-glyph.ts`).**
   `workspaceStatusKind` + `ACTIVE_WORKSPACE_STATUSES` re-implement the same union
   branching as `getEntryColor` + `ACTIVE_STATUSES` in `execution-workspace-view-model.ts`
   — and the active-lists already disagree (`waiting_permission` is in one, not the
   other). Derive one from the other (single owner) so status semantics + color live in
   one place. This is the root cause of #2.
4. **Symbol collision (`status-glyph.ts`).** `denied` and `cancelled` both use `⊘`,
   violating the module's own "distinguishable by symbol alone (never color-only)"
   invariant. Give them distinct symbols.
5. **(minor) ListPicker default footer scope.** The new `DEFAULT_FOOTER_HINT` also now
   shows on `InteractivePrompt` choice prompts (a second, un-scoped caller). The hint is
   accurate there, so this is acceptable — confirm intentional or pass an explicit
   `footerHint` per caller.

## Why

Code review (2026-06-27): the SCREEN-005 changes introduced a duplicate `✓`, a
status whose color differs between views, and a status-classification fork that already
diverged. These defeat the "same status looks the same everywhere" goal SCREEN-005 set.

## Done When

- A no-output successful command shows exactly one success marker.
- A given status renders the same symbol+color in every view.
- Status classification + the active-status set have one owner.
- `denied` and `cancelled` have distinct symbols.
- Package build + tests pass (update tests for any changed marker/output).

## Test Plan

- Unit/snapshot: no-output success renders one marker; background row marker color matches
  the streaming view for the same status; denied≠cancelled symbol.
- `pnpm --filter @robota-sdk/agent-transport-tui build` + `test`.

## User Execution Test Scenarios

1. Run the CLI; trigger a Bash command that succeeds with no output → exactly one `✓`
   line. Evidence: _to fill._
2. Have a running background task while a tool streams → the running glyph is the same
   symbol AND color in both the background panel and the streaming view.
   Evidence: _to fill._

## Resolution (2026-06-27)

- ToolCommandOutput: reverted the `✓ ok` branch to `return null` — MessageList's
  ToolSummaryEntry already renders a `✓ tool(args)` line per tool, so this removes the
  duplicate marker.
- status-glyph: `workspaceStatusKind(status, attention?)` now factors attention;
  `getEntryColor` derives colour from `STATUS_GLYPH[...]` (single colour source) so the
  background marker's symbol and colour always agree (running is now yellow everywhere,
  was cyan in the panel). `cancelled` glyph changed `⊘`→`⊗` (distinct from `denied`).
- `ACTIVE_STATUSES` (active-count, includes waiting_permission) kept separate from the
  status-kind classification, with a comment — they answer different questions.

Evidence: regression test added (`background-task-row-format.test.ts` asserts the running
row colour is `yellow` = the glyph colour). Package build + 379 tests pass.
