# Backlog Execution Rules

Mandatory rules for executing backlog-driven work through recommendation gates and focused PRs.
Parent: [process.md](process.md) | Index: [rules/index.md](index.md)

## Recommendation Gate

Before starting each backlog or meaningful work unit inside a backlog, present a recommendation with
the reasoning needed to judge whether it should proceed.

The recommendation must include:

- the proposed implementation or documentation approach;
- why it matches the backlog intent;
- why it matches repository rules, layering, ownership, and architecture boundaries;
- affected packages, docs, or commands;
- the expected test and verification plan;
- any decisions that require the user instead of agent autonomy.

If the recommendation is coherent with repository rules, layering, architecture, and the backlog
intent, the agent may proceed with that recommendation. If the recommendation is weak, conflicts
with rules, changes ownership boundaries, introduces new dependency direction, or requires product
judgment, stop and ask the user for a decision.

## PR Unit Rule

- Treat one backlog as one PR by default.
- If a backlog is too large, split it into explicitly named work units before implementation; each
  work unit must have its own recommendation gate.
- Do not combine unrelated backlogs in one PR.
- Every PR description must include the accepted recommendation, rationale, implementation summary,
  tests run, and residual risks.

## Base Branch Workflow

For a multi-backlog initiative:

1. Create an initiative base branch from `develop`.
2. For each backlog, create a child branch from the initiative base branch.
3. Open a PR from the child branch into the initiative base branch.
4. After checks pass and the PR content matches its recommendation gate, merge that PR into the
   initiative base branch.
5. Repeat until all backlog PRs are merged into the initiative base branch.
6. Open a final PR from the initiative base branch into `develop`.
7. Do not auto-merge the final PR into `develop`; leave that decision to the user.

## Layering Rule

Backlog implementation must preserve owner boundaries:

- `agent-cli` owns UI/TUI rendering, prompt intake, keyboard navigation, and local host adapter
  wiring.
- SDK/runtime or other lower owner packages own reusable contracts, lifecycle, state machines,
  storage policy, command behavior, and process/task semantics.
- Command packages expose user-visible commands through SDK/runtime contracts.
- Skills may orchestrate workflows, but they must not absorb detailed behavior owned by the skills
  or packages they invoke.

## Orchestration Skill Rule

An orchestration skill may coordinate other skills as a pipeline, but it must stay thin:

- It may select and sequence skills.
- It may enforce gates, PR order, and verification checkpoints.
- It may record status and handoff points.
- It must not duplicate the detailed procedures of invoked skills.
- It must not redefine mandatory rules.
- It must delegate package-specific, testing, branch, writing, architecture, and verification work
  to the relevant owner skills.

## Stop Conditions

- No recommendation gate was presented for the backlog or work unit.
- The recommendation conflicts with repo rules, layering, package ownership, or backlog intent.
- The work would combine unrelated backlogs into one PR.
- The final initiative PR would be auto-merged into `develop`.
- An orchestration skill duplicates implementation details from invoked skills instead of only
  coordinating them.

## Checklist

- [ ] Recommendation gate presented before work begins.
- [ ] Recommendation includes rationale, ownership, affected scope, tests, and open decisions.
- [ ] PR scope maps to exactly one backlog or explicitly split work unit.
- [ ] Child PR targets the initiative base branch.
- [ ] Final initiative PR targets `develop` and is not auto-merged.
- [ ] PR description records the accepted recommendation and verification evidence.
