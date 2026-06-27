---
title: 'TEST-004: Retrofit remaining framework capabilities into the functional-coverage manifest'
status: todo
created: 2026-06-27
priority: medium
urgency: later
area: packages/agent-framework
depends_on: []
---

# Retrofit remaining framework capabilities into functional coverage

Split from TEST-003 (which built the framework functional harness, the testing-layering rule, the
`functional-coverage` manifest scan, and seeded the manifest with the reference `goal-pursuit` and
`permission-gate` capabilities). This item retrofits the remaining framework capabilities that lack
a kit-based functional test, growing the manifest until coverage is complete.

## What

For each capability below, add a framework-level functional test using
`@robota-sdk/agent-framework/testing` (`scriptedSession()` / `runGoal` / `submit` / `awaitEvent`),
then add a row to `scripts/harness/functional-coverage-manifest.json`:

- **Resume / fork — DONE (2026-06-27).** Kit extended with `cwd` / `resumeSessionId` /
  `forkSession`; `multi-session-functional.test.ts` proves resume restores the prior conversation
  and fork restores context into a new id. Manifest: `multi-session`. (The real-model goal cassette
  — TEST-005 follow-up — also landed: `goal-cassette-functional.test.ts`, manifest
  `goal-pursuit-cassette`.)
- **Background tasks / scheduled wake (FLOW-002/003)** — a background task completion (or a
  scheduled wake) injects an `agent-wakeup` turn; assert via `awaitEvent('turn_source')` /
  `emittedEvents('background_task_event')`. Requires composing background task runners into the kit.
- **Preset application (PRESET-014/015/017)** — applying a preset persona / self-verification /
  command-module selection changes the live session; assert the observable effect.
- **Slash-command execution** — a `/command` runs through the real session command pipeline (the kit
  already accepts `commandModules`).

## Why

TEST-003 proved the harness on two capabilities and made coverage mechanically enforced. These
remaining capabilities should be brought under the same functional-coverage net so regressions in
their behaviour are caught at the framework level, not discovered through the CLI.

## Done When

- Each listed capability has a kit-based functional test and a manifest row; `functional-coverage`
  stays green; `pnpm harness:scan` green.
- Any capability that needs a kit extension (e.g. resume, background runners) has that extension
  added to `@robota-sdk/agent-framework/testing` with its own harness self-test.

## Test Plan

- Per capability: the new functional test passes via `pnpm --filter @robota-sdk/agent-framework test`;
  the `functional-coverage` scan lists it.

## User Execution Test Scenarios

Not applicable — agent-facing internal test infrastructure; validated by the functional tests and the
`functional-coverage` scan, recorded as Test Plan evidence.
