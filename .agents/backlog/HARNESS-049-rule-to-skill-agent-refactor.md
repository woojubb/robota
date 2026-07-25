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
1's single addition — and the review round then found a **51st** the re-derivation had also missed (a
child PR must match its recommendation gate, not merely have green checks). The six from
re-derivation: (a) a coherent work unit belongs in ONE multi-commit PR, not many tiny
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

**Review round (the new gate, dogfooded on itself):** `proposal-reviewer` was dispatched on this
increment's own recommendation and returned `REVIEW VERDICT: REVISE` — endorsing all four structural
calls but finding three real invariant losses the mechanical checks did not catch. All were verified
against `origin/develop` before acting, and all are fixed: the credential-prerequisite MUST (BE-35) had
become conditional on an agent being dispatched, and its removal also falsified HARNESS-012's TC-04
done-spec evidence (`grep -c "Scenario Design Preference Order"` → was 1, would have been 0, is 1
again); the child-PR "matches its recommendation gate" merge condition was dropped — **a 51st mandatory
statement neither the ledger nor this increment's own re-derivation caught**; and the rule still carried
the self-judgement sentence the change exists to remove. Also fixed: the map claimed a mechanical floor
for the recommendation gate that does not exist, an invariant was newly introduced _inside a skill_
(now in the rule), and the unprobed-absence rule had three copies. The reviewer catching what a
50-statement manual re-derivation missed is the strongest available evidence for the gate it was
reviewing.

**Rehearsed:** `backlog-gate-guard` was dispatched on a real open backlog item for `DONE-GATE-STAGE-1`
and returned `GATE VERDICT: FAIL` on the correct criteria (missing executability label; non-exact steps
that would exercise a disabled code path). `user-execution-scenario-author` was dispatched on this
increment and returned `SCENARIO DRAFTED: not-applicable | 0`, correctly refusing to fabricate a
scenario for a rule/skill-only change and correctly rejecting the one candidate surface as a
document-existence check in disguise. **Not rehearsed:** the full five-phase loop end to end, and the
initiative outer loop — both need a real multi-item initiative to exercise.

## Phase 2, increment 3 — `git-branch.md` — DONE (2026-07-26)

The smallest extraction of the four, and the honest one: this rule is **invariant-dense**, so most of it
had to stay — and it ended **larger**, 312 → 322 lines. Roughly 40 lines of ordered procedure left; about
as many came back as explicit invariant statements that had been buried inside those numbered steps, and
then the review round's three defect fixes added ten more. **The line count is the wrong scoreboard for
this rule**: phase 1 measured it at 35 invariants against 4 procedures, and forcing a reduction here would
have meant deleting mandates. One new skill, **zero** new agents, and two of phase 1's proposals refuted.

**Tree built:**

```
post-merge-cycle                      (NEW top-level, shared sub-orchestration)
├─ merge-verifier                     (existing agent, reused UNCHANGED)  ← Merge Landing Verification
├─ branch deletion                    (step)  ← Delete Merged Branches mechanics + ordering
└─ next-branch base reset             (step)  ← Post-Merge Branch Cycle steps 1–4

dispatched by:
  pr-review-orchestration  (merge path)   — absorbed its inline restatement
  worktree-parallel-orchestration (step 5) — absorbed its inline restatement
```

**Why a skill rather than more rule prose.** Three adjacent rule sections were one pipeline stated as
three prose blocks — and the rule's own section ORDER (delete, then verify) contradicted its own text
(verify before deleting). Two existing orchestrations already carried divergent partial copies of the
sequence: `worktree-parallel-orchestration` §5 paraphrased the four don't-delete-when conditions in the
same paragraph that said "do not restate them", and `pr-review-orchestration`'s merge path restated the
`merge-verifier` + delete-after-confirm steps. This is increment 1's `ci-gate-watch` shape exactly — two
callers, so leaving the sequence in either would duplicate it. Both callers now dispatch and lost their
copies.

**Routing gaps closed — all FOUR phase 1 flagged for this rule** (§6 rows 10–13), each bounded or absolute:
a `FAIL` landing verdict terminates and never advances to deletion; a failed ancestry check does not delete
and surfaces the finding; a failed base verification re-cuts, bounded at 2, then escalates; and Feature
Branch Workflow's release-branch options A/B, when the user picks neither or the integration conflicts, is
now an explicit stop-and-surface edge in the rule.

**Why the release phases were NOT converted to dispatch `post-merge-cycle`.** `source-stabilization` and
`version-bump` each dispatch `merge-verifier` directly with their own FAIL routing, and that is correct:
a release phase routes a failed landing back to its own step and performs no deletion and no base reset.
They share the leaf agent, not the sequence — so there is nothing to deduplicate.

**Refuted from phase 1 (§5.2), deliberately:**

- **The `branch-guard` → "branch-lifecycle" promotion and its `branch-creation` phase.** Re-growing
  `branch-guard` would undo `HARNESS-DIET-005`'s deliberate 144 → 33-line cut to a pointer; branch creation
  is invariants plus a mechanical hook, not a pipeline; and its only ordered part — the base reset — is
  `post-merge-cycle`'s own last phase, so a `branch-creation` skill would have duplicated it.
