---
title: 'CLI-064: Exit-code contract violations and SPEC self-contradiction'
status: todo
created: 2026-06-11
priority: high
urgency: now
area: packages/agent-cli
depends_on: []
---

# CLI-064: Exit-code contract violations and SPEC self-contradiction

## Problem

Found during 2026-06-11 product verification (L1/L3, npm-installed beta.73):

1. **Provider API auth failure exits 0.** `robota -p "..."` with an invalid API key prints
   `Request failed: 401 ... authentication_error` to output but exits 0. SPEC error table
   (docs/SPEC.md:1569) promises exit 1 for "Network or auth failure during model call".
   Automation cannot detect failed runs.
2. **SPEC self-contradiction.** SPEC §Exit Codes (docs/SPEC.md:941) declares only codes 0/1,
   while the error-handling table (docs/SPEC.md:1565-1574) promises `process.exit(3)` for
   provider config errors in print mode. `grep -rn "exit(3)"` finds no such path in
   agent-cli or agent-transport source — the exit-3 row is fiction.

Per the spec-is-SSOT rule, the correct exit-code contract must be decided first (single
table), then code made to conform — not the reverse.

## Expected Behavior

One authoritative exit-code table in SPEC.md. Print mode exits non-zero on any provider API
error. Every row in the error table corresponds to a real code path with a test.

## Test Plan

- Integration test: print mode with a provider stub returning 401/5xx → assert documented
  non-zero exit code.
- Spec conformance: harness/test asserting the SPEC has exactly one exit-code table and the
  codes named in the error table exist in source.
- `pnpm --filter @robota-sdk/agent-cli test`

## User Execution Test Scenarios

- Prerequisite: provider profile referencing an env var set to an invalid key.
- Steps: `FAKE=sk-invalid robota -p "hi"`; `echo $?`.
- Expected observable result: non-zero exit code matching the (reconciled) SPEC table.
- Evidence: (fill after implementation)
