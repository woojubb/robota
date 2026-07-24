---
name: backlog-execution-orchestrator
description: Use when executing backlog-driven work, multi-PR initiatives, recommendation-gated implementation, or one-backlog-per-PR workflows. Routes to the backlog-execution rule and owner skills without duplicating their detailed procedures.
---

# Backlog Execution Orchestrator

Route-only orchestration skill. The policy — recommendation gate content, user execution test
scenario rule, done gate, PR unit rule, base-branch workflow, layering rule, and stop conditions —
is owned entirely by [.agents/rules/backlog-execution.md](../../rules/backlog-execution.md). This
skill does not restate it; it sequences the steps and routes to owner skills.

## Rule Anchor

- `.agents/rules/backlog-execution.md` — the policy SSOT for everything this skill sequences
- `.agents/rules/git-branch.md`
- `.agents/rules/process.md`

## Use This Skill When

- The user asks to work through one or more backlog items.
- The user requires a recommendation before implementation.
- The work must use one PR per backlog or split work unit.
- A multi-backlog initiative needs a base branch and child PR sequence.
- The final initiative PR must target `develop` but remain unmerged for the user.

## Scope

This skill owns orchestration only: gate sequencing, branch and PR ordering, owner-skill routing,
verification checkpoint ordering, and final handoff state. It does not own the gate definitions
(those live in the rule), package architecture, test design, branch safety, SPEC authoring, commit
messages, or implementation details.

## Pipeline

1. Read the target backlog and `.agents/rules/backlog-execution.md`.
2. Present the recommendation gate defined in the rule ("Recommendation Gate"). Proceed only when
   the recommendation is coherent with rules and architecture; otherwise stop and ask.
3. Ensure the backlog carries the `## User Execution Test Scenarios` section when the rule requires
   one ("User Execution Test Scenario Rule"), designed against a product surface — the product's
   own user-facing surfaces (CLI/TUI/app/public-SDK; see
   [.agents/project-structure.md](../../project-structure.md) for what the product ships), not
   internal repository verification.
4. Use `branch-guard` before commits or branch changes.
5. For multi-backlog initiatives, follow the rule's "Base Branch Workflow" (initiative base branch
   from `develop`, one child branch/PR per backlog, final PR into `develop`, never auto-merged).
6. Route detailed work to owner skills (table below).
7. After implementation, run the user execution test scenario done gate exactly as the rule defines
   it ("Done Gate" Stages 1 and 2), including evidence capture in the backlog.
8. Ensure every PR body records what the rule's "PR Unit Rule" requires.

## Owner Skill Routing

- Branch safety and protected branches: `branch-guard`
- Document language and commit wording: `.agents/rules/naming-style.md` + `.agents/rules/git-branch.md`
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

## Stop Conditions

- Any stop condition in `.agents/rules/backlog-execution.md` fires — that list is the SSOT; do not
  re-derive it here.
- This skill would need to duplicate detailed instructions already owned by a rule or another skill.
