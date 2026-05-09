---
name: backlog-execution-orchestrator
description: Use when executing backlog-driven work, multi-PR initiatives, recommendation-gated implementation, or one-backlog-per-PR workflows. Orchestrates owner skills without duplicating their detailed procedures.
---

# Backlog Execution Orchestrator

## Rule Anchor

- `.agents/rules/backlog-execution.md`
- `.agents/rules/git-branch.md`
- `.agents/rules/process.md`

## Use This Skill When

- The user asks to work through one or more backlog items.
- The user requires a recommendation before implementation.
- The work must use one PR per backlog or split work unit.
- A multi-backlog initiative needs a base branch and child PR sequence.
- The final initiative PR must target `develop` but remain unmerged for the user.

## Scope

This skill owns orchestration only:

- recommendation gate enforcement;
- branch and PR sequencing;
- owner-skill routing;
- verification checkpoint ordering;
- user test scenario gate enforcement;
- PR summary requirements;
- final handoff state.

It does not own package architecture, test design, branch safety, SPEC authoring, commit messages,
or implementation details.

## Pipeline

1. Read the target backlog and `.agents/rules/backlog-execution.md`.
2. Present a recommendation gate before implementation:
   - proposed approach;
   - why it matches backlog intent;
   - why it matches repo rules, layering, and ownership;
   - affected scope;
   - test and verification plan;
   - user test scenario plan;
   - decisions that require the user.
3. Ensure the backlog or work unit includes a user-facing test scenario section when it changes
   user-visible behavior, command behavior, workflow behavior, or user-facing docs.
4. If the recommendation is coherent with rules and architecture, proceed. If not, stop and ask.
5. Use `branch-guard` before commits or branch changes.
6. For multi-backlog initiatives:
   - create or confirm the initiative base branch from `develop`;
   - create one child branch per backlog or split work unit;
   - open each child PR into the initiative base branch;
   - merge each child PR after checks pass;
   - open the final initiative PR into `develop`;
   - do not auto-merge the final `develop` PR.
7. Route detailed work to owner skills.
8. Run or coherently review the user test scenario as a final gate. If it passes, include the
   scenario in the user handoff as something the user can execute. If it fails, keep working or ask
   for a decision.
9. Ensure every PR body records recommendation, rationale, implementation summary, tests, user
   scenario gate result, and residual risks.

## Owner Skill Routing

- Branch safety and protected branches: `branch-guard`
- Docs, backlog, ADR, or commit wording: `repo-writing`
- Impact, verification, and residual risk loop: `repo-change-loop`
- Contract boundary or package ownership change: `spec-first-development`
- SPEC authoring: `spec-writing-standard`
- SPEC/code drift after spec changes: `spec-code-conformance`
- Tests and red-green-refactor work: `tdd-red-green-refactor`
- Vitest strategy: `vitest-testing-strategy`
- Architecture/layering boundary: `architecture-patterns`
- Type contracts and trust boundaries: `type-boundary-and-ssot`
- Post-implementation release/docs checklist: `post-implementation-checklist`

Load only the owner skills needed for the current backlog or work unit.

## PR Body Requirements

Every child PR must include:

- accepted recommendation;
- rationale against backlog intent and architecture;
- implementation summary;
- tests and verification commands;
- user test scenario gate result;
- residual risks or skipped checks;
- next backlog or handoff note when relevant.

## Stop Conditions

- No recommendation gate was presented.
- A required user-facing backlog has no user test scenario section.
- The user test scenario gate fails or cannot be coherently mapped to the completed behavior.
- The recommendation conflicts with rules, ownership, architecture, or backlog intent.
- The work combines unrelated backlogs in one PR.
- A child branch targets `develop` instead of the initiative base branch during a multi-backlog
  initiative.
- The final initiative PR would be auto-merged into `develop`.
- This skill would need to duplicate detailed instructions already owned by another skill.
