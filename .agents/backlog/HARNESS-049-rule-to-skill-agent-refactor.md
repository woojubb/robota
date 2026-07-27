---
title: 'HARNESS-049: refactor rules into thin orchestration skills + extracted agent definitions'
status: in-progress
created: 2026-07-26
priority: high
urgency: soon
area: .agents/rules, .agents/skills, .claude/agents
depends_on: []
---

# HARNESS-049: procedure belongs in skills, roles belong in agent files

## Remainder (reconciled 2026-07-26) — read this first

Both of the item's own defects are **fully discharged**: defect #1 (procedure trapped in rules) by
increments 1–4, defect #2 (three skills that inline roles) by increment 5. Increment 5's refusal to
archive was re-checked against the tree today and **all three blocking pointers are still live**, so
the refusal still stands — this is not a stale note:

| Live pointer                             | Exact text                                                                                                                | What it defers                             |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `.agents/specs/orchestration-map.md:131` | "the gate. Tracked in `HARNESS-049`."; the row's floor column reads `**recommendation gate: floor PENDING** (‡)` at `:97` | the recommendation gate's mechanical floor |
| `.agents/rules/git-branch.md:389`        | "tracked in `HARNESS-049` and must update the documents that quote these sentences as evidence."                          | § Deployment's 2-bullet deletion           |
| `.agents/rules/spec-workflow.md:172`     | "`HARNESS-049` for the reported gap.)"                                                                                    | the folder ↔ status mechanical floor       |

**The five tabled remainders, each stated so the next agent can act without re-reading this file:**

1. **Recommendation-gate mechanical floor** — `orchestration-map.md:97` claims a floor for the backlog
   recommendation gate that does not exist. Either build a scan under `scripts/harness/` that fails when
   a recommendation gate ran without a recorded `REVIEW VERDICT`, or change the row to `none` and drop
   the `‡` footnote. Needs `scripts/**` (for the first) or `.agents/specs/**` (for the second).
2. **Folder ↔ status mechanical floor**, plus **six live violations** it will immediately surface:
   `spec-docs/done/` holds `INFRA-016`, `INFRA-019`, `INFRA-020` at `draft`, `PM-026`, `PM-030` at
   `approved`, `DATA-002` at `in-progress`. The floor belongs in
   `scripts/harness/check-spec-doc-frontmatter.mjs`. Fix the six in the same change, or the floor lands red.
   Needs `scripts/**`.
3. **`git-branch.md` § Deployment's 2-bullet deletion** — increment 4 REFUTED the relocation and proved
   it is a deletion: `.agents/specs/architecture-map/apps-and-deployment.md` already owns bullets 1–2, and
   the three documents quoting the literal Cloudflare sentence are all archival, so they must NOT be
   rewritten. Bullets 3–4 stay (they are branch policy). Needs `.agents/rules/**`.
4. **`pnpm docs:deploy` is broken** — `git-branch.md` and `scripts/docs/deploy-cloudflare-pages.mjs` both
   target `apps/docs/.vitepress/dist`; `apps/docs` has no `.vitepress` directory and builds with
   `next build && pagefind --site out`. `apps-and-deployment.md` is the correct side. Needs `scripts/**`.
5. **BE-42 / BE-43 relocations** — BE-42 Layering Rule → `.agents/project-structure.md`, BE-43
   Orchestration Skill Rule → `.agents/rules/enforcement-architecture.md`. Both need BOTH ends
   (`backlog-execution.md` as the source), which is why neither increment could reach them.

Each should become its own backlog file; at that point the three pointers above are repointed and **this
item is archived**. The reconciling agent on 2026-07-26 owned only `.agents/backlog/**`, so it could
neither repoint a rule/spec nor build a `scripts/**` floor — hence: verified open, remainder sharpened,
not archived.

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

## Phase 2, increment 4 — `spec-workflow.md` — DONE (2026-07-26)

The last increment, and the one phase 1 called correctly: **zero new skills, zero new agents.** The rule
went 253 → 287 lines. Growing again is the right result for the third time — this is the most
invariant-dense of the four (91 mandatory statements in 253 lines), and what left it was one restated
sequence while what arrived was a mapping table the rule should always have owned.

**What moved, in full — only four statements changed home:**

