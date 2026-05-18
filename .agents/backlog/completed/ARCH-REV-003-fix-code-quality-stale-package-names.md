---
title: 'ARCH-REV-003: Fix stale package names in code-quality.md Layered Assembly Architecture section'
status: todo
created: 2026-05-18
priority: high
urgency: now
area: .agents/rules/code-quality.md
depends_on: []
---

## Problem

The "Layered Assembly Architecture" section of `.agents/rules/code-quality.md` (lines 48–82) uses package names that were renamed. Since rules are normative documents read independently, these stale names cause confusion when cross-referencing with actual monorepo packages.

| Used in code-quality.md | Current package name             |
| ----------------------- | -------------------------------- |
| `agent-runtime`         | `agent-executor`                 |
| `agent-sessions`        | `agent-session`                  |
| `agent-providers`       | `agent-provider`                 |
| `agent-plugins`         | `agent-plugin`                   |
| `agent-sdk`             | `agent-framework`                |
| `agent-command-*`       | `agent-command` (single package) |

The rename map is correctly documented in `class-interface-inventory.md`'s "Package name map (old → current)" table, but `code-quality.md` does not reference it and must be self-consistent.

Lines 70 and 72 also contain stale names in rule text ("wired through `agent-sessions` or `agent-sdk`"; "wire in `agent-sdk`").

Source: Senior Design Architect (M-01).

## Recommendation

**Proceed without user approval** — straightforward rename using the authoritative name map from `class-interface-inventory.md`.

Replace all 6 stale names with their current equivalents throughout the section. Do not change any other content — only the package names.

## Test Plan

- Read code-quality.md before and after
- `grep -n "agent-runtime\|agent-sessions\|agent-providers\|agent-plugins\|agent-sdk\|agent-command-\*" .agents/rules/code-quality.md` must return zero results after the fix
- `pnpm harness:scan` must pass after the change

## User Execution Test Scenarios

Not applicable — documentation-only change with no runnable user-facing behavior.
