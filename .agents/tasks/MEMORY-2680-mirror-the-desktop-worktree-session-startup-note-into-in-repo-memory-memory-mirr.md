---
title: 'MEMORY-2680: Mirror the desktop-worktree session startup note into in-repo memory (memory-mirroring)'
issue: https://github.com/woojubb/robota/issues/2680
status: todo
created: 2026-09-22
priority: medium
urgency: soon
area: harness/memory
depends_on: []
---

# MEMORY-2680: Mirror the desktop-worktree session startup note into in-repo memory (memory-mirroring)

## Objective

A host-memory note written on 2026-09-21 (while landing CHECKS-2664, PR #2811) records how a Claude
desktop "Code" session that the host opened inside `.claude/worktrees/` reaches a rule-conformant
`origin/develop`-based branch — without creating any worktree, which
`.agents/memory/current-execution-permissions.md` prohibits. `memory-mirroring.md` requires the same
content in `.agents/memory/`; this Task is the L0 planning prelude for that mirror (no spec, lane L0,
issue #2680 — the note is local/CI-consistency knowledge).

## Plan

- [ ] `.agents/memory/desktop-worktree-session-startup-sequence.md` — the mirrored note
- [ ] `.agents/memory/MEMORY.md` — one index line beside the execution-permissions entry
- [ ] TC-01 — `grep -c 'desktop-worktree-session-startup-sequence' .agents/memory/MEMORY.md` → `1`, and the file exists

## Test Plan

TC-01 is a `grep`/`test -f` command over the two files; the note's prose is not machine-checkable and
`memory-mirroring.md` owns the requirement that it exist here.

## User Execution Test Scenarios

<!-- backlog-execution.md § User Execution Test Scenario Rule. Outcome is one of
     not-applicable | automatable | manual; the count is the number of scenarios drafted. Keep the
     not-applicable form ONLY with a product-surface reason (≥ 50 characters, not build/typecheck
     evidence); otherwise write the scenario a user can run and raise the count. -->

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** Two Markdown files under `.agents/memory/` read only by agents at session start; no end user of the Robota product (CLI, SDK, TUI, MCP server) can observe them through any runnable surface.