| Statement                                       | New home                                                                           |
| ----------------------------------------------- | ---------------------------------------------------------------------------------- |
| § User Request Gate's 4-step sequence           | [`user-request-gate`](../skills/user-request-gate/SKILL.md) (mandate kept in rule) |
| Status ↔ folder mapping                         | **stays in the rule, now richer** — gained `rejected` + the shared-`active/` fact  |
| Change → SPEC-section mapping                   | **stays in the rule** as the mandate's triggers; the skill keeps 2 authoring rows  |
| GATE-IMPLEMENT/VERIFY/COMPLETE criteria + order | gate catalogue (moved file) + `backlog-pipeline` (mandate kept in rule)            |

Everything else — 87 of 91 — stays textually. Nothing is dropped.

### The three items deferred to this increment, resolved

**1. The gate catalogue was filed as the wrong artifact kind — MOVED, and it named a fourth kind.**
`.agents/skills/backlog-gate-guard/SKILL.md` was a fact catalogue wearing a skill's frontmatter: nothing
ever invoked it (`backlog-pipeline` passes it as a _data input_: `Criteria catalogue: <path>`). It is now
[`.agents/specs/gate-catalogue.md`](../specs/gate-catalogue.md), alongside `orchestration-map.md` and
`deployment-matrix.md`. All eight inbound links repointed; the skill row removed from
`.agents/skills/index.md` (the **agent** stays registered there, which is what `agent-def-convention`
requires); rows added to `.agents/specs/README.md`.

The move forced a governance question the increment did not duck: if this is none of the three kinds,
what is it? **`harness-composition-design.md` now names the fact catalogue as a fourth artifact kind**,
with the test that separates it from a rule — delete it and ask what is lost; losing a rule loses force,
losing a catalogue loses an enumeration whose force lives elsewhere. It is registered in
`document-standards/index.md` as `partial` (no shared shape/coverage gate). The review round caught a
side effect: `.agents/specs` was not in `consistency.guidancePhraseScanTargets`, so the move would have
dropped the catalogue out of the terminology blocklist — exactly the guard that matters for a file that
now solely owns the `DONE-GATE-STAGE-1/2` criteria. `.agents/specs` was added to the target list and the
scan passes.

**2. Status levels / lifecycle folders — the rule owns the mapping, and richness was the wrong tiebreaker.**
The prior increment's proposal was tested and adopted: the rule gains
§ Spec-Document Status and Lifecycle Folders; `backlog-pipeline` drops its `Folder` and `Folder move on
PASS` columns and **derives** each move. Verified all six transitions still resolve. The old arrow-list
in the rule was worse than duplicated — it implied a 1:1 status↔folder correspondence that is false
(`in-progress` and `verifying` share `active/`), and it omitted `rejected` entirely.

**Verified before merging, as instructed:** this is a different vocabulary from `backlog-execution.md`

> Status Invariants (spec-doc lifecycle vs `.agents/backlog/` item placement). They share the tokens
> `in-progress`/`done` but not their meaning; neither overrides the other, and the rule now says so.

**Reported, not closed:** no mechanical floor asserts folder ↔ status agreement, and **six documents in
`spec-docs/done/` violate it today** (`INFRA-016`/`INFRA-019`/`INFRA-020` at `draft`,
`PM-026`/`PM-030` at `approved`, `DATA-002` at `in-progress`). The increment's first draft promoted the
agreement to a repo-wide NON-COMPLIANCE — the review round caught that this ships six live violations
and a prose-only mandate in the same PR that strengthens `enforcement-architecture.md`'s
"a prose-only guardian buys nothing". Reverted to the pre-existing force (NON-COMPLIANCE **on the next
gate run**). The floor belongs in `check-spec-doc-frontmatter.mjs`; `scripts/**` was outside ownership.

**3. § Deployment — the relocation is REFUTED. It is a deletion, not a move.**
Three findings settle it, and none was visible without reading the destination:
`architecture-map/apps-and-deployment.md` **already owns** bullets 1–2 (Cloudflare Pages auto-deploy from
`main` for blog + docs; the manual `deploy-cloudflare-pages.mjs` upload), so those are duplication to
delete; bullets 3–4 are branch policy and belong in `git-branch.md`; and the three documents quoting the
literal Cloudflare sentence are all **archival** (a `completed/` backlog item and two dated
architecture-audit records), so rewriting them would falsify the historical record — which makes the
"must update the documents that quote these sentences" instruction in the live rule itself wrong.
The residual 2-bullet deletion needs `git-branch.md`, outside this increment's ownership.

