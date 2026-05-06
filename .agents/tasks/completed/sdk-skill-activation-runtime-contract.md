# SDK Skill Activation Runtime Contract

- **Status**: completed
- **Created**: 2026-05-06
- **Branch**: fix/skill-activation-runtime-contract
- **Scope**: packages/agent-sdk, packages/agent-cli, .agents/specs

## Objective

Implement a deterministic SDK-owned skill activation contract so real skill use is observable,
persisted, and distinct from prompt-only skill mimicry.

## Plan

- [x] Confirm current skill descriptor, slash routing, model command, and persistence paths.
- [x] Update governing specs before implementation.
- [x] Add SDK skill activation event types, emission, and session persistence.
- [x] Add model-invocable skill execution path with disable/user invocation semantics preserved.
- [x] Update CLI rendering/routing to consume SDK skill activation events.
- [x] Add regression tests for real activation events and prompt-only non-activation.
- [x] Run targeted verification and archive this task when complete.

## Progress

### 2026-05-06

- Created implementation branch from updated `develop`.
- Started from `.agents/backlog/sdk-skill-activation-runtime-contract.md`.
- Confirmed `.robota/sessions/session_1778075480820_kb29mfvjc.json` showed skill descriptors in the
  prompt but no structured activation event or tool.
- Added SDK-owned `skill_activation` events, `ExecuteSkill`, session persistence, CLI event
  rendering, specs, and regression tests.
- Verified targeted SDK/CLI tests, typechecks, lint commands, and root `pnpm build`.

## Decisions

- Skill activation must be SDK-owned. The CLI may render and route slash input, but it must not be
  the source of truth for whether a skill was activated.
- Model-side skill execution must use a dedicated runtime tool (`ExecuteSkill`) rather than
  `ExecuteCommand`, because skills are prompt workflows with separate discovery and activation
  semantics.

## Blockers

- None.

## Result

Implemented and ready for PR merge.
