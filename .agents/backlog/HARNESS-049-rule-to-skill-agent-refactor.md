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

## Phase 2, increment 1 — `publish.md` — DONE (2026-07-26)

Extracted the release procedure into a nested pipeline. `publish.md` keeps every invariant; what left is
the ordering — 11 Release State Machine steps, the 10-step OTP sequence, the gate-observation cadence, and
the failure-class vocabulary. What grew is ownership pointers.

**Tree built** (matches phase 1's hypothesis except where noted):

```
release-orchestration        (NEW top-level)   ← Release State Machine, phase sequencing + routing
├─ source-stabilization      (NEW phase)       ← steps 1–3
├─ version-bump              (NEW phase)       ← steps 4–9   (as phase 1 predicted)
├─ npm-otp-publish           (NEW phase)       ← steps 10–11 + the OTP Protocol (as predicted)
└─ ci-gate-watch             (NEW, shared)     ← Long-Running Gates; dispatched by two phases
       └─ ci-failure-triager (NEW agent)       ← CI Failure Triage criteria
   + merge-verifier          (existing agent, reused unchanged)
   + version-management      (existing skill, reused unchanged)
```

**Additions to phase 1's proposal for this rule:**

- A fifth skill was needed: `ci-gate-watch`. Two phases wait on CI on an exact SHA, so leaving the
  Long-Running Gates loop in either one would have duplicated it (routing gap 3 chains into triage,
  whose exit was also undefined — both are now closed).
- `publish.md` and `version-management` each carried the same six-step description of what the publish
  script does. That duplication predates this item; `version-management` now owns it alone.
- The Korean-language literal OTP prompt string was dropped rather than moved: per-message language
  matching is owned by `naming-style.md` § Language Policy, so pinning one language in the procedure
  contradicted its owner. The _halt-for-user_ edge it encoded is preserved in `npm-otp-publish`.

**Deferred, deliberately:** `ci-failure-triager` emits the terminal line `CI TRIAGE: <class> | <repro>` but
declares no `signal:` frontmatter field, because `CI TRIAGE` is not in `CLOSED_SIGNAL_VOCAB` and adding it
means editing `scripts/harness/check-agent-def-convention.mjs` — outside this increment's file ownership.
A later increment should register the token and add the field.

**Not rehearsed:** the version-bump and publish phases cannot be exercised without an actual release.
`ci-failure-triager` was dispatched on a real red CI run; the rest ships as extracted-but-unrehearsed
procedure.

## Phase 2, increment 2 — `backlog-execution.md` — DONE (2026-07-26)

Extracted the backlog procedure into a nested pipeline. The rule went 457 → 417 lines — a smaller
reduction than increment 1's, and the expected one: phase 1 measured this rule as 44 invariants against
18 procedures, so most of it was always meant to stay.

**Tree built** (phase 1's hypothesis confirmed, with one structural correction):

```
multi-backlog-initiative              (NEW outer orchestration) ← Base Branch Workflow 1–7
└─ backlog-execution-orchestrator     (existing, rewritten as a 5-phase state machine)
   ├─ phase 1 recommendation gate  → proposal-reviewer          (existing agent, reused unchanged)
   ├─ phase 2 scenario PLAN        → user-execution-scenario    (NEW sub-orchestration)
   │     ├─ user-execution-scenario-author (NEW agent, worker)
   │     └─ backlog-gate-guard             (agent, EXTRACTED)   ← Done Gate Stage 1
   ├─ phase 3 implementation       → owner skills (unchanged)
   ├─ phase 4 done gate            → user-execution-scenario in GATE mode ← Done Gate Stage 2
   └─ phase 5 completion           (step in the orchestrator)   ← Completion Steps 1–3
```

**Correction to phase 1's proposal:** `multi-backlog-initiative` sits **above** the per-item
orchestrator, not as a sibling phase inside it. An initiative runs the whole per-item pipeline N times;
modelling it as a phase would have made the orchestrator dispatch itself.

**Behavioural change, deliberate and flagged:** the Recommendation Gate no longer has the agent judge its
own recommendation. Phase 1 §9.1 identified this as an `enforcement-architecture.md` violation but could
not settle it; this increment resolves it by dispatching `proposal-reviewer` and routing on
ENDORSE / REVISE (bounded 2) / REJECT. An independent review is now required at every recommendation
gate, where none was required before. An `ENDORSE` is not approval — decisions the rule reserves for the
user still halt for the user.

**Ownership split for the extracted guardian:** the role charter (how to judge a gate) is
`.claude/agents/backlog-gate-guard.md` and is neutral; this repo's gate criteria stay in
`.agents/skills/backlog-gate-guard/SKILL.md`, now a catalogue rather than a role definition, and gained
`DONE-GATE-STAGE-1` / `DONE-GATE-STAGE-2` moved in from the rule. `backlog-pipeline` was verified
already-correct in shape — its only change is dispatching the agent file instead of a hand-written
"read the skill" prompt.

**Routing gaps closed** (all four phase 1 flagged for this rule): Done-Gate-Stage-2 failure now routes by
cause (implementation defect → back to implement, bounded 2; scenario defect → re-author, bounded 1;
undetermined → halt) instead of "fix it or ask"; the executability redesign loop is bounded at 2 attempts
with three named exits; child-PR failure and mid-flight base divergence have edges; and a failed `git mv`
must not leave the status change committed alone.

**Ledger reconciliation — the undercount is systematic, not a one-off.** Phase 1 listed 44 mandatory
statements for this rule; re-deriving from the live file found **50** (6 additions), against increment
1's single addition. The six: (a) a coherent work unit belongs in ONE multi-commit PR, not many tiny
ones; (b) a library-only slice must NOT claim the capability done, and its epic is not COMPLETE until
agent-run verification passes; (c) the agent never delegates the agent-run verification to the user;
(d) at done time an unexecutable scenario must be labeled `manual-only` AND the PR description must not
claim the gate passed by execution; (e) a failed gate means the work is not complete; (f) closing the
loop happens in the SAME change, and a "tracked as follow-on" claim must name an existing file. Four
more are borderline. The pattern: the ledger reliably captures a section's headline mandate and drops
the subordinate ones — later increments should expect ~1 miss per dense section, not per rule.

**Duplications — one resolved, one reported:** Stop Conditions are **not** duplicated as routing; the
rule owns the eleven conditions and every skill carries one generic terminate edge pointing at them
(increment 1 set this precedent for `publish.md`). The `spec-workflow.md` ↔ `backlog-pipeline` status /
lifecycle-folder duplication is **untouched** — resolving it means editing `spec-workflow.md`, a later
increment. Note for that increment: it is a different vocabulary from this rule's Status Invariants
(spec-doc lifecycle vs backlog-item placement), so the two do not conflict.

**Deferred, deliberately:** three relocations phase 1 proposed are left in place because their target
documents were outside this increment's file ownership — BE-42 Layering Rule → `project-structure.md`,
BE-43 Orchestration Skill Rule → `enforcement-architecture.md`, and the Common Mistakes table →
`common-mistakes.md`. The table was collapsed into the invariants it duplicated rather than moved, so no
fact has two owners; the two rules keep a pointer to their likely owner. `GATE VERDICT` and
`SCENARIO DRAFTED` join `CI TRIAGE` as terminal lines not yet in `CLOSED_SIGNAL_VOCAB`, for the same
reason increment 1 recorded.

**Rehearsed:** `backlog-gate-guard` was dispatched on a real open backlog item for `DONE-GATE-STAGE-1`
and returned `GATE VERDICT: FAIL` on the correct criteria (missing executability label; non-exact steps
that would exercise a disabled code path). `user-execution-scenario-author` was dispatched on this
increment and returned `SCENARIO DRAFTED: not-applicable | 0`, correctly refusing to fabricate a
scenario for a rule/skill-only change and correctly rejecting the one candidate surface as a
document-existence check in disguise. **Not rehearsed:** the full five-phase loop end to end, and the
initiative outer loop — both need a real multi-item initiative to exercise.

## User Execution Test Scenarios

**Not applicable.** This item changes only rules, skills, agent definitions, and registry indexes — no
package or app source, and no user-runnable procedure. `backlog-execution.md` § User Execution Test
Scenario Rule states that rule-only, skill-only, and governance-only changes mark the gate N/A and record
verification evidence in the engineering test plan instead. Verification evidence for each increment is
`pnpm harness:verify-like-ci` green plus the invariant-preservation reconciliation recorded per increment
above; the agent rehearsals are governance evidence and are recorded as such, not as user-execution
evidence.

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