**A real bug found on the way, with the stale side backwards from increment 3's note.** `git-branch.md`
and `scripts/docs/deploy-cloudflare-pages.mjs` both target `apps/docs/.vitepress/dist`; `apps/docs` has
**no `.vitepress` directory** and builds with `next build && pagefind --site out`. **`pnpm docs:deploy`
cannot succeed.** `apps-and-deployment.md` is the correct side. Fixing it needs `scripts/**`.

### Phase 1 was wrong about two structural things inside its own refutation

- **The ABSOLUTE RULE's four-step wrong-SPEC exception has no owner where phase 1 sent it.**
  `spec-code-conformance` **explicitly disclaims** spec correction. The real owner is
  `spec-writing-standard` **Mode C**. The four steps stayed in the rule (they are the exception's
  conditions, invariant-shaped) and both documents gained the interlock — Mode C read as a flat
  contradiction of the ABSOLUTE RULE ("fix the spec to match the current code") with neither naming the
  other. § Live Spec Policy pointed at the same wrong skill; the review round caught that half of the
  mis-routing was still live after the first fix.
- **Phase 1 missed a duplication entirely**: the rule's change→section table and `spec-writing-standard`
  Mode B Step 1's table are the same mapping, already drifted in wording. Resolved with the rule owning
  the seven mandate rows; the skill keeps its two extra rows **labelled authoring-only, by design**.

**The near-miss worth recording.** The first draft merged the skill's richer table into the rule's, on
the argument that the two extra rows were "refinements of the existing behaviour/semantics row". The
review round showed that is **false for `Test Strategy`**: a test-only PR changes no behaviour, so no row
of the old table fired — and the merged table would have made every coverage-changing PR an "incomplete
change, treated the same as a build failure". A de-duplication had silently widened a mandate. This is a
new failure mode: **the ledger method is loss-only and structurally cannot see it.** The design doc now
carries a "no unexamined behavioral GAIN" working agreement, and §7.3 records that a table-coarse ledger
cannot register a mandate change that is a table-ROW addition.

### The orchestration-nesting contradiction is CLOSED

`enforcement-architecture.md` banned the nesting three increments had already shipped. Two increments
reported it and neither could reach the file; this one owns it. Resolved with the proposed wording:
**nesting for responsibility separation is sanctioned** (governed by `harness-composition-design.md`),
**nesting for reliability stays banned**, and the two are told apart by the reason given — "a phase has
its own ordering, or two callers would otherwise each carry a copy" versus "wrapping it makes the agent
more likely to do it". Step 4 of "Applying it to a new enforced step" was rewritten to match.

### Refuted, and why the asymmetry is principled

§ HARD GATE's five-step sequence was **kept**; § User Request Implementation Gate's four-step sequence
was **removed**. The separator is **destination availability**, not "the items name their owners" (they
both did): `user-request-gate` Phases 1–4 already own the user-requested ordering end to end, whereas
HARD GATE covers the **agent-discovered** trigger and its step 1 (Architecture review) has no owning
skill anywhere. Under "move, never duplicate", content cannot be relocated into a destination that does
not exist, and manufacturing one to match a prediction is the failure mode §5.4 warns about.

### Ledger reconciliation — 35 → 91, the largest ratio of the four (2.6×)

Re-derived from the live file at the granularity increments 2 and 3 settled on. Statements with no row at
any granularity include the User Request gate's zero-exception clause; "No exceptions. One-line fixes …";
**every enforcement fact** (the `spec-first-gate.sh` hook, `harness:conformance`'s exit-code contract and
its `deps`-scan trigger) — increment 3 predicted this rule would have exactly that gap and it did; the
four-item "Authority order by question" list; "authority is determined by path and role, not by a broad
word in the filename"; the three named structural documents; the package-local `docs/ARCHITECTURE-MAP.md`
mandate; three of five content-promotion rules; and both Cross-Package follow-on clauses.

**First increment where the review round found no missing statement.** All 11 of its candidate additions
were already among the 91. It found two additions of _force_ instead — which is the more interesting
result, and is why the ledger method itself changed.

### Minor defects fixed in passing

`spec-code-conformance`'s Rule Anchor pointed at `process.md` for a section that lives in
`spec-workflow.md` (`process.md` is a routing stub — the anchor had been dead since the rules split);
`spec-first-development` Step 6's link `../skills/spec-code-conformance/SKILL.md` resolved to
`.agents/skills/skills/…`.

