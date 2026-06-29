---
title: 'TEST-004: Retrofit remaining framework capabilities into the functional-coverage manifest'
status: done
created: 2026-06-27
completed: 2026-06-27
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
- **Background tasks / scheduled wake (FLOW-002/003) — DONE (2026-06-27).** Kit extended with a
  `wake(instruction, taskId)` driver (`requestWakeup` + settle). `background-wake-functional.test.ts`
  proves a wake injects an `agent-wakeup` turn that reaches the provider and that same-task-id wakes
  coalesce. Manifest: `background-wake`.
- **Preset application (PRESET-014/015/017) — DONE (2026-06-27).** `preset-application-functional.test.ts`
  asserts a live persona / self-verification update reaches the REAL provider request as a single,
  non-duplicated system message. Manifest: `preset-application`. **This test surfaced two real
  shipped bugs** — see "System-prompt SSOT fix" below.
- **Slash-command execution — DONE (2026-06-27).** Kit extended with a `command(name, args)` driver.
  `slash-command-functional.test.ts` runs a composed `/command` through the real session pipeline.
  Manifest: `slash-command`.

## System-prompt SSOT fix (surfaced by the preset functional test)

Building the preset functional test exposed two real bugs the existing tests missed — the exact
"passes the seam but does not actually work" pattern functional testing is meant to catch:

1. **Live system-prompt updates never reached the model.** `Session.updateSystemMessage` →
   `setModel` updated `config.defaultModel.systemMessage`, but the request path seeds the
   conversation store from the top-level `config.systemMessage` and providers read the system prompt
   from the messages array — so persona, self-verification, and AGENTS.md/CLAUDE.md staleness refresh
   were silently dropped.
2. **A duplicate system message accumulated every turn** (`initializeConversationStore` re-added
   `config.systemMessage` unconditionally), bloating context linearly.

Fixed by single-sourcing the system prompt (agent-core + agent-session SPEC → _System Prompt (single
source of truth)_): top-level `config.systemMessage` is the sole owner; the store holds exactly one
in-place-updatable head system message (`ConversationStore.setSystemPrompt`); `Robota.updateSystemPrompt`
propagates a live change to both, so the next request carries it. The vestigial
`defaultModel.systemMessage` / `IModelConfig.systemMessage` fields were removed.

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
