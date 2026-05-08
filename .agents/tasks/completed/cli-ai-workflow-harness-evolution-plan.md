# CLI AI Workflow Harness Evolution Plan

## Status

Completed.

## Created

2026-05-09

## Completed

2026-05-09

## Recommendation

Do not start by adding more behavior to `agent-cli`. The correct first slice is a cross-cutting
workflow control-plane design that locks the lower owner contracts before any TUI dashboard, task
wizard, review mode, or workflow command is implemented.

## Result

- Added `.agents/specs/ai-workflow-control-plane.md`.
- Captured the Josh newsletter principles without impersonating the author or named sources.
- Rechecked prior art from OpenAI Codex, Claude Code, Cursor, and Jules.
- Defined the `AI Native Workflow Reviewer` profile as a review rubric, not a named-person
  impersonation.
- Defined an initial repository workflow manifest contract and owner-first implementation sequence.
- Updated the architecture map and `agent-cli` SPEC to state that the CLI may render workflow UI
  only over SDK/runtime/harness-owner projections.

## Follow-Up Implementation Sequence

1. Add manifest parser/validator and contract tests under a lower owner package or SDK facade.
2. Add SDK workflow run and evidence artifact APIs over runtime task projections.
3. Add deterministic workflow hook event contracts and tests.
4. Add CLI task intake and dashboard screens that render owner projections only.
5. Add review/evidence gate and PR summary generation from artifacts.
6. Add token/cost workflow telemetry.
7. Add workflow packaging for repeated repo-local loops.

## Test Plan

- `pnpm harness:scan`
- `pnpm docs:validate-structure`
- Document authority scan must pass because the design updates the cross-cutting spec index,
  architecture map, and CLI package SPEC together.