### Review round

`proposal-reviewer` returned `REVIEW VERDICT: REVISE` — endorsing the direction of all seven
recommendations and finding one **false premise** (the `Test Strategy` broadening), one clause that
would have shipped **six live NON-COMPLIANCEs with no floor**, a **half-fixed mis-routing**, a **scan
coverage set the move silently left**, an **unregistered fourth artifact kind**, an **inverted stale-side
diagnosis** masking a broken script, and `backlog-pipeline` keeping two copies of facts it had just
disclaimed. All were verified against the tree before acting; all are fixed or recorded above. Three
increments, three REVISE verdicts, three times the reviewer caught something the increment's own careful
pass did not — the gate has never once been a formality.

### Reported, not reached

- **`pnpm docs:deploy` is broken** (`.vitepress/dist` no longer exists) — needs `scripts/**`.
- **No mechanical floor for folder ↔ status agreement**, six live violations — needs `scripts/**`.
- **§ Deployment's 2 duplicated bullets** — needs `git-branch.md`.
- Increment 2's two deferrals are **still open** for the same ownership reason: BE-42 Layering Rule →
  `project-structure.md`, BE-43 Orchestration Skill Rule → `enforcement-architecture.md`. The target of
  BE-43 is now in ownership, but the source (`backlog-execution.md`) is not, and a move needs both ends.
- `CI TRIAGE`, `GATE VERDICT` and `SCENARIO DRAFTED` are still absent from `CLOSED_SIGNAL_VOCAB`
  (`scripts/**`).

**Not rehearsed:** nothing new to rehearse — this increment created no agent and no skill. The moved
catalogue was verified by reading it end to end after the move and confirming every link resolves.

## User Execution Test Scenarios

**Not applicable.** This item changes only rules, skills, agent definitions, and registry indexes — no
package or app source, and no user-runnable procedure. `backlog-execution.md` § User Execution Test
Scenario Rule states that rule-only, skill-only, and governance-only changes mark the gate N/A and record
verification evidence in the engineering test plan instead. Verification evidence for each increment is
`pnpm harness:verify-like-ci` green plus the invariant-preservation reconciliation recorded per increment
above; the agent rehearsals are governance evidence and are recorded as such, not as user-execution
evidence.

## Status after the four planned increments (2026-07-26)

> **Superseded by increment 5 below**, which resolved both remaining skills. Two of this section's
> claims did not survive contact: `delegated-refactor-green-gate` **did** need a new agent (the
> "neither needs a new agent" prediction was wrong — see the reuse conflict recorded there), and
> `dependency-graph-extraction` needed an artifact-kind ruling, not just a fold. Kept as written
> because the verdict it reached — do not archive — is still the right one, for a reason it did not
> have.

**NOT complete — deliberately not archived.** The four-rule programme (`publish.md`,
`backlog-execution.md`, `git-branch.md`, `spec-workflow.md`) is finished and every increment is merged
and verified. But the item's own defect #2 named **three** skills that inline roles, and only one has
been resolved:

| Skill                           | Status                                                                                           |
| ------------------------------- | ------------------------------------------------------------------------------------------------ |
| `backlog-pipeline`              | **DONE** (increments 2 + 4) — dispatches the extracted agent; the criteria are a fact catalogue  |
| `delegated-refactor-green-gate` | **NOT STARTED** — two inlined roles (worker charter + a guardian duty asked of the orchestrator) |
| `dependency-graph-extraction`   | **NOT STARTED** — not a pipeline at all; §4 recommends folding it in and deleting the file       |

