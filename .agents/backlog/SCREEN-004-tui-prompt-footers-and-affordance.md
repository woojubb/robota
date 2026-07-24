---
title: 'SCREEN-004: Standardize TUI prompt footers, selection symbols, and microcopy'
status: in-progress
created: 2026-06-26
priority: high
urgency: soon
area: packages/agent-transport-tui
depends_on: []
---

# Standardize TUI prompt footers, selection symbols, and microcopy

> **Progress (2026-07-24):** spec drafted —
> [`.agents/spec-docs/draft/SCREEN-004-tui-prompt-footers-and-affordance.md`](../spec-docs/draft/SCREEN-004-tui-prompt-footers-and-affordance.md)
> (GATE-WRITE). Note: 3 of the 5 findings below already landed since 2026-06-26 (ListPicker default
> footer, SlashAutocomplete footer + `> ` indicator, SessionPicker via ListPicker); the draft rescopes
> to the remaining footer-dialect drift, a shared key-hint SSOT, and the undocumented Esc hard-stop.
> Awaiting GATE-APPROVAL before implementation.

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
   Evidence: _to fill after implementation._
2. Open the permission and confirm prompts → footers use consistent phrasing.
   Evidence: _to fill after implementation._
