# Backlog Execution Orchestrator Skill

## Status

Backlog.

## Created

2026-05-09

## Priority

P0 - process automation prerequisite for multi-backlog initiatives.

## Request

Create an orchestration skill that manages backlog-driven implementation as a pipeline while
delegating detailed work to existing owner skills.

The skill must help the agent follow the backlog execution rule:

> For each backlog or work unit, present a recommendation gate, proceed only when the recommendation
> is coherent with repository rules and architecture, create one PR per backlog, merge each child PR
> into an initiative base branch, and leave the final `develop` PR unmerged for the user.

## Non-Negotiable Product Principles

- **Orchestration only.** The skill manages gates, sequence, branch flow, PR flow, and verification
  checkpoints. It must not own implementation details.
- **Delegate to owner skills.** It must invoke or route to `branch-guard`, `repo-writing`,
  `repo-change-loop`, `spec-first-development`, `tdd-red-green-refactor`,
  `architecture-patterns`, `vitest-testing-strategy`, and `post-implementation-checklist` when
  those domains apply.
- **Recommendation gate first.** The skill must require a recommendation with rationale before each
  backlog or work unit starts.
- **One backlog, one PR.** The skill must keep unrelated backlogs out of the same PR.
- **Final PR is user-controlled.** The skill must not auto-merge the final initiative PR into
  `develop`.

## Expected Outcomes

- Multi-backlog initiatives become predictable and auditable.
- The agent consistently explains why a recommendation is valid before acting.
- Existing skills keep their detailed responsibilities instead of being copied into a large process
  skill.
- PR descriptions consistently capture recommendation, rationale, implementation summary, tests,
  and residual risks.
- The final `develop` merge remains an explicit user decision.

## Architecture Ownership Rule

The orchestration skill owns only workflow sequencing:

- recommendation gate enforcement;
- branch and PR sequencing;
- skill selection and handoff;
- verification checkpoint ordering;
- status/handoff summary shape.

It does not own:

- package architecture;
- test design details;
- branch safety rules;
- commit message rules;
- SPEC authoring rules;
- implementation details of any package.

Those responsibilities remain with existing rules and skills.

## Recommended First Slice

Create the skill as a small procedural wrapper:

1. Add `.agents/skills/backlog-execution-orchestrator/SKILL.md`.
2. Define trigger conditions for backlog-driven implementation, multi-PR initiatives, and
   recommendation-gated work.
3. Define the pipeline:
   recommendation gate -> branch setup -> owner-skill routing -> implementation loop -> tests ->
   PR description -> child PR merge -> next backlog -> final unmerged develop PR.
4. Keep the skill body concise and reference existing owner skills by name instead of copying their
   details.
5. Update `.agents/skills/index.md`.
6. Add a small governance check or document scan later if repeated drift appears.

## Acceptance Criteria

- [ ] The skill is an orchestration wrapper, not a copy of detailed owner skills.
- [ ] The skill requires a recommendation gate before each backlog or work unit.
- [ ] The skill routes work to relevant existing skills by domain.
- [ ] The skill requires one backlog or split work unit per PR.
- [ ] The skill requires child PRs to merge into the initiative base branch.
- [ ] The skill requires the final `develop` PR to remain unmerged for the user.

## Test Plan

- Add a document/governance check only if the rule starts drifting or the skill is repeatedly
  misused.
- Manually verify the skill body references owner skills instead of duplicating their detailed
  workflows.
- Run `pnpm harness:scan`.

## Verification Plan

- `pnpm harness:scan`
- Document authority scan must pass when this backlog is promoted.
- The first implementation PR must include a before/after review showing the orchestration skill did
  not duplicate owner skill responsibilities.