Both are analysed in [inventory §4](../specs/harness-composition-inventory.md#4-skills-that-inline-roles)
with concrete recommendations, and `dependency-graph-extraction` is additionally recorded in §9.10.
Neither needs a new agent; both are single-increment work. **Closing this item without them would close
it on two thirds of its own problem statement.**

Also open, each blocked only on file ownership and each recorded under its increment: the `git-branch.md`
§ Deployment 2-bullet deletion, the folder ↔ status mechanical floor (+ six live violations), the broken
`pnpm docs:deploy` path, BE-42/BE-43's relocations, and the three terminal signals missing from
`CLOSED_SIGNAL_VOCAB`.

## Phase 2, increment 5 — defect #2's two remaining skills — DONE (2026-07-26)

The two skills the four-rule programme left are resolved, and they resolved **differently from each
other** — which is the point. One was a pipeline with a role trapped inside it; the other was not a skill
at all.

### `delegated-refactor-green-gate` — one role extracted, one role REUSED, one predicted role REFUTED

Three pieces of content, three different homes:

| Content                                                       | Kind                      | New home                                                    |
| ------------------------------------------------------------- | ------------------------- | ----------------------------------------------------------- |
| § The Delegation Contract 1–4 ("give this to the subagent")   | worker charter            | **NEW** `.claude/agents/mechanical-refactor-worker.md`      |
| § Orchestrator Responsibilities — "review the diff for creep" | role (a judgement)        | `pr-review-reviewer` (existing agent, **reused unchanged**) |
| § Orchestrator Responsibilities — treat green as a hypothesis | **invariant**, not a step | `verification.md` § Delegated Verification Claims (**NEW**) |

**The new agent, and why reuse was refused.** Inventory §4 recommended reusing `architecture-implementer`
and splitting only "if a real conflict appears". The conflict is decisive and is in that agent's own
text: `architecture-implementer.md` lines 42–45 instruct it to **refuse** exactly this class of work —
"If realizing a finding requires a large, cross-cutting … refactor that cannot be done safely as a
minimal edit, do not start hacking. Stop and return a remediation plan." A mass rename _is_ that.
Reusing it would mean dispatching an agent chartered to decline the task. Its input contract also differs
in kind: a findings list, not a specification. All 17 agent files were checked; none is a
specification-driven bulk-edit worker.

> **A weaker argument was withdrawn in review.** The first draft also argued that folding the
> never-commit rule into `architecture-implementer` would change behaviour for `architecture-refresh`,
> "where implementers commit". That is **false**: `architecture-implementer.md:41` says "You do not
> merge; you produce a verified change for review", and `architecture-refresh/SKILL.md:33` reserves
> landing to the orchestrator. Recorded because a wrong fact about a neighbouring pipeline, left in a
> rationale, is what a later increment reads as settled.

**The refuted extraction.** Inventory §4 also wanted a guardian that "re-runs the gates and emits a
verdict". **Refuted**, on the design doc's own settled corollary: running a verification entry point and
reading its exit code is a _mechanically decidable gate condition_, not a verdict, so it is control flow
the orchestrator evaluates itself. A guardian here would additionally have shipped with no mechanical
floor, which `enforcement-architecture.md` forbids. This is the second time the corollary has prevented
an agent-per-checklist; it is doing real work.

**But the obligation is not a step.** "A delegated green is a hypothesis until independently reproduced"
binds every actor who receives such a claim, not only whoever invokes this skill — so per the
"a precondition of a gate is an invariant" agreement it became a rule, not skill prose. Verified first
that no rule already owned it (exhaustive grep of `.agents/rules/` for delegation/self-report/re-verify:
only build-after-commit and merge-landing, neither of which is this). `post-implementation-checklist`
step 2, which had pointed at the _skill_ for the obligation, now points at the rule.

### `dependency-graph-extraction` — a FACT CATALOGUE, and the file is deleted

By the four-kind test: not an orchestration skill (three unconditional commands — no phases, no gates,
no routing); not an agent (it forms no verdict and says so); not a rule (delete it and no _force_ is
lost). It is the fourth kind — an enumeration a skill consults, whose force lives elsewhere.

It did **not** become a standalone `.agents/specs/*.md` catalogue. Its three facts split by owner, which
a single new file would have obscured:

- **The invariant** — "the dependency graph's ground truth is the manifests, never a document" — went to
  `.agents/project-structure.md`, which already owns the package listing and the dependency-direction
  rules the guard enforces. That is a rule gaining a rule, not a catalogue.
- **The runnable procedure** — the two commands, the `CONFORMANCE_JSON_BEGIN`/`END` markers, capturing
  `harness:scan`'s full output as the consistency baseline, and the `name → [deps]` derivation — went
  into `architecture-conformance-audit` step 1, which already carried two thirds of it. The step now
  states **why** it is concrete rather than pointing (it is the one part of an audit that must be
  reproducible byte-for-byte), as the neutrality section requires.

**Overruling a previous decision, explicitly.** `HARNESS-DIET-005` (line 59) deliberately **kept** this
file — "kept as the mechanical-floor leaf" — in the same pass where four siblings became pointer stubs
"(files kept so inbound links resolve)". That decision is overruled here on a ground DIET-005 did not
have: the artifact-kind test, which did not exist then. A pointer stub would have preserved a link at
the cost of a file whose kind is wrong; nothing links to it from `scripts/`, `.claude/`, or `.github/`,
so deletion costs no resolution.

**Archival records left untouched**, per increment 4's precedent (it retired the `backlog-gate-guard`
skill and did not rewrite INFRA-015). The specific claim that goes stale is `INFRA-003`'s TC-01, "all 5
skills present" — named here rather than silently left. Increment 2's opposite precedent does not govern:
there the restored text was an independently **mandatory statement** whose loss was the defect, and the
`grep -c` evidence merely corroborated it. Nothing mandatory is lost here.

