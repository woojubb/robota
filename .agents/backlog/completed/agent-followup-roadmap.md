# Agent Follow-up Roadmap

## What

Coordinate the next agent/CLI/runtime backlog items into a practical execution order with the main recommendations called out explicitly.

## Why

The current follow-up set spans a user-facing bug, test coverage discovery, command architecture, worktree isolation, and reversible sandboxing. These should not be implemented in a random order because some items reduce risk for later items.

## Recommended Order

1. **Fix `/model` restart behavior** (`cli-model-change-restart.md`)
   - Reason: this is a direct user-facing regression with a bounded surface.
   - It does not depend on broader architecture work.
   - The first implementation step should be a failing regression test around settings persistence and resolved model config.

2. **Measure agent package coverage** (`agent-package-coverage-audit.md`)
   - Reason: this gives a baseline before changing command/runtime/sandbox boundaries.
   - Do not add thresholds yet; measure first, then choose targeted coverage work.

3. **Research and design compact descriptor behavior** (`compact-command-descriptor.md`)
   - Reason: compaction touches command routing, session runtime, context telemetry, and UI.
   - Recommendation: unify manual `/compact` routing before changing auto-trigger behavior.

4. **Harden worktree support** (`worktree-support-hardening.md`)
   - Reason: worktree isolation is already partially implemented and is the local foundation for safer write-capable agent work.
   - Recommendation: improve metadata/reporting/cleanup before making worktree isolation the default for write-capable jobs.

5. **Implement reversible sandbox mode** (`reversible-agent-sandbox.md`)
   - Reason: reversible sandboxing depends on clear checkpoint and worktree semantics.
   - Recommendation: ship a local-first reversible mode before provider-backed sandbox snapshots.

## Cross-Item Recommendations

- Treat `/model` and coverage audit as early, independent work.
- Treat compact descriptor work as a command architecture task, not just a CLI command cleanup.
- Treat worktree hardening as the prerequisite for local reversible agent edits.
- Treat provider-backed sandboxing as a later extension after local rollback guarantees are explicit.
- Do not add CI coverage thresholds or default worktree isolation until measurement and reporting are trustworthy.

## Promotion Path

Completed in `docs/agent-followup-roadmap-close`.

## Result

- `/model` restart behavior was completed in `.agents/tasks/completed/cli-model-change-restart.md`.
- Agent package coverage measurement was completed in `.agents/tasks/completed/agent-package-coverage-audit.md`.
- Compact descriptor behavior was completed in `.agents/tasks/completed/compact-command-descriptor.md`.
- Worktree hardening and reversible sandboxing remain tracked as their own backlog items, so this
  roadmap no longer needs to stay active.