- **A branch-deletion judgement agent** (§9.4 left this open for a future `branch-cleanup` worker). All
  four don't-delete-when conditions are mechanically decidable from observable state, so they are gate
  conditions an orchestrator evaluates — not a verdict a role forms. An agent holding them would put
  control flow in an agent file.

This mirrors §5.4's refutation for `spec-workflow.md`: report the refutation, do not manufacture a skill to
match a prediction.

**Three governance CONTRADICTIONS in the live rule — all resolved, all flagged. The third was found by the
review round, not by this increment, and it was a live safety regression:**

1. **The rule instructed what its own CI job blocks.** § Feature Branch Workflow said "when current branch
   is `main`: … create a PR targeting `main`", while § Branch Policy forbids exactly that and the
   `main-pr-source-guard` CI job `exit 1`s on any head that is not `develop`/`release/*`/`hotfix/*` — the
   #1216 incident this guard exists to prevent. **Resolved by preserving the ENFORCED behaviour** and
   fixing the stale text: on `main`, cut from the freshly-fetched `origin/develop` and target `develop`.
   No behaviour changes, because CI already decided this; only the rule stopped contradicting itself.
2. **"Mandatory" vs "judgement call", from two different dates.** #1414 (2026-07-25) rewrote
   § `--delete-branch` into a judgement call with four don't-delete-when conditions, but left § Delete
   Merged Branches **(mandatory)** saying "delete its now-merged feature branch so only `develop` and
   `main` remain". **Resolved in favour of the newer owner decision:** mandatory now explicitly means "do
   not leave it undone", not "delete unconditionally", and a skipped deletion must record which condition
   held.
3. **`git branch -D` vs `git branch -d` — one rule prescribing both, and C2 was about to entrench the
   unsafe one.** § `--delete-branch` (the #1414 text) said "clean it up: `git branch -D <name>`", while
   § Delete Merged Branches said "`git branch -d <branch>` (the `-d` form refuses an unmerged branch — **a
   built-in guard**)". C2's resolution elevates the first section — so, unfixed, it would have made the
   force form the winning prescription and defeated the guard the other section documents. That is not
   cosmetic: `-D` on a branch whose merge did not take every commit deletes unmerged work locally, exactly
   the hazard the four don't-delete-when conditions exist to prevent. **Resolved:** the safe `-d` form is
   now prescribed in both places, and `-D` is reserved for an explicitly approved abandon of a
   never-merged branch. **This increment did not find it; the review round did.**

**What deliberately stayed in the rule, and why.** Of the 84 ledger statements (77 re-derived here + 7 the
review round added), **75 stay textually**, six keep their mandate in the rule while their ordering or
criteria move to a named skill or agent, and three are gate conditions the rule owns and
`post-merge-cycle` consumes. **Zero are dropped, and — after the review round — zero live only in a
skill.** Branch
naming, the protected-branch policy, the one-branch-at-a-time rule and both its exceptions,
clean-tree-before-commit, the merge-time deletion ban and its precondition, PR batching, commit cadence,
churn/stash hygiene, and the whole Pre-Merge Code-Review Gate taxonomy are invariants — "X must hold",
not "do this in order". Only three statements' ORDERING or CRITERIA moved, and each keeps its mandate in
the rule: Merge Landing Verification's four checks (already `merge-verifier`'s criteria verbatim), Delete
Merged Branches' and Post-Merge Branch Cycle's step order (→ `post-merge-cycle`), and the code-review
gate's waiting/looping (→ `pr-review-orchestration`, which now dispatches `ci-gate-watch` for the wait).
The gate's two _preconditions_ — required checks green, review scoped to the branch-versus-base diff —
were briefly relocated into the skill and the review round correctly ruled that a loss of force: a
precondition of a zero-exceptions gate binds every PR, whereas a skill binds only its invokers. Both are
back in the rule as invariants, which is increment 2's landed correction applied again.

**Ledger reconciliation — the largest undercount of the four.** Phase 1 §7.2 listed **35** mandatory
statements; re-deriving from the live file found **77**. 26 have no row in the inventory at any
granularity; 16 more are subordinate clauses it folded into a headline row. The confirmed pattern is
increment 2's, amplified: a section with six independent mandates contributed one row. Statements the
inventory carried nothing for include — a filling context window is **not** a reason to stop implementing;
`delete_branch_on_merge` is deliberately off; never run `gh pr merge` and the deletion in one blind
sequence; one conventional commit per logical step within the PR; no merge — admin or otherwise — before
the gate completes; never treat `pending` or `not-required-skipped` as pass; the orchestrator MUST
partition file ownership before spawning; a clean branch has zero merge commits in its PR range. §7.2 is
now annotated so later readers treat every §7 count as a lower bound.