### Declared behavioral GAINS and narrowings (the ledger is loss-only; this is the other direction)

1. **A mandatory `pr-review-reviewer` dispatch** replaces "the orchestrator reviews the diff". Justified
   on its own merits: forming a quality verdict is judgement the design forbids an orchestrator, and an
   existing guardian serves it. Mirrors increment 2's recommendation-gate precedent. Binds only this
   skill's invoker.
2. **A file-set scope check (step 3b)** is new. It is the mechanically decidable half of "scope creep",
   so the corollary applied in the refutation above is applied here too rather than handed to the
   guardian — the review round caught the first draft applying it in one place and not the other.
3. **Bounded loop caps** (2 re-specifications / 2 re-verify rounds / 2 review rounds) are new control
   flow. Required by the design doc's "a loop with no stated termination condition is a defect".
4. **Step 1 is now a gated step**, where the old file had "can be specified precisely enough" as a mere
   use-precondition. It is what step 3b compares against, so it must be written down to be checkable.
5. **A generic terminate edge** into `backlog-execution.md`'s Stop Conditions — increments 1–2's
   precedent, applied to a non-backlog pipeline, which widens their reach.

**And the one that was a LOSS wearing a gain's clothes.** The first draft replaced the old four hardcoded
commands (`pnpm build` / `typecheck` / `test` / `harness:scan`) with "the project's CI-equivalent
verification entry point" and declared it a _strengthening_. It is not: `verify-like-ci.mjs`'s
`CI_STAGES` are harness-self-test, format-check, scan-suite, scan-suite-dist-free, typecheck — there is
**no `pnpm test` stage and no `pnpm build` stage**. The substitution would have dropped the package test
suite from the delegation gate, on precisely the class of change that compiles while behaving wrongly.
The gate is now stated as the entry point **plus** the build + test suite for the affected scope, in both
the agent charter and the skill's steps 2 and 3a. The supporting citation had said so all along —
`worktree-parallel-orchestration` step 4 reads "…entry point … **plus the project's test suite**" — and
the first draft quoted it while dropping its second half.

### A narrowing that was WITHDRAWN in review

The first draft made the worker's hand-back rule conditional ("unstaged when you share the caller's
tree"), on the argument that an absolute form contradicts `worktree-parallel-orchestration` step 4. The
contradiction is **not live** — no dispatch path connects the two skills — and the conditional created a
real one _inside the new agent_, whose isolated-checkout branch said "follow the project's normal change
process" (which means opening a PR) two paragraphs above "do not open a pull request". The rule is
absolute again; `worktree-parallel-orchestration` owns the isolated case.

### The three terminal signals — CLOSED, and the live state was not what either report said

