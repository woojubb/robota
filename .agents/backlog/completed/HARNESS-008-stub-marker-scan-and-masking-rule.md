---
title: 'HARNESS-008: Stub-marker scan + no-success-masking rule'
status: done
created: 2026-06-11
completed: 2026-06-11
priority: high
urgency: soon
area: scripts/harness, .agents/rules
depends_on: []
---

# HARNESS-008: Stub-marker scan + no-success-masking rule

## Problem

`@robota-sdk/agent-tool-mcp` shipped to npm with `TODO: Implement` / `throw new Error('Not
implemented…')` in its core execution path, and wrapped that permanent failure in a
`success: true` envelope — masking it from every caller (CLI-058, fixed 2026-06-11).

## Proposed Changes

1. `harness:scan:stub-markers` — fail on `TODO: Implement` / `Not implemented` /
   `NotImplementedError` in `packages/*/src` non-test files of publishable packages.
2. `common-mistakes.md` entry: error data must never be returned inside a success envelope —
   failures throw or return explicit failure results (the MCP success-masking case as the
   worked example).

## Test Plan

- Scanner unit test (marker in src fails; marker in **tests** passes).
- Live dry run; rule text added to common-mistakes with the incident reference.

## User Execution Test Scenarios

Not applicable — harness/internal tooling and rules documentation.

## Evidence

- (2026-06-11) `check-stub-markers.mjs` implemented + 3 unit tests; live triage executed REL-003 (OpenAPITool removal); common-mistakes #57 added; scan green and registered.
