---
title: 'HARNESS-013: Testing skill note — env stubs do not reach native path APIs; design for injection'
status: done
created: 2026-06-11
completed: 2026-06-11
priority: low
urgency: later
area: .agents/skills
depends_on: []
---

# HARNESS-013: Testing skill note — env stubs do not reach native path APIs; design for injection

## Problem

`vi.stubEnv('HOME', …)` in vitest worker threads does not affect `os.homedir()` (native env not
propagated in workers), which silently broke first-run marker tests until the module was
redesigned. Module-level path constants (`const MARKER = userPaths().onboarded`) compound this
by freezing paths at import time.

## Proposed Change

Add to the testing/TDD skill: (1) never compute user/project paths into module-level constants —
resolve lazily or accept injectable default parameters (first-run.ts pattern:
`isFirstRun(markerPath = userPaths().onboarded)`); (2) do not rely on env stubs reaching native
APIs in vitest workers.

## Test Plan

- Skill text added with the first-run.ts worked example.

## User Execution Test Scenarios

Not applicable — skill documentation.

## Evidence

- (2026-06-11) vitest-testing-strategy SKILL "Worker-Thread Environment Gotchas" added (env stubs vs native APIs, injectable default parameters, first-run.ts example).
