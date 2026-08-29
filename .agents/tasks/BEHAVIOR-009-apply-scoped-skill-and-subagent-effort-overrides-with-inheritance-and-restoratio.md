---
title: 'BEHAVIOR-009: apply scoped skill and subagent effort overrides with inheritance and restoration'
issue: https://github.com/woojubb/robota/issues/1987
status: todo
created: 2026-08-29
priority: critical
urgency: now
area: agent-framework, agent-executor, agent-session
depends_on: []
---

# BEHAVIOR-009: scoped skill and subagent effort semantics

## Objective

Define and implement one typed execution contract for skill and subagent effort overrides. Today
skill frontmatter reads `effort` as an arbitrary string, and subagent execution applies model/tool
request overrides without an effort override. The missing behavior is not parsing alone: it is how an
override inherits, competes with session/environment authority, remains temporary, and restores the
parent value after success, failure, or cancellation.

This Task is the semantic prerequisite for issue #2094. Issue #2094 owns strict decoder and discovery-loader
migration; it must consume this Task's typed contract instead of inventing effort semantics.

## Plan

1. Specify the typed effort vocabulary that already-decoded skill metadata and subagent requests
   consume. Issue #2094 retains raw frontmatter decoding, rejection, and source-path diagnostics.
2. Define precedence between environment authority, session effective effort, skill frontmatter, and
   explicit subagent request values.
3. Apply the override only to the scoped invocation and restore/inherit correctly across success,
   failure, nested execution, and cancellation.
4. Expose the effective scoped value to the request and observability contracts without mutating the
   parent's persistent session setting.

## Completion Criteria

- A typed effort value crosses the post-decode skill boundary and the subagent request boundary;
  neither runtime path accepts an arbitrary string or silently manufactures a default.
- The reviewed precedence contract is identical for skill and subagent execution.
- Temporary overrides are restored on success, failure, cancellation, and nested execution.
- Issue #2094 can migrate all discovery roots by consuming this contract without defining a second one.

## Test Plan

- Type-level and unit tests for the typed vocabulary and request-boundary values; issue #2094 owns
  raw metadata rejection and source-path diagnostic tests.
- Framework integration tests for inheritance, explicit override, nesting, failure, and cancellation.
- Regression tests proving parent session effort is unchanged after scoped execution.
- Affected package builds, `pnpm harness:scan`, and CI-equivalent verification before merge.

## User Execution Test Scenarios

Prerequisites: this child adds the public-SDK example
`packages/agent-framework/examples/verify-scoped-effort-overrides.ts` plus example definitions under
`packages/agent-framework/examples/fixtures/effort/{skills,agents}`. The example sets the parent effort
through the existing session/preset SDK seam, uses only exported SDK interfaces and an inline recording
provider, and directly injects the decoded skill/agent definitions; it must not import a test fixture or
a FLOW-008 CLI surface.

Run
`pnpm --filter @robota-sdk/agent-framework exec tsx examples/verify-scoped-effort-overrides.ts`.

Expected: the example prints `success scoped=high restored=low`, `failure scoped=high restored=low`,
`cancel scoped=high restored=low`, and `nested inner=high outer=medium restored=low`, then exits 0.
The example uses no persistent settings and removes its temporary session directory before exit.
Evidence: pending implementation with exact output and exit code.
