---
title: 'SCREEN-2002: Configure accessible TUI themes and reduced motion'
issue: https://github.com/woojubb/robota/issues/2002
status: todo
created: 2026-09-14
priority: high
urgency: now
area: packages/agent-framework, packages/agent-command, terminal UI package
depends_on: [STRUCT-012, REFACTOR-025, BEHAVIOR-2003]
---

# SCREEN-2002: Configure accessible TUI themes and reduced motion

## Objective

Turn the existing fixed semantic palette into a runtime theme registry with light, dark and daltonized
built-ins, user and plugin themes, an interactive picker, an orthogonal syntax-highlighting toggle and a
reduced-motion setting. Preserve text/glyph distinctions so color is never the only signal.

## Plan

- [ ] Define complete theme tokens, built-ins, user/plugin contribution precedence and visible validation.
- [ ] Add the theme picker and persist the selection through the existing settings owner.
- [ ] Make syntax highlighting and reduced motion independent controls.
- [ ] Derive all Ink/markdown color and motion behavior from the resolved theme and verify live switching.

## Test Plan

Test token completeness, precedence, invalid themes, syntax/motion independence and color-stripped semantics.
Run a PTY scenario that switches built-in/custom/plugin themes and reduced motion without restarting.

## User Execution Test Scenarios

<!-- backlog-execution.md § User Execution Test Scenario Rule. Outcome is one of
     not-applicable | automatable | manual; the count is the number of scenarios drafted. Keep the
     not-applicable form ONLY with a product-surface reason (≥ 50 characters, not build/typecheck
     evidence); otherwise write the scenario a user can run and raise the count. -->

**Author verdict:** `SCENARIO DRAFTED: automatable | 1`

Open the TUI theme picker, switch among dark, light and daltonized themes, load a temporary custom/plugin
theme, toggle syntax highlighting and reduced motion, and observe immediate independent changes.
