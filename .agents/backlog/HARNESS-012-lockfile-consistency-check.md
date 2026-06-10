---
title: 'HARNESS-012: Lockfile consistency in local CI'
status: todo
created: 2026-06-11
priority: medium
urgency: soon
area: .claude/hooks, scripts
depends_on: []
---

# HARNESS-012: Lockfile consistency in local CI

## Problem

Removing peer deps from agent-tool-mcp/package.json without running `pnpm install` broke CI
(`ERR_PNPM_OUTDATED_LOCKFILE`) one full CI round-trip later — the local CI checklist
(typecheck/lint/test) has no lockfile-consistency step (PR #688, 2026-06-11).

## Proposed Change

Pre-push hook (or harness scan) running `pnpm install --lockfile-only` and failing on a dirty
`pnpm-lock.yaml`, with guidance to commit the regenerated lockfile. Update the local-CI rule
text to include lockfile consistency whenever any package.json dependency block changes.

## Test Plan

- Hook tested with a deliberate package.json dep edit (blocked until lockfile committed).
- No false positives on dep-untouched pushes.

## User Execution Test Scenarios

Not applicable — local dev tooling.