Two increments reported `CI TRIAGE` / `GATE VERDICT` / `SCENARIO DRAFTED` as missing from
`CLOSED_SIGNAL_VOCAB`; a later report claimed to have registered them. Read from the tree, **both were
half right**: INFRA-048 (`7abc5bbfc`, #1434) registered all three tokens in
`check-agent-def-convention.mjs`, but the three agents still declared **no `signal:` frontmatter field**,
so nothing was mechanically checked — and `orchestration-map.md`'s `†` footnote still asserted the tokens
were unregistered. The scripts half was already done, so the rest needed no `scripts/**`: the three
agents now declare their field (the guard's second condition, that the body instructs ending with the
token, was already satisfied at `ci-failure-triager.md:83`, `backlog-gate-guard.md:90`,
`user-execution-scenario-author.md:108`), and the stale footnote is replaced. `agent-def-convention`
passes with `violations=0`.

### Review round

`proposal-reviewer` returned `REVIEW VERDICT: REVISE` — the fifth REVISE in five increments, and again it
caught what the increment's own careful pass did not. It found the dropped test suite (a declared _gain_
that was a **loss**), two rationales resting on **false premises** (the `architecture-implementer`
commit claim; the "live contradiction" behind the withdrawn narrowing), a **contradiction inside the new
agent file** that the withdrawn narrowing had introduced, the corollary applied inconsistently between
the refutation and the reviewer dispatch, an **out-of-charter ask** (missed sites are not in a reviewer's
changed set), a **floor over-claim** in the map (`scan-review-findings` reads only two files, neither of
them this pipeline's), the `CONFORMANCE_JSON_*` / baseline-capture **residue** the "already duplicated"
claim had glossed over, a prior decision this increment was silently overruling (`HARNESS-DIET-005`), and
the archival blocker below. Every finding was verified against the tree before acting; all are folded.

### Why this item is STILL NOT archived — a mechanical reason, not a feeling

`backlog-execution.md` requires that a "tracked as follow-on" claim name an **existing** file. Three
**live** documents currently name `HARNESS-049` as the tracker for open work:

| Document                                   | What it defers to this item                        |
| ------------------------------------------ | -------------------------------------------------- |
| `.agents/specs/orchestration-map.md` (‡)   | the recommendation gate's missing mechanical floor |
| `.agents/rules/git-branch.md` § Deployment | the deployment-topology relocation                 |
| `.agents/rules/spec-workflow.md`           | the folder ↔ status floor gap                      |

Archiving without repointing all three would leave live rule and spec pointers aimed into
`.agents/backlog/completed/`. Two of the three are `.agents/rules/**` edits beyond this increment's
declared ownership, and closing the underlying gaps needs `scripts/**`. So the correct disposition is
unchanged from increment 4's: **leave the item open with the remainder tabled.** Defect #2 is now fully
discharged — all three named skills are resolved — and what remains is a set of independent follow-ups
that happen to point here.

**Tabled remainder** (each blocked on ownership, not on judgement): the recommendation-gate mechanical
floor; the folder ↔ status floor and its six live violations; the broken `pnpm docs:deploy` path;
BE-42 / BE-43's relocations; `git-branch.md` § Deployment's 2-bullet deletion. Each should become its own
backlog file, at which point the three pointers above can be repointed and this item archived.

**Not rehearsed:** `mechanical-refactor-worker`. There is no mechanical refactor to run it on inside this
increment's file ownership, and manufacturing one to satisfy the test plan would be worse evidence than
none. `pr-review-reviewer` and `proposal-reviewer` are existing, exercised agents; the reviewer was
dispatched for real on this increment and its findings are folded above.

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

## Deferrals closed 2026-07-27

All four increments this item was holding are discharged.

- **BE-42 / BE-43 relocated.** Bullets 1–3 to `project-structure.md`; BE-43 to
  `enforcement-architecture.md`, with `backlog-execution.md` keeping a router. The fourth bullet
  governs skills, not packages, so it folded into BE-43 rather than following the item's routing.
- **`§ Deployment`'s two duplicated bullets removed**, along with an ownership note instructing an
  update to three documents that are all archival.
- **`CLOSED_SIGNAL_VOCAB` was already closed** — all three tokens landed in INFRA-048 (#1434). The
  deferral was stale, not open. Nothing changed.
- **The folder ↔ status floor exists and is registered.** `scan-doc-folder-status-agreement` derives
  its criteria by parsing the rule's own table, so the mapping keeps one owner, and it now runs in
  `pnpm harness:scan`.

**The six live violations are five plus one.** Five carried `[GATE-COMPLETE] — ✅ PASS` in their own
Evidence Log, so `status: done` was derivable rather than a judgement, and they are fixed.

`DATA-002` is the one that is not. Its Evidence Log shows GATE-WRITE PASS, GATE-APPROVAL PASS and
all three phases SHIPPED — and **no GATE-COMPLETE entry at all**. Neither correction is available
without deciding something: `status: done` manufactures a completion no gate recorded, and moving it
to `active/` claims work is in progress that shipped in July — and subjects a finished record to the
live-document rules, which is how the attempt was caught (`spec-research` went red on it).

So it is a RECORDED EXCEPTION in the scan, with its reason, under anti-rot: the moment the
disagreement resolves, the entry fails and must be deleted. Red-proved both ways — resolving
DATA-002's status fails the stale entry, and a fresh disagreement elsewhere is still caught.

**Left for the owner:** run `GATE-COMPLETE` on DATA-002, or decide it does not qualify.
