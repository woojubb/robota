---
title: 'BEHAVIOR-2003: Configure contextual TUI key bindings'
issue: https://github.com/woojubb/robota/issues/2003
status: todo
created: 2026-09-14
priority: high
urgency: now
area: packages/agent-framework, packages/agent-command, terminal UI package
depends_on: [STRUCT-012, REFACTOR-025]
---

# BEHAVIOR-2003: Configure contextual TUI key bindings

## Objective

Replace distributed physical-key checks with a typed context/action keybinding registry loaded from a
documented JSON file. Support hot reload, modifier aliases, uppercase semantics, chords and null unbinding,
while diagnosing unknown contexts/actions, reserved keys, duplicates and multiplexer conflicts.

## Plan

- [ ] Define context/action vocabulary, default bindings, grammar, schema and reserved-key policy.
- [ ] Resolve key events and chords through one registry across all production input contexts.
- [ ] Hot-reload valid files atomically and preserve the last valid map on visible validation failure.
- [ ] Derive key hints from bindings and document terminal/modal-editor constraints.

## Test Plan

Prove parsing, validation, chords, null unbinding, context isolation and atomic hot reload with pure tests;
then modify the keybindings file during a live PTY session and observe a remapped action without restart.

## User Execution Test Scenarios

<!-- backlog-execution.md § User Execution Test Scenario Rule. Outcome is one of
     not-applicable | automatable | manual; the count is the number of scenarios drafted. Keep the
     not-applicable form ONLY with a product-surface reason (≥ 50 characters, not build/typecheck
     evidence); otherwise write the scenario a user can run and raise the count. -->

**Author verdict:** `SCENARIO DRAFTED: automatable | 1`

Run the TUI with a temporary keybindings file, use the same key for different actions in chat and a picker,
edit the file while running, and observe both the changed behavior and updated footer hint.
