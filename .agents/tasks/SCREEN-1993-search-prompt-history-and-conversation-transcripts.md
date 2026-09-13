---
title: 'SCREEN-1993: Search prompt history and conversation transcripts'
issue: https://github.com/woojubb/robota/issues/1993
status: todo
created: 2026-09-14
priority: high
urgency: now
area: packages/agent-interface-session, packages/agent-session, terminal UI package
depends_on: [STRUCT-012, REFACTOR-025, BEHAVIOR-2003]
---

# SCREEN-1993: Search prompt history and conversation transcripts

## Objective

Add responsive reverse search over persisted prompt history with current-session, current-project and
all-project scopes, newest-first deduplication, insert/run acceptance and exact cancel restoration. Keep
the already-delivered complete native scrollback path as the transcript-view decision rather than creating
a second in-memory transcript copy.

## Plan

- [ ] Add paged prompt-history query contracts over session storage with scoped deduplicated results.
- [ ] Add a reverse-search TUI context with highlighted matches, progressive results and insert/run actions.
- [ ] Preserve the pre-search input exactly on cancel and expose all search keys through keybindings.
- [ ] Record why native full scrollback satisfies current-session transcript dumping and verify it in PTY.

## Test Plan

Create more than 100 prompts across several working directories; verify ordering, scope, deduplication,
progressive acceptance and cancellation in unit/component tests, then execute a PTY search and scrollback scenario.

## User Execution Test Scenarios

<!-- backlog-execution.md § User Execution Test Scenario Rule. Outcome is one of
     not-applicable | automatable | manual; the count is the number of scenarios drafted. Keep the
     not-applicable form ONLY with a product-surface reason (≥ 50 characters, not build/typecheck
     evidence); otherwise write the scenario a user can run and raise the count. -->

**Author verdict:** `SCENARIO DRAFTED: automatable | 1`

Launch the deterministic TUI with multi-project stored history, search each scope, insert one match without
running it, run another directly, cancel a third search and verify the original input is restored.