**And the 77 was still short — the review round found 7 more (final: 84).** Exactly the increment-2
result, reproduced: a deliberate re-derivation, then an independent reviewer finding what it missed. The
misses, in descending severity: (a) **the one statement the increment actually relocated had no ledger row
at all** — "open the PR and wait for its checks (CI) to be green"; (b) "run `/code-review` **scoped to the
PR's diff (the branch vs. its base)**" — the diff scope, without which the gate is satisfiable by
reviewing one file; (c) and (d) Merge Landing Verification's checks 1 and 2 (PR state `MERGED` + merge
commit on the target's _remote_ head; claimed changes actually present with no unrelated drift) — both
survive as `merge-verifier` criteria, but the working agreement is to show each statement's new home, not
assume it; (e) PR Batching's _second_ split trigger, "or when a part is independently revertible and
valuable"; (f) § Delete Merged Branches' state invariant, "so only `develop` and `main` remain as standing
branches" — which matters precisely because C2 rewrites that sentence; (g) Commit Cadence's "then open one
coherent PR (DX-001)". **The generalisable lesson: the statement a ledger is most likely to omit is the
one the change is about to move.** Re-derive the ledger, then check it specifically against the diff.

**A systematic ledger gap, reported for the next increment.** The ledger records _mandates_ but not
_enforcement and override facts_, and this rule is dense with them: `BRANCH_GUARD_ALLOW_DELETE=1`,
`ALLOW_LESSONS_COMMIT=1`, `BRANCH_GUARD_ALLOW_OPEN_BRANCHES=1`, the `pre-push-check.sh` merge-commit
block, and the `git reset --hard origin/develop && git cherry-pick` recovery. Each would lose force if
deleted, so each passes the ledger's own stated test — and none has a row. Nothing was at risk here (all
stayed textually), but `spec-workflow.md` has the same shape and its ledger should cover them.

**Mechanical-evidence preservation.** `scan-consistency` resolves `AGENTS.md > "…"` skill anchors against
the union of `.agents/rules/*` headings; `branch-guard/SKILL.md` cites `"Git Operations"`, which exists
only in this file — that heading is unchanged. All 15 section headings are preserved, because six are
named by title in skill Rule Anchors and four are quoted as completed-spec evidence. `INFRA-015`'s TC-01
claim ("Post-Merge Branch Cycle / `checkout develop`", 4 hits) is intact at 4 — the ordered command block
moved but the heading and all three prose mentions stayed. `scan-review-findings`' four required literals
in `pr-review-orchestration` (`git-branch.md`, `unresolved MUST`, never-merge-`main`,
`merge-verifier`/`MERGE VERIFIED`) all survive the merge-path rewrite.

**Deferred, deliberately:** § Deployment stays put. §9.5 flagged its owner should be
`project-structure.md` or a deployment spec, but that file is outside this increment's ownership (the
BE-42/BE-43 precedent), and its literal Cloudflare sentence is quoted as evidence by `ARCH-AUDIT-004` and
two `.design/architecture-audit/` documents — moving it must be a deliberate change that updates them,
not a side effect. `merge-verifier.md` was **not** edited for the same ownership reason, so the rule's
stronger "never treat `pending`/`not-required-skipped` as pass" stays in the rule rather than moving into
the agent (it is invariant-shaped anyway — a definition of "green").

**Review round (the gate increment 2 introduced, dogfooded again).** `proposal-reviewer` was dispatched on
this increment's recommendation and returned `REVIEW VERDICT: REVISE` — endorsing all four structural calls
(build `post-merge-cycle`; refute `branch-creation` + the `branch-guard` promotion; refute a
deletion-judgement agent; defer § Deployment) and both contradiction resolutions, while finding a third
contradiction and two invariant losses. All were verified against `origin/develop` before acting, and all
are fixed: the `-D`/`-d` safety regression (C3 above); the two gate preconditions returned to the rule
(M1/M2); the routing-gap count corrected from three to four; the ledger arithmetic corrected; and two
consequences of the refutations that the recommendation had not discharged — § Branch Policy pointed at
`branch-guard` for "detailed procedures including protected branch checks **and deployment**", a promise
that 34-line pointer stub does not keep and never did (it now points at the hook and husky, which are the
actual floor), and § Deployment gained the likely-owner pointer increment 2's deferral precedent requires.
The reviewer also **discounted one of the increment's own arguments** — that promoting `branch-guard` would
undo `HARNESS-DIET-005`'s diet — as legacy preservation rather than evidence about where content belongs.
That is correct, and the refutation stands on its other two arguments.

**Reported, not reached.** Two follow-ups this increment could not close in scope: (a) `merge-verifier`'s
check 4 is weaker than the rule's "never treat `pending`/`not-required-skipped` as pass", so the rule now
depends on an agent that under-specifies one clause — editing `.claude/agents/merge-verifier.md` was
outside this increment's file ownership; (b) the gate mandates a `/code-review`, but this repo has no
`/code-review` command — only a `package-code-review` skill and the `pr-review-*` agents. Both predate
this increment and neither was introduced by it.

**Not rehearsed:** `post-merge-cycle` end to end. Its first leaf (`merge-verifier`) is an existing,
exercised agent, but the full verify → delete → re-base cycle needs a real merge to exercise, and this
increment's own PR must not be merged by the agent.

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
