---
title: 'HARNESS-007: Description-schema consistency tests for all builtin tools'
status: done
created: 2026-06-11
completed: 2026-06-11
priority: medium
urgency: soon
area: packages/agent-tools
depends_on: []
---

# HARNESS-007: Description-schema consistency tests for all builtin tools

## Problem

Grep's LLM-facing description advertised a `count` mode and `head_limit` parameter that the
schema did not define — the LLM periodically emitted invalid calls and wasted turns (CLI-057).
Only Grep gained a consistency test; the other builtins (Bash, Read, Write, Edit, Glob,
WebFetch, WebSearch) have no such guard.

## Proposed Change

Extend the CLI-057 test pattern to every builtin: a per-tool unit test asserting the description
references only schema-defined parameters/enum values (parameter-name extraction + contains
checks, mirroring `grep-tool.test.ts` TC-03).

## Test Plan

- One consistency test per builtin tool in `packages/agent-tools/src/__tests__/`.
- `pnpm --filter @robota-sdk/agent-tools test` green.

## User Execution Test Scenarios

Not applicable — test-only change guarding an LLM-facing contract.

## Evidence

- (2026-06-11, approved form: rule instead of brittle per-tool heuristic tests) common-mistakes #58 requires a description-schema consistency test whenever a builtin tool is added/changed, citing grep-tool.test.ts TC-03 as the worked pattern.
