---
title: 'HARNESS-049: refactor rules into thin orchestration skills + extracted agent definitions'
status: todo
created: 2026-07-26
priority: high
urgency: soon
area: .agents/rules, .agents/skills, .claude/agents
depends_on: []
---

# HARNESS-049: procedure belongs in skills, roles belong in agent files

## Problem

Owner directive (2026-07-26): convert what is currently _rule prose_ into the right artifact —
**an orchestration skill that owns only the pipeline, and a separate agent-definition FILE for every
role that pipeline calls.** Roles that are already handled by an agent must exist as extracted agent
definitions rather than being described inline.

Three distinct defects, measured against the tree on 2026-07-26:

**1. Procedure is trapped in rule documents.** Rules are meant to be constraints ("what must hold");
procedure ("how to do it, in order") belongs in a skill. The four largest rule files carry the bulk of
the repo's step-by-step content:

| Rule                   | Lines | Numbered steps |
| ---------------------- | ----- | -------------- |
| `backlog-execution.md` | 457   | 19             |
| `git-branch.md`        | 312   | 24             |
| `spec-workflow.md`     | 253   | 17             |
| `publish.md`           | 217   | 27             |

A rule that reads as a runbook cannot be _enforced_ — only followed by whoever happens to read it —
which is the same "prose without a mechanism" failure `check-backlog-placement` was created to fix.

**2. Skills inline roles instead of dispatching them.** These describe reviewer/auditor duties in
their own body and reference no agent definition:

- `backlog-pipeline` (165 lines)
- `delegated-refactor-green-gate` (56 lines)
- `dependency-graph-extraction` (48 lines)

**3. The pattern is proven, so the gap is unfinished work rather than an unknown.** All **14** existing
agent definitions in `.claude/agents/` are wired into skills — **zero orphans** — and the most-used
(`architecture-conformance-auditor` 7 skill refs, `proposal-reviewer` 6, `architecture-auditor` 6) are
exactly the "judge" roles that benefit most from living in one file. The separation already works here;
it just has not been applied to the rest.

## Target shape

```
rule            → the invariant only ("X must hold", "never Y"), plus WHO owns each fact
orchestration   → the pipeline: phases, ordering, gates, what to dispatch and when — and NOTHING else.
skill             MAY dispatch a lower orchestration skill instead of an agent, when a phase is
(nestable)        itself a pipeline. Nesting is expected, not an exception.
agent file      → one role, one file: its charter, its judgement criteria, its tool scope,
(.claude/agents)  its terminal signal. Reusable by any pipeline that needs that role.
```

**Orchestration nests.** A phase of a high-level pipeline is often a pipeline in its own right, so an
orchestration skill may own **sub-orchestration skills** as well as agents: a top-level skill routes
phases, an intermediate skill sequences that phase's own steps, and only the leaves are agents. Each
level still carries **only** its own ordering — a parent must not restate a child's steps, and a child
must not know what runs after its parent's phase. Depth is whatever the work actually has; the
constraint is that every level stays pipeline-only.

The invariant across all levels: an orchestration skill (at any depth) must not contain a role's
judgement criteria, and an agent file must not contain pipeline ordering. If a skill explains _how to
judge_, that content belongs in an agent file; if an agent file explains _what runs next_, that belongs
in the skill above it.

## Phase 1 — DONE (2026-07-26)

Step 1 below is complete. The classification table and everything derived from it live in
[`.agents/specs/harness-composition-inventory.md`](../specs/harness-composition-inventory.md) —
the companion to the design doc. Phase 2 picks up from there. Headline results:

- **142 sections across 22 rule files: 116 `invariant`, 21 `procedure`, 5 `role`.** 82% of rule
  content should not move at all; the work is concentrated in the four large rules.
- **3 net-new agent files**, none duplicating an existing agent: `backlog-gate-guard` (an
  _extraction_ of a role that already exists as a skill and is already dispatched as a subagent),
  `user-execution-scenario-author`, `ci-failure-triager`. Four other role classifications reuse
  `merge-verifier`, `proposal-reviewer`, and `architecture-auditor` unchanged.
- **Nesting confirmed for `publish.md`, `git-branch.md`, `backlog-execution.md`; refuted for
  `spec-workflow.md`**, whose procedures already have owner skills — that increment is deletion and
  pointing, not extraction.
- **14 routing gaps** flagged: procedures with no defined failure edge, which must have routing
  decided during extraction rather than inherited.
- **153-statement invariant ledger** for the four large rules, with each statement's proposed
  post-change home — the no-behavioural-loss safety net for the whole refactor.
- **Recommended extraction order: `publish.md` → `backlog-execution.md` → `git-branch.md` →
  `spec-workflow.md`.** `publish.md` first because it has zero inbound skill references and no
  existing owner skill to negotiate with (`git-branch.md` has ten skill references plus eight
  enforcement surfaces).

## What

1. ~~**Inventory and classify**~~ **(DONE — see Phase 1 above)** every `.agents/rules/*.md` section as: `invariant` (stays a rule),
   `procedure` (moves to a skill), or `role` (becomes an agent definition). Produce the mapping table
   FIRST — this is the deliverable that makes the rest reviewable, and it is where the judgement is.
   For each `procedure`, also record its **level**: is it a whole pipeline (top-level skill), one
   phase of a larger pipeline (sub-orchestration skill), or a single role's work (agent)? The four
   large rules are likely to yield nested pipelines rather than one flat skill each — e.g. a release
   procedure whose "verify" phase is itself an ordered sequence worth its own skill.
2. **Extract roles to `.claude/agents/*.md`**, starting with the three skills above and any role a rule
   describes inline. Each must satisfy the repo's `agent-def-convention` guard.
3. **Reduce the orchestration skills to pipeline-only**, dispatching the extracted agents. Follow the
   neutrality discipline already applied to `worktree-parallel-orchestration`: a skill is universal
   procedure and POINTS at the rule that owns a fact instead of restating it.
4. **Leave each rule as its invariants + ownership pointers.** Content moves; it is not duplicated.
   Each fact keeps exactly one owner document (`AGENTS.md` Document Discovery Policy).
5. Consider dispatching the existing `capability-scout` → `proposal-reviewer` → `agent-skill-author`
   pipeline (the `capability-extraction` skill) for the role decomposition rather than hand-rolling it —
   that pipeline exists for exactly this, and using it dogfoods the mechanism this item is about.

## Constraints

- **No behavioral loss.** Every mandatory constraint must survive the move; a rule losing force because
  its text became a skill is the failure mode to avoid. Diff the invariants before/after and show the
  mapping.
- **Do it incrementally, one rule at a time**, each merged and verified — not one sweeping PR across
  four 200–450-line rules.
- Anything referenced by a harness scan (`scan-consistency`, `check-agent-def-convention`, the skill
  index) must keep resolving: no dangling anchors, no unregistered skill or agent.

## Test Plan

Per increment: `pnpm harness:verify-like-ci` green (the consistency + agent-convention scans are the
mechanical floor here). Plus an explicit invariant-preservation check — list the mandatory statements
in the rule before the change and show each one's post-change home. For an extracted agent, dispatch it
once on a real task and confirm it produces the same verdict the inline version would have.
