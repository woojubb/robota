---
title: 'SCREEN-004: Standardize TUI prompt footers, selection symbols, and microcopy'
status: done
created: 2026-06-26
priority: high
urgency: soon
area: packages/agent-transport-tui
depends_on: []
---

# Standardize TUI prompt footers, selection symbols, and microcopy

> **Spec renumbered to SCREEN-005** at GATE-APPROVAL (the SCREEN-004 spec ID was already taken by
> the done activity-count-separator spec; this backlog file keeps its own SCREEN-004 name):
> [`.agents/spec-docs/done/SCREEN-005-tui-prompt-footers-and-affordance.md`](../../spec-docs/done/SCREEN-005-tui-prompt-footers-and-affordance.md).
>
> **Progress (2026-07-24):** spec drafted (GATE-WRITE), GATE-APPROVAL ENDORSE with 8 binding
> constraints, implemented + verified + DONE the same day. Note: 3 of the 5 findings below already
> landed since 2026-06-26 (ListPicker default footer, SlashAutocomplete footer + `> ` indicator,
> SessionPicker via ListPicker); the spec rescoped to the remaining footer-dialect drift, a shared
> key-hint SSOT, and the undocumented Esc hard-stop.

## Outcome (2026-07-24)

- **SSOT shipped:** `packages/agent-transport-tui/src/key-hint-footer.tsx` — `IKeyHint`,
  `formatKeyHints()`, `<KeyHintFooter/>`, `KEY_HINT_SEPARATOR = ' · '`, `SELECTION_INDICATOR = '> '`,
  `SELECTION_INDICATOR_NONE = '  '`. Mechanics only; verbs supplied by callers; no config surface.
- **All nine footer call sites** (ListPicker default, SlashAutocomplete, TextPrompt, MenuSelect
  normal + error-state hint, MultiSelectList incl. dynamic `(min N)`, ConfirmPrompt,
  PermissionPrompt, ExecutionWorkspaceSwitcher) and **all selection-cursor call sites** (incl. the
  switcher's focused-row cursor and the ListPicker test fixture) migrated to the SSOT; the three
  dialects are gone. Confirm/Permission footers are identical (`←→ Navigate · Enter Confirm`) and
  omit Esc — the deliberate hard-stop is now a documented contract.
- **Anti-drift floor:** `src/__tests__/key-hint-consistency.test.tsx` round-trips the FULL footer
  inventory through `formatKeyHints` and enforces navigate → modify → primary → dismiss ordering.
- **SPEC contract:** `packages/agent-transport-tui/docs/SPEC.md` "Interaction Affordance Contract
  (SCREEN-005)" (grammar, Esc-suppression invariant, ↑↓ aliases, indicator constants, the `▸` and
  input-prompt-glyph exclusions).
- **Agent-run evidence:** `.agents/evals/scenarios/screen-005-prompt-footers-agent-run.md` — the
  three User Execution Test Scenarios pass on the built binary in a real PTY
  (`screen-005-prompt-footers.ptytest.ts`); package suite 465 tests green; pty suite 14 green.

## What

Make interaction affordance consistent across the Ink TUI prompt/selection components:

- **Footer key hints:** `ListPicker.tsx` and `SlashAutocomplete.tsx` render NO key legend
  — users cannot discover ↑↓ / Enter / Esc / Tab. Add a consistent dim footer hint.
- **Selection symbol consistency:** `SlashAutocomplete.tsx:52` uses `▸` while every other
  component uses `> `. Standardize on one selection indicator.
- **Footer language parity:** `MenuSelect`, `ConfirmPrompt`, `PermissionPrompt`,
  `TextPrompt` use inconsistent footer phrasing ("arrow keys" / "left/right" / "Enter
  Submit"), implying different keybindings. Adopt one template:
  `↑↓ Navigate · Enter <verb> · Esc <cancel>`.
- **Missing nav hint:** `SessionPicker.tsx` title mentions Esc-to-cancel but not how to
  navigate the list. Add navigation hint.
- **Esc disabled, unexplained:** `ConfirmPrompt`/`PermissionPrompt` disable Esc; surface
  this in the footer (or note it is an intentional hard-stop).

## Why

Design review (2026-06-26): affordance/discoverability graded C — generic, highest-reuse
components (`ListPicker`) have zero hints, and fragmented footer language makes the prompts
feel like different systems.

## Findings addressed

- ListPicker / SlashAutocomplete: no key hints.
- `▸` vs `> ` selection-symbol inconsistency.
- Fragmented footer phrasing across the four prompts.
- SessionPicker missing nav hint; unexplained Esc suppression.

## Done When

- Every selectable/prompt component renders a consistent key-hint footer.
- One selection indicator across all components.
- SPEC.md for `agent-transport-tui` updated if any component contract/behavior changes.
- `pnpm --filter @robota-sdk/agent-transport-tui build` and tests pass.

## Test Plan

- Unit/snapshot tests for the shared footer hint where feasible.
- Build + typecheck the package.

## User Execution Test Scenarios

1. Run the CLI (`npx @robota-sdk/agent-cli`), trigger a slash autocomplete and a session
   picker → both show key hints (↑↓/Enter/Esc/Tab) and the same selection symbol.
   Evidence: agent-run on the built binary in a real PTY — `screen-005-prompt-footers.ptytest.ts`
   S1/S2 ✅ (see `.agents/evals/scenarios/screen-005-prompt-footers-agent-run.md`).
2. Open the permission and confirm prompts → footers use consistent phrasing.
   Evidence: identical `←→ Navigate · Enter Confirm` footers asserted by
   `key-hint-consistency.test.tsx`; permission prompt driven live in
   `screen-005-prompt-footers.ptytest.ts` S3 ✅ (Esc hard-stop verified).
