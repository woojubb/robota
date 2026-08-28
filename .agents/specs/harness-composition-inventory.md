# Harness composition inventory — what today's rule content maps to

> **Companion to [`harness-composition-design.md`](harness-composition-design.md).** The design says
> _what the shape is_ (rule / orchestration skill / agent definition, the boundary test, nesting,
> "a pipeline is a state machine, not a queue"). This document says _what the current content maps
> to_ — every section of every `.agents/rules/*.md`, classified, with its proposed destination.
>
> Produced as **phase 1 of `HARNESS-049`** (measured against the tree on 2026-07-26). This is an
> analysis artifact: **nothing was moved, rewritten, or extracted**. Phase 2 executes the moves one
> rule at a time and uses the [invariant ledger](#7-invariant-ledger) to prove no behavioural loss.

## Method

Each section is classified with the design document's boundary test:

| Label       | Test                                                                         | Destination                                       |
| ----------- | ---------------------------------------------------------------------------- | ------------------------------------------------- |
| `invariant` | States _what must hold_ ("X must hold", "never Y") or _who owns a fact_      | Stays a rule                                      |
| `procedure` | States _how to do it, in order_ — and what each outcome routes to            | An orchestration skill, at the recorded **level** |
| `role`      | States _how to judge_ — criteria a single actor applies to produce a verdict | An agent definition in `.claude/agents/`          |

For `procedure`, **LEVEL** is one of:

- **pipeline** — a whole pipeline; becomes a top-level orchestration skill.
- **phase** — one phase of a larger pipeline; becomes a sub-orchestration skill, or a step in an
  existing orchestration skill when it is too small to warrant its own file.
- **role** — despite reading as steps, it is one actor's work; it becomes an agent instead.

A section carrying more than one kind is given its **primary** label and marked `⚖` in the Mixed
column; those are enumerated with their tension in [§9](#9-sections-that-resist-clean-classification).

## Headline counts

**142 sections across 22 rule files: 116 `invariant`, 21 `procedure`, 5 `role`.**

| Rule set                                                                             | Sections | invariant | procedure | role |
| ------------------------------------------------------------------------------------ | -------- | --------- | --------- | ---- |
| The four large rules (`backlog-execution`, `git-branch`, `spec-workflow`, `publish`) | 67       | 44        | 18        | 5    |
| The other 18 rule files                                                              | 75       | 72        | 3         | 0    |

The dominant result is that **rules are mostly still rules**: 82% of sections are invariants that
should not move at all. The refactor is narrow and surgical, not a rewrite — its value is
concentrated in 21 procedure sections and 5 role sections, almost all of them inside the four large
files. Anyone expecting a sweeping reorganisation should read that as the headline finding.

Of the 5 `role` sections, **only 3 distinct agent files are implied**, and one of those is an
extraction of an existing skill rather than a new role. See [§3](#3-reuse-check).

## Is this inventory trustworthy? — the four-increment reconciliation (2026-07-26)

All four `HARNESS-049` increments have now landed, and each re-derived its rule's ledger from the live
file. Here is what the four re-derivations measured against what this document originally claimed:

| Rule                   | §7 claimed | Re-derived by the increment | Review round added | Final   | Ratio     |
| ---------------------- | ---------- | --------------------------- | ------------------ | ------- | --------- |
| `publish.md`           | 39         | 40                          | —                  | 40      | 1.03×     |
| `backlog-execution.md` | 44         | 50                          | +1                 | 51      | 1.16×     |
| `git-branch.md`        | 35         | 77                          | +7                 | 84      | 2.40×     |
| `spec-workflow.md`     | 35         | 91                          | +0                 | 91      | 2.60×     |
| **Total**              | **153**    | **258**                     | **+8**             | **266** | **1.74×** |

**Verdict: the classification is trustworthy; the ledger is not, and should be regenerated rather than
patched.** They failed differently and the distinction matters:

- **§§1–6 and §9 held up well.** Every section's `invariant`/`procedure`/`role` label survived; the
  destinations were right in three of four rules; the one refuted prediction (§5.4) was refuted
  _correctly_, and §5.2's partial refutation and §9.4's resolution improved on the original reasoning
  rather than contradicting it. The routing-gap list (§6) was accurate — all 14 were real and 12 are now
  closed. Nothing here needs regenerating.
- **§7 undercounted every rule, by 3% to 160%, and the error is systematic, not random.** Its rows track
  **section topics**, so a section carrying six independent mandates contributed one row. Two whole
  CLASSES of statement have no rows at all: **enforcement and override facts** (env-var overrides, hook
  names, scan triggers, exit-code contracts — predicted by increment 3, confirmed by increment 4) and
  **subordinate clauses of a headline mandate** (the consequence sentence, the second split trigger, the
  scope qualifier). Correcting it row-by-row is not worth it: at 1.74× overall the arithmetic no longer
  supports any claim built on it, and the counting convention itself needs stating up front (see §7.3 on
  how tables are counted) before a regeneration would be reproducible.
- **The review round is load-bearing, but its yield shifted.** It caught real ledger misses in
  increments 2 and 3 — including a live safety regression the increment itself had introduced. In
  increment 4 it found **zero** missing statements (all 11 of its candidates were already among the 91),
  and instead caught two **additions of force** the loss-only ledger is structurally blind to. That is
  the method's next gap, now recorded as a working agreement in the design doc.

**If §7 is regenerated**, do it mechanically-assisted from the live files with the convention stated
first, and add an "added / strengthened" column — the four increments show that a refactor's risk is
not only what it drops.

---

## 1. The four large rules

### 1.1 `backlog-execution.md` — 457 lines, 22 sections

| Section                                                   | Class     | Level | Destination                                                           | Mixed | Reason                                                                                                                            |
| --------------------------------------------------------- | --------- | ----- | --------------------------------------------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------- |
| Agent Decision Authority                                  | invariant | —     | stays                                                                 |       | Pure authority boundary — when the agent may decide vs must stop. No ordering.                                                    |
| Recommendation Gate                                       | procedure | phase | `backlog-execution-orchestrator` (existing) + `proposal-reviewer`     | ⚖     | "Present, judge coherence, proceed or stop" is a gate with routing; the required-contents list is a document contract that stays. |
| One-Backlog-At-A-Time Rule                                | invariant | —     | stays                                                                 | ⚖     | The 4-step sequence defines what "complete" means rather than prescribing a runbook.                                              |
| PR Unit Rule                                              | invariant | —     | stays                                                                 |       | Sizing/relatedness constraints on PR shape; no ordering of actions.                                                               |
| User Execution Test Scenario Rule                         | invariant | —     | stays                                                                 |       | Defines what a valid scenario _is_ and what is banned as evidence.                                                                |
| Durable-artifact evidence rule (HARNESS-002)              | invariant | —     | stays                                                                 |       | Evidence must reference repo-resident artifacts; backed by a scan.                                                                |
| Done gate — ABSOLUTE RULE                                 | invariant | —     | stays                                                                 |       | Status may not be `done` before both stages pass.                                                                                 |
| Capability-absence claims require a probe                 | invariant | —     | stays                                                                 |       | An unprobed absence claim is not a valid exception reason.                                                                        |
| Engineering verification is NEVER user-execution evidence | invariant | —     | stays (authoritative statement — must not move)                       |       | Explicitly the SSOT other documents point at; relocating it would break `common-mistakes` #56.                                    |
| Capability Reachability — no library-seam N/A dodge       | invariant | —     | stays                                                                 |       | Defines when a capability is done; backed by `scan-capability-reachability`.                                                      |
| Agent Executability Requirement                           | procedure | phase | new sub-orchestration `user-execution-scenario`                       | ⚖     | The ask→redesign→label decision loop is ordered work; the "process violation" clause is invariant.                                |
| Done Gate Stage 1 — Scenario Written                      | role      | —     | `backlog-gate-guard` **as an agent file** (extract from the skill)    |       | These are the criteria a guardian applies to produce PASS/FAIL — judgement, not pipeline.                                         |
| Done Gate Stage 2 — Scenario Executed                     | role      | —     | `backlog-gate-guard` **as an agent file** (extract from the skill)    |       | Same: three checkboxes a guardian evaluates; forming that verdict is agent work.                                                  |
| Scenario Design Preference Order                          | role      | —     | new agent `user-execution-scenario-author`                            |       | A ranked choice between verification surfaces is judgement criteria applied while authoring.                                      |
| Completion Steps                                          | procedure | phase | `backlog-execution-orchestrator` (existing) — a step, not a new skill |       | Three ordered actions that must land in one commit; too small for its own file.                                                   |
| Status Invariants                                         | invariant | —     | stays                                                                 |       | Placement/status consistency, mechanised by `backlog-placement` + `task-archival`.                                                |
| Common Mistakes to Avoid (table)                          | invariant | —     | **relocate** to `common-mistakes.md`                                  |       | A mistake catalogue whose SSOT is `common-mistakes.md`; keeping a second one invites drift.                                       |
| Base Branch Workflow                                      | procedure | phase | new sub-orchestration `multi-backlog-initiative`                      |       | Seven ordered branch/PR steps with a terminal constraint — a pipeline in its own right.                                           |
| Layering Rule                                             | invariant | —     | **relocate** to `.agents/project-structure.md`                        |       | Package-ownership/layering is that document's declared SSOT; this is a duplicate statement of it.                                 |
| Orchestration Skill Rule                                  | invariant | —     | **relocate** to `enforcement-architecture.md` / the design doc        |       | It governs how skills are written — nothing to do with backlog execution.                                                         |
| Stop Conditions                                           | invariant | —     | stays; each becomes a terminate-edge in the orchestrator              | ⚖     | The conditions are invariants; the consequence ("halt") is routing the skill must carry.                                          |
| Checklist                                                 | procedure | phase | `backlog-execution-orchestrator` (existing)                           |       | A derived run-checklist — must point at the invariants above, never restate them.                                                 |

### 1.2 `git-branch.md` — 312 lines, 15 sections

| Section                                     | Class     | Level | Destination                                                           | Mixed | Reason                                                                                                         |
| ------------------------------------------- | --------- | ----- | --------------------------------------------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------- |
| Git Worktree — allowed, with guardrails     | invariant | —     | stays; cleanup steps point at `worktree-parallel-orchestration`       | ⚖     | The guardrails are constraints; the create/remove/prune commands are procedure already owned.                  |
| Clean Working Tree Before Every Commit/Push | invariant | —     | stays                                                                 | ⚖     | State that must hold at two moments; the verification entry point is repo plumbing it names.                   |
| Git Operations                              | invariant | —     | stays                                                                 |       | Approval requirement + commit-message format.                                                                  |
| Commit Cadence                              | invariant | —     | stays                                                                 |       | A constraint on when commits happen; the example chain is illustrative, not a runbook.                         |
| `--delete-branch` is Prohibited             | invariant | —     | stays                                                                 | ⚖     | The ban and the confirm-before-delete precondition are invariants; the do-not-delete-when list is judgement.   |
| Branch Policy                               | invariant | —     | stays                                                                 |       | Protected branches, allowed PR sources, fork-point rule.                                                       |
| One-Branch-At-A-Time Rule                   | invariant | —     | stays                                                                 |       | Constraint plus its two exceptions; the pre-create check is the hook's mechanical floor.                       |
| PR Batching (DX-001)                        | invariant | —     | stays                                                                 |       | Bundling criteria; a sizing constraint, not an ordered procedure.                                              |
| Delete Merged Branches                      | procedure | phase | new sub-orchestration `post-merge-cycle`                              | ⚖     | Verify-ancestry → delete local → delete remote is ordered; "never delete develop/main" stays.                  |
| Merge Landing Verification                  | role      | —     | `merge-verifier` (**existing agent**) — rule keeps only the mandate   | ⚖     | The four checks are exactly the existing agent's judgement criteria; the rule should point, not restate.       |
| Post-Merge Branch Cycle                     | procedure | phase | new sub-orchestration `post-merge-cycle`                              |       | Four ordered steps ending in a base verification — a pipeline phase.                                           |
| Stash hygiene                               | invariant | —     | stays                                                                 |       | Never bare-stash known churn; pop by explicit ref.                                                             |
| Feature Branch Workflow                     | procedure | phase | `branch-guard` promoted from pointer stub to a branch-lifecycle skill |       | Two ordered flows (from `main`, from a release branch) with a user-decision gate.                              |
| Pre-Merge Code-Review Gate                  | procedure | phase | `pr-finding-resolution-loop` (**existing skill**)                     | ⚖     | The four-step sequence and its resolution routing already have an owning pipeline; the mandate and scope stay. |
| Deployment                                  | invariant | —     | stays, but **ownership is questionable** — see §9                     |       | Deployment topology facts; not a git or branch constraint.                                                     |

### 1.3 `spec-workflow.md` — 253 lines, 14 sections

| Section                                          | Class     | Level | Destination                                                                   | Mixed | Reason                                                                                                   |
| ------------------------------------------------ | --------- | ----- | ----------------------------------------------------------------------------- | ----- | -------------------------------------------------------------------------------------------------------- |
| Live Spec Policy                                 | invariant | —     | stays                                                                         |       | Update mandate table + spec-first invariant + drift-is-a-violation.                                      |
| Spec-First Development                           | invariant | —     | stays                                                                         |       | Constraints plus pointers to the skills that carry the procedure.                                        |
| Validated Recommendation Before Approval         | invariant | —     | stays; the three checks point at `proposal-reviewer`                          | ⚖     | The requirement is invariant; reachability/capability/adversarial judgement is agent work.               |
| New-Surface Architecture Placement               | invariant | —     | stays; validation points at the `architecture-audit-fanout` structure channel | ⚖     | Items (1)(2) are criteria the structure auditor applies; (3)(4) are invariants about recording/ordering. |
| User Request Implementation Gate                 | procedure | phase | `user-request-gate` (**existing skill**)                                      | ⚖     | The four-step sequence is already owned by a skill; the allowed/forbidden lists stay.                    |
| HARD GATE: No Immediate Implementation           | procedure | phase | `backlog-pipeline` (**existing skill**)                                       | ⚖     | Five ordered gates whose state machine already lives in `backlog-pipeline`.                              |
| Status levels / Lifecycle folders                | invariant | —     | **single owner needed** — `backlog-pipeline` already holds the table          |       | The same state/folder mapping exists in two places; pick one owner (see §9).                             |
| Spec-Code Conformance Verification               | invariant | —     | stays; loop points at `spec-code-conformance`                                 | ⚖     | Spec-is-truth and contract-test requirements are invariants; the loop is an owned skill.                 |
| ABSOLUTE RULE: Verification does not modify SPEC | invariant | —     | stays                                                                         | ⚖     | The prohibition is invariant; its four-step exception is procedure `spec-code-conformance` owns.         |
| Reverse Spec Verification (Code → Spec)          | invariant | —     | stays                                                                         |       | A refactor without an updated SPEC is incomplete.                                                        |
| Document Authority and Content Placement         | invariant | —     | stays — the canonical ownership table                                         |       | Pure "who owns what"; the design doc names this exactly what a rule is for.                              |
| Structural Architecture Documentation            | invariant | —     | stays                                                                         |       | Which structural docs must be updated, in the same PR.                                                   |
| GATE-CONFORMANCE                                 | invariant | —     | stays; mechanics point at `architecture-conformance-audit`                    | ⚖     | The PASS/FAIL definition is invariant; the mechanical + analytic layers are owned elsewhere.             |
| Cross-Package SPEC Reference Policy              | invariant | —     | stays                                                                         |       | No hardcoded cross-package counts.                                                                       |

### 1.4 `publish.md` — 217 lines, 16 sections

| Section                            | Class     | Level    | Destination                                                     | Mixed | Reason                                                                                                            |
| ---------------------------------- | --------- | -------- | --------------------------------------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------- |
| Release Control Plane              | procedure | phase    | new top-level `release-orchestration`                           | ⚖     | Maintaining a live state artifact is a pipeline duty; the six required fields are a contract that stays.          |
| Release-Run Artifact               | procedure | phase    | new top-level `release-orchestration`                           | ⚖     | Four commands at four moments — ordering is the content; "must pass before publish" stays.                        |
| Release State Machine              | procedure | pipeline | new top-level `release-orchestration`                           |       | Eleven ordered steps with gates — this _is_ the release pipeline.                                                 |
| CI Failure Triage                  | role      | —        | new agent `ci-failure-triager`                                  | ⚖     | Classifying a failure into one of five classes and producing a triage note is judgement.                          |
| Long-Running Gates                 | procedure | phase    | `release-orchestration`; stall judgement → `ci-failure-triager` | ⚖     | Observation cadence is procedure; "is this stalled or just slow?" is a verdict.                                   |
| Dist Artifact Invariant            | invariant | —        | stays                                                           |       | Build once at the root; never per-package CI builds.                                                              |
| Foundation Package Dependency Rule | invariant | —        | stays, but **duplicates** `project-structure.md` — see §9       |       | Dependency direction has a declared SSOT and a mechanical check.                                                  |
| Publish Command (non-negotiable)   | invariant | —        | stays                                                           | ⚖     | The allowed/forbidden command list is invariant; the six-step script description is documentation of a mechanism. |
| pnpm publish only                  | invariant | —        | stays                                                           |       | Wire-format correctness constraint with a runtime guard.                                                          |
| All packages published together    | invariant | —        | stays                                                           |       | No cherry-picking; every package change needs a changeset.                                                        |
| Publish Safety Gate                | invariant | —        | stays                                                           |       | Preconditions to entering the publish flow.                                                                       |
| OTP Protocol                       | procedure | phase    | new sub-orchestration `npm-otp-publish`                         | ⚖     | Ten strictly ordered steps with a hard stop for user input; the forbidden list stays.                             |
| Publish Boundary                   | invariant | —        | stays                                                           |       | Defines where the boundary is and what may cross it.                                                              |
| Publish Scope Approval             | invariant | —        | stays                                                           |       | First publish of a new package needs explicit approval.                                                           |
| Stop Conditions                    | invariant | —        | stays; each becomes a terminate-edge in `release-orchestration` | ⚖     | Conditions are invariants; halting is routing.                                                                    |
| Final release report               | invariant | —        | stays                                                           |       | Required contents of the report artifact.                                                                         |

---

## 2. The other 18 rule files

None of these is a runbook. Three sections carry procedure; the rest are invariants that stay
exactly where they are.

| Rule                          | Section                                     | Class     | Level | Destination                                                         | Reason                                                              |
| ----------------------------- | ------------------------------------------- | --------- | ----- | ------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `index.md`                    | Top-Level Rules table                       | invariant | —     | stays                                                               | Document-ownership map, not pipeline routing (see §9).              |
| `index.md`                    | Process Sub-Rules table                     | invariant | —     | stays                                                               | Same.                                                               |
| `process.md`                  | Pointer stub                                | invariant | —     | stays                                                               | Keeps existing links resolving.                                     |
| `release-operations.md`       | Pointer stub                                | invariant | —     | stays                                                               | Keeps existing links resolving.                                     |
| `api-boundary.md`             | Pointer stub                                | invariant | —     | stays                                                               | Keeps existing links resolving.                                     |
| `agent-conduct.md`            | Precedence                                  | invariant | —     | stays                                                               | The precedence chain itself.                                        |
| `agent-conduct.md`            | Communication & Formatting                  | invariant | —     | stays                                                               | Output constraints (language, tone, formatting discipline).         |
| `agent-conduct.md`            | Accountability, Honesty & Evenhandedness    | invariant | —     | stays                                                               | Behavioural constraints.                                            |
| `agent-conduct.md`            | Feedback → Trial → Rule Promotion           | procedure | phase | `lesson-to-harness` (**existing skill**)                            | Four ordered steps from feedback to a durable rule.                 |
| `agent-conduct.md`            | Epistemic Discipline & Verification         | invariant | —     | stays                                                               | Verify-don't-assume constraints.                                    |
| `agent-conduct.md`            | Safety Posture                              | invariant | —     | stays                                                               | Inherits RCP; declares no local duplication.                        |
| `operational.md`              | No Fallback Policy                          | invariant | —     | stays                                                               | Prohibition with a scan floor.                                      |
| `operational.md`              | Idea Capture Policy                         | invariant | —     | stays                                                               | Where ideas are recorded and when work may start.                   |
| `operational.md`              | Option Proposal Rule                        | invariant | —     | stays                                                               | Required shape of an options presentation.                          |
| `operational.md`              | Feature Documentation Requirement           | invariant | —     | stays                                                               | Four required updates; a feature without them is incomplete.        |
| `operational.md`              | Task/Backlog ID Convention                  | invariant | —     | stays                                                               | Naming contract.                                                    |
| `operational.md`              | Document Size Rule                          | invariant | —     | stays                                                               | Size targets per document class.                                    |
| `operational.md`              | Search / Fetch Discipline                   | invariant | —     | stays                                                               | Tool-use constraints.                                               |
| `operational.md`              | Source Honesty & Tool Priority              | invariant | —     | stays                                                               | Attribution constraints.                                            |
| `operational.md`              | File Handling Discipline                    | invariant | —     | stays                                                               | File-creation constraints.                                          |
| `operational.md`              | API Specification                           | invariant | —     | stays                                                               | External endpoints need a standardized spec.                        |
| `operational.md`              | Process Lifecycle                           | invariant | —     | stays                                                               | Graceful shutdown contract for apps.                                |
| `verification.md`             | Build Requirements                          | invariant | —     | stays                                                               | Build after every source change and after every commit.             |
| `verification.md`             | Browser Verification Requirement            | invariant | —     | stays                                                               | Non-negotiable gate; the "how" is a two-line tool note.             |
| `verification.md`             | Pre-Merge Code-Review Gate (pointer)        | invariant | —     | stays                                                               | Already a pointer to the owning rule.                               |
| `verification.md`             | Pre-Push Local Verification Requirement     | invariant | —     | stays                                                               | Which gate runs when, and what must not be duplicated.              |
| `verification.md`             | Behavioral Verification Before Push         | invariant | —     | stays                                                               | Generic checks are insufficient for runtime-observable change.      |
| `verification.md`             | Headless CLI Verification Requirement       | invariant | —     | stays                                                               | What counts as structured execution proof.                          |
| `verification.md`             | Execution Safety                            | invariant | —     | stays                                                               | Determinism and termination-safety.                                 |
| `verification.md`             | Execution Caching                           | invariant | —     | stays                                                               | Cache-key and staleness constraints.                                |
| `verification.md`             | Harness Direction                           | invariant | —     | stays                                                               | Backward-compatibility constraints on harness changes.              |
| `verification.md`             | Harness Operating Model                     | invariant | —     | stays                                                               | Advisory in dev, blocking at release gates.                         |
| `verification.md`             | Harness Verification Requirement            | procedure | phase | `repo-change-loop` / `post-implementation-checklist` (**existing**) | A four-command ordered run with a blocking gate.                    |
| `common-mistakes.md`          | The 82-entry catalogue                      | invariant | —     | stays                                                               | Numbering is externally referenced and must stay stable.            |
| `documentation-sync.md`       | Documentation Source Map (pointer)          | invariant | —     | stays                                                               | Already delegates to the SSOT.                                      |
| `documentation-sync.md`       | Architecture Map Content Policy             | invariant | —     | stays; removal gate points at `architecture-fixer`                  | Content policy is invariant; re-home-before-delete is agent work.   |
| `documentation-sync.md`       | Document Role Sync Gate                     | invariant | —     | stays                                                               | When each document class must be updated.                           |
| `documentation-sync.md`       | Package Change Documentation Gate           | invariant | —     | stays                                                               | Which files must be inspected per changed package.                  |
| `documentation-sync.md`       | Website Build Gate                          | invariant | —     | stays                                                               | Never publish stale user-facing docs.                               |
| `frontend.md`                 | Framework Selection                         | invariant | —     | stays                                                               | React only.                                                         |
| `frontend.md`                 | Rendering Strategy                          | invariant | —     | stays                                                               | Next.js App Router for SSR.                                         |
| `frontend.md`                 | Static Export                               | invariant | —     | stays                                                               | Prefetch and route-path constraints.                                |
| `frontend.md`                 | Styling                                     | invariant | —     | stays                                                               | Tailwind only.                                                      |
| `frontend.md`                 | App Inventory (pointer)                     | invariant | —     | stays                                                               | Delegates to the SSOT.                                              |
| `frontend.md`                 | Acceptable Exceptions to the Styling Rule   | invariant | —     | stays                                                               | The closed exception list.                                          |
| `frontend.md`                 | Common Mistakes                             | invariant | —     | stays                                                               | Wrong/correct pairs for the above.                                  |
| `code-quality.md`             | Type System (Strict)                        | invariant | —     | stays                                                               | Type prohibitions and SSOT/placement constraints.                   |
| `code-quality.md`             | Import Standards                            | invariant | —     | stays                                                               | Static imports by default.                                          |
| `code-quality.md`             | Development Patterns                        | invariant | —     | stays                                                               | Prohibitions and structural limits.                                 |
| `code-quality.md`             | Layered Assembly (pointer)                  | invariant | —     | stays                                                               | Delegates to the SSOT.                                              |
| `learning-loop.md`            | Lesson Capture                              | invariant | —     | stays                                                               | Already points the "how" at `lesson-to-harness` — the target shape. |
| `learning-loop.md`            | Enforcement Preference                      | invariant | —     | stays                                                               | Two terminal states; mechanise by default.                          |
| `learning-loop.md`            | Pattern Generalization                      | invariant | —     | stays                                                               | Rules must be neutral, not incident-specific.                       |
| `learning-loop.md`            | Contract Before Automation                  | invariant | —     | stays                                                               | No contract → no automation.                                        |
| `enforcement-architecture.md` | The three roles                             | invariant | —     | stays                                                               | The division of labour the whole model rests on.                    |
| `enforcement-architecture.md` | Reliability comes from (verdict + a script) | invariant | —     | stays                                                               | Every guardian needs a mechanical floor.                            |
| `enforcement-architecture.md` | Loop-back is hybrid                         | invariant | —     | stays                                                               | Which loop-back kind applies to which gate kind.                    |
| `enforcement-architecture.md` | Applying it to a new enforced step          | procedure | phase | `capability-extraction` (**existing skill**)                        | Four ordered steps for building a new pipeline.                     |
| `research.md`                 | Research-First Implementation               | invariant | —     | stays                                                               | Research precedes implementation and spec finalisation.             |
| `research.md`                 | Research Deliverables                       | invariant | —     | stays; output contract of `prior-art-researcher`                    | Required contents of the research block.                            |
| `research.md`                 | Recommendation Authority                    | invariant | —     | stays                                                               | When the agent may choose without asking.                           |
| `research.md`                 | Enforcement (default-on, guarded)           | invariant | —     | stays                                                               | Names the worker/guardian/floor triple; already the target shape.   |
| `tdd-and-planning.md`         | Test-Driven Development                     | invariant | —     | stays; RED-proof steps point at `tdd-red-green-refactor`            | The prohibition is invariant; proving RED is an owned procedure.    |
| `tdd-and-planning.md`         | Planning Requirements                       | invariant | —     | stays                                                               | Required plan contents + a scan floor.                              |
| `tdd-and-planning.md`         | Plan Documentation Requirement              | invariant | —     | stays                                                               | The plan document is the SSOT for the plan.                         |
| `naming-style.md`             | Language Policy                             | invariant | —     | stays                                                               | Per-message language matching.                                      |
| `naming-style.md`             | Korean Writing Style                        | invariant | —     | stays                                                               | Style constraints when Korean is requested.                         |
| `naming-style.md`             | Agent Identity                              | invariant | —     | stays                                                               | Prohibited/approved identifiers, with a scan floor.                 |
| `naming-style.md`             | Styling                                     | invariant | —     | stays                                                               | One-line summary pointing at `frontend.md`.                         |
| `testing-layering.md`         | Rules (6 numbered)                          | invariant | —     | stays                                                               | Numbered but every item is a constraint, not a step.                |
| `testing-layering.md`         | Why                                         | invariant | —     | stays                                                               | Rationale for the above.                                            |
| `memory-mirroring.md`         | Principle                                   | invariant | —     | stays                                                               | The absolute mirroring rule.                                        |
| `memory-mirroring.md`         | Why                                         | invariant | —     | stays                                                               | Rationale.                                                          |
| `memory-mirroring.md`         | How to apply                                | invariant | —     | stays                                                               | Reads as five steps but each is a scoping constraint (see §9).      |
| `memory-mirroring.md`         | Scope                                       | invariant | —     | stays                                                               | Applicability and its exclusions.                                   |

---

## 3. Reuse check

Every `role` classification above, checked against the 14 existing agent definitions. **No proposal
duplicates an existing agent.**

| Proposed role                                          | Existing agent covers it?                                           | Decision                                                                                                                                                                                                                     |
| ------------------------------------------------------ | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Merge Landing Verification (`git-branch.md`)           | **Yes — `merge-verifier`**                                          | **Reuse. Create nothing.** The agent already checks PR state, remote-head presence, claimed-change presence, CI green, and per-hop verification. The rule keeps the mandate and points at it.                                |
| Recommendation-gate judgement (`backlog-execution.md`) | **Yes — `proposal-reviewer`**                                       | **Reuse. Create nothing.** Its charter is exactly "is this the right decision, by universal principles + a rule-alignment check", emitting ENDORSE/REVISE/REJECT.                                                            |
| Validated-recommendation checks (`spec-workflow.md`)   | **Yes — `proposal-reviewer` + `architecture-audit-fanout`**         | **Reuse.** Reachability and capability-preservation are distributed architecture judgements synthesized by the refresh; the adversarial pass is the reviewer's charter.                                                      |
| New-surface placement validation (`spec-workflow.md`)  | **Yes — `architecture-audit-fanout` / `proposal-reviewer`**         | **Reuse.** The structure channel checks placement while the reviewer supplies the independent recommendation verdict; phase 2 only removes restated criteria.                                                                |
| Done Gate Stage 1 / Stage 2 (`backlog-execution.md`)   | **Partly — `backlog-gate-guard` exists as a _skill_, not an agent** | **Extract, do not invent.** The role already exists and is already dispatched as a subagent by `backlog-pipeline`; it simply has no `.claude/agents/` file. Promote the skill's judgement criteria into an agent definition. |
| Scenario surface selection (`backlog-execution.md`)    | **No**                                                              | **New agent `user-execution-scenario-author`** (worker; signal e.g. `SCENARIO DRAFTED`). No existing agent authors or judges user-execution scenarios; `backlog-writer` is a skill and writes whole spec documents.          |
| CI failure classification (`publish.md`)               | **No**                                                              | **New agent `ci-failure-triager`** (worker; emits the five-class triage note). `pr-review-reviewer` judges diffs, not CI logs; `merge-verifier` checks that CI was green but never classifies _why_ it was red.              |

**Net new agent files: 3** — `backlog-gate-guard` (extraction of an existing role),
`user-execution-scenario-author`, `ci-failure-triager`. Each must satisfy the `agent-def-convention`
guard and be registered in [`orchestration-map.md`](orchestration-map.md), which the
`orchestration-map` scan enforces.

---

## 4. Skills that inline roles

The work item names three skills that describe reviewer/auditor duties in their own body and
reference no agent file. Here is precisely which role each should dispatch.

### `backlog-pipeline` (165 lines)

**Verdict: it is already correct, and should not be changed.** It is the repo's exemplar
orchestrator — it routes on `PASS | FAIL | NON-COMPLIANCE` and never forms a verdict itself; its
"What This Skill Does NOT Do" section explicitly disclaims judging. What it lacks is a _file_ to
dispatch: it hand-writes a prompt template telling the subagent to read
`.agents/skills/backlog-gate-guard/SKILL.md`.

**Should dispatch:** a new `backlog-gate-guard` **agent definition**, replacing the inline prompt
template. The judgement criteria currently in the `backlog-gate-guard` SKILL (including Done Gate
Stage 1/2 from `backlog-execution.md`) move into that agent file. The skill either becomes a pointer
or disappears.

**This is a fourth instance of the item's defect #2, and the most consequential one** — the repo's
most-used guardian is the one with no agent file. Phase 2 should treat it as in scope even though
the item lists only three skills.

> **RESOLVED across increments 2 and 4.** Increment 2 created `.claude/agents/backlog-gate-guard.md`
> and left the criteria in the skill as a catalogue. Increment 4 finished the job: a catalogue is not a
> skill (nothing invokes it — `backlog-pipeline` passes it as a _data input_), so it moved to
> [`.agents/specs/gate-catalogue.md`](gate-catalogue.md) and the design doc now names **fact catalogue**
> as a fourth artifact kind. The path in the paragraph above is historical.

### `delegated-refactor-green-gate` (56 lines)

Two roles are inlined:

- **The Delegation Contract** ("reach green or report blockers, never commit, leave unstaged, report
  exact evidence") is a **worker charter**. Nearly identical to `architecture-implementer`'s charter
  (minimal verified code change, keep build/tests green, stop-and-report when too risky).
  **Should dispatch:** `architecture-implementer` (existing) for the refactor itself, with the
  green-gate contract folded into that agent's terminal-signal requirements — or, if the mechanical
  refactor genuinely differs from architecture remediation, a `mechanical-refactor-worker` agent.
  **Recommendation: reuse `architecture-implementer` first**; only split if a real conflict appears
  during extraction.
- **"Orchestrator Responsibilities" — treat the green report as a hypothesis and independently
  re-run the gates** is _guardian_ work being asked of the orchestrator, which the design forbids.
  **Should dispatch:** a guardian that re-runs the gates and emits a verdict. `pr-review-reviewer`
  already re-runs tests against a base to judge accidental-green, which is the same shape; the
  cleanest resolution is for this skill to hand the branch to `pr-finding-resolution-loop` rather than
  hand-rolling a verification pass.

What remains of the skill is genuinely pipeline: partition → dispatch → verify → review diff →
commit. That is ~15 lines.

### `dependency-graph-extraction` (48 lines)

**Verdict: the least broken of the three, and arguably already correct.** It is pure mechanical
extraction (read manifests, run two commands, emit output verbatim) and explicitly disclaims
judgement: "Judge whether documents match the graph → that is the `architecture-conformance-auditor`
agent." It already names the consuming agent.

**Should dispatch:** nothing new. Its remaining defect is that it is a _skill_ wrapping three
commands with no branching — it is not a pipeline at all. **Recommendation: fold it into
`architecture-conformance-audit` as step 1**, or into the `architecture-conformance-auditor` agent's
own procedure, and delete the file. Creating an agent for it would be worse than the status quo.

> **RESOLVED in increment 5**, by the recommended path, with the artifact kind now named. Under the
> four-kind test the file was a **fact catalogue**: an enumeration a skill consults (which manifests hold
> the edge set, which commands are the mechanical guards, what their output markers are), stating no
> mandate of its own — delete it and no _force_ is lost, only an enumeration whose force lives in
> `project-structure.md` and in `architecture-conformance-audit`'s own step 1. It did **not** become a
> standalone `.agents/specs/*.md` catalogue: two of its three facts were already duplicated verbatim in
> its only caller, so a new file would have manufactured an artifact _and_ left the duplication standing.
> The one non-duplicated fact (how the workspace-internal edge set is derived) moved into that step and
> the file was deleted. The `INFRA-003` records that count it among "all 5 skills" are archival and were
> deliberately left untouched.

---

## 5. Nesting proposal

The item predicts nested pipelines rather than one flat skill per rule. **Confirmed for two rules,
partially confirmed for one, and refuted for one.**

### 5.1 `publish.md` — **confirmed**, the clearest nesting in the repo

```
release-orchestration                      (NEW top-level skill)  ← Release State Machine 1–11
├─ source-stabilization                    (NEW sub-orchestration) ← steps 1–3
│    ├─ ci-failure-triager                 (NEW agent)             ← CI Failure Triage
│    └─ merge-verifier                     (existing agent)        ← the source→main merge landed
├─ version-bump                            (NEW sub-orchestration) ← steps 4–9
│    └─ version-management                 (existing skill)        ← changesets policy
└─ npm-otp-publish                         (NEW sub-orchestration) ← steps 10–11 + OTP Protocol
     └─ release-run --publish check        (mechanical floor)
```

Three phases, each an ordered pipeline with its own gates and its own failure routing — exactly the
"a phase is itself a pipeline" case the design describes. A single flat skill would be ~27 steps
with three unrelated gate vocabularies.

### 5.2 `git-branch.md` — **partly refuted** (see the increment-3 correction below)

> **Superseded 2026-07-26 by phase 2 increment 3.** Only `post-merge-cycle` was built. The
> `branch-guard` → "branch-lifecycle" promotion and its `branch-creation` phase were **refuted**:
> re-growing `branch-guard` would undo `HARNESS-DIET-005`'s deliberate 144 → 33-line cut to a pointer;
> branch creation is invariants plus a mechanical hook (`.claude/hooks/branch-guard.sh`), not a pipeline;
> and its only genuinely ordered part — the base reset — is `post-merge-cycle`'s own last phase, so a
> `branch-creation` skill would have duplicated it. The `Pre-Merge Code-Review Gate` row was also
> narrowed: only steps 1–2 (wait-for-green, scope the review to the diff) moved to
> `pr-finding-resolution-loop`; the taxonomy, the merge gate, and the scope table are invariants and stayed.
> The tree actually built:
>
> ```
> post-merge-cycle                           (NEW top-level, shared)
>  ├─ merge-verifier                         (existing agent, reused unchanged)
>  ├─ branch deletion                        (step)
>  └─ next-branch base reset                 (step)
> dispatched by: pr-finding-resolution-loop (merge path) + worktree-parallel-orchestration (step 5)
> ```
>
> The original hypothesis is preserved below for the record.

```
branch-guard                               (existing pointer stub → promote to branch-lifecycle)
├─ branch-creation                         (phase)                 ← Feature Branch Workflow,
│                                                                     One-Branch-At-A-Time check,
│                                                                     base verification
├─ pr-finding-resolution-loop              (existing sub-orch)     ← Pre-Merge Code-Review Gate
│    ├─ pr-review-reviewer                 (existing agent)
│    ├─ pr-review-writer                   (existing agent)
│    └─ pr-review-fixer                    (existing agent)
└─ post-merge-cycle                        (NEW sub-orchestration)
     ├─ merge-verifier                     (existing agent)        ← Merge Landing Verification
     ├─ branch deletion                    (step)                  ← Delete Merged Branches
     └─ next-branch base reset             (step)                  ← Post-Merge Branch Cycle
```

Only one new node (`post-merge-cycle`). The rest is wiring existing skills and agents into a tree
that today exists only as prose adjacency inside one 312-line rule.

### 5.3 `backlog-execution.md` — **confirmed**, with one new sub-orchestration and one new agent

```
backlog-execution-orchestrator             (existing top-level skill)
├─ recommendation-gate                     (phase, in the orchestrator)
│    └─ proposal-reviewer                  (existing agent)
├─ user-execution-scenario                 (NEW sub-orchestration)
│    ├─ user-execution-scenario-author     (NEW agent, worker)     ← Scenario Design Preference
│    │                                                                Order + executability decision
│    └─ backlog-gate-guard                 (agent, extracted)      ← Done Gate Stage 1 / Stage 2
├─ implementation                          (routes to owner skills — already present)
├─ multi-backlog-initiative                (NEW sub-orchestration) ← Base Branch Workflow 1–7
└─ backlog-completion                      (phase, in the orchestrator) ← Completion Steps 1–3
```

Note the depth: the scenario phase has a worker _and_ a guardian under it, which is the
worker/guardian/orchestrator triple `enforcement-architecture.md` mandates — currently absent
because the guardian has no file and the worker does not exist.

### 5.4 `spec-workflow.md` — **refuted**

Despite being 253 lines with 17 numbered steps, spec-workflow yields **no new pipeline at all**.
Every procedure in it already has an owning skill:

```
user-request-gate            (existing) ← User Request Implementation Gate
└─ backlog-pipeline          (existing) ← HARD GATE gate sequence + status/folder state machine
     ├─ backlog-writer       (existing skill/worker)
     ├─ prior-art-researcher (existing agent)
     └─ backlog-gate-guard   (guardian — needs the agent-file extraction)
spec-code-conformance        (existing) ← conformance loop + the wrong-SPEC exception steps
architecture-conformance-audit (existing) → architecture-refresh (existing) ← GATE-CONFORMANCE
```

For this rule the refactor is **deletion and pointing, not extraction**: remove the restated
procedure, keep 14 invariant sections, and resolve the two duplications flagged in §9. That is a
genuinely different kind of work from the other three, and worth saying plainly rather than forcing
a new skill into existence to match the prediction.

> **CONFIRMED by increment 4 — the only phase-1 nesting prediction that survived unamended.** Zero new
> skills, zero new agents. But phase 1 was wrong about two structural things _inside_ the refutation:
>
> - It routed § ABSOLUTE RULE's four-step wrong-SPEC exception to `spec-code-conformance`, which
>   **explicitly disclaims spec correction** ("If the spec appears wrong, that is a separate concern
>   handled by other workflows"). The real owner is `spec-writing-standard` **Mode C** (drift recovery).
>   The four steps stayed in the rule (they are the exception's conditions, invariant-shaped) and both
>   documents gained the interlock — Mode C had read as a flat contradiction of the ABSOLUTE RULE
>   ("fix the spec to match the current code") with neither naming the other. § Live Spec Policy pointed
>   at the same wrong skill and now points at Mode C.
> - It missed a duplication entirely: the rule's change→section table and `spec-writing-standard`
>   Mode B Step 1's table are the same mapping, already drifted in wording. Resolved with the rule
>   owning the seven mandate rows and the skill keeping its two authoring-only rows, labelled as such.
>
> § HARD GATE's five-step sequence was also **refuted** as an extraction: its step 1 (Architecture
> review) has no owning skill anywhere, and under "move, never duplicate" content cannot be relocated
> into a destination that does not exist. § User Request Implementation Gate's four-step sequence _was_
> removed, because `user-request-gate` Phases 1–4 already own it end to end. Destination availability,
> not "the items name their owners", is what separates the two.

---

## 6. Routing gaps

Per the design doc, "a step whose failure has no defined routing is an incomplete pipeline." These
procedures do not state what happens when a step fails; **routing must be decided during
extraction**, not inherited.

| Procedure                                     | Rule                   | Gap                                                                                                                                                                                       |
| --------------------------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Release State Machine, steps 1–11             | `publish.md`           | Each step says "proceed only when green" but no step names its failure edge. Failures fall through to a global Stop Conditions list that does not map conditions to steps.                |
| CI Failure Triage                             | `publish.md`           | Defines what the triage note contains but not what happens **after** it — no route for "the fix did not validate", and no bound on re-attempts.                                           |
| Long-Running Gates                            | `publish.md`           | "Stop and triage if a gate exceeds expected behavior" routes into triage, whose own exit is undefined — the gap chains.                                                                   |
| OTP Protocol, step 10                         | `publish.md`           | No routing for a partial publish. The "retry only the missing packages" instruction lives in a different section (Publish Boundary) and is unbounded.                                     |
| Version bump, step 5                          | `publish.md`           | No route when `pnpm install` after a manifest change produces a lockfile diff that fails the diff-hygiene check in step 7.                                                                |
| Done Gate Stage 2 failure                     | `backlog-execution.md` | "The agent must fix the issue or ask for a decision" — the choice between repeat-step and halt-for-user is left to discretion. Under the state-machine model this must be a defined edge. |
| Agent Executability redesign loop             | `backlog-execution.md` | The attempt-an-equivalent-path loop has no iteration bound and no defined exit other than the `manual-only` label.                                                                        |
| Base Branch Workflow, steps 3–5               | `backlog-execution.md` | No route when a child PR's checks fail, and none for the initiative base diverging from `develop` mid-flight.                                                                             |
| Completion Steps                              | `backlog-execution.md` | No route when the `git mv` conflicts or when the status update lands without the move. The `backlog-placement` scan catches the end state after the fact, but the procedure has no edge.  |
| Post-Merge Branch Cycle, step 4               | `git-branch.md`        | "Verify the base" states the check but not what to do when it **fails** (presumably re-cut the branch — currently unstated).                                                              |
| Delete Merged Branches                        | `git-branch.md`        | No route when the `merge-base --is-ancestor` verification fails. The safe edge (do not delete, surface it) is implied but never written.                                                  |
| Merge Landing Verification, steps 1–4         | `git-branch.md`        | No route when a hop's verification fails — no statement of whether to revert, re-merge, or halt.                                                                                          |
| Feature Branch Workflow (release-branch flow) | `git-branch.md`        | Step 3 offers the user options A/B but does not state what happens if the user chooses neither or the merge conflicts.                                                                    |
| Harness Verification Requirement              | `verification.md`      | "If any step fails, fix the issue before proceeding" — no statement of whether the four-command sequence restarts from step 1 after a fix.                                                |

**Counter-example worth preserving:** the Pre-Merge Code-Review Gate (`git-branch.md`) _does_ define
its routing completely — every finding routes to fix / refute / defer, and only an empty set advances
to merge. Phase 2 should use it as the template for the gaps above.

---

## 7. Invariant ledger

Every mandatory statement ("must", "never", "zero exceptions", "prohibited", "process violation") in
the four large rules, so phase 2 can prove no behavioural loss by showing each one's post-change
home. **153 statements.** A statement whose home is "stays" must remain textually in the rule; a
statement pointing at a skill or agent must be _referenced_ from the rule, never duplicated there.

> ⚠️ **SUPERSEDED BY MEASUREMENT (2026-07-26). All four rules were re-derived; the real total is 266,
> not 153.** See [the four-increment reconciliation](#is-this-inventory-trustworthy--the-four-increment-reconciliation-2026-07-26)
> for the per-rule figures and the verdict (regenerate §7; keep §§1–6/§9). The counts below are kept
> for traceability and are lower bounds, not manifests.
>
> ⚠️ **This ledger is known to UNDERCOUNT — audit it against the live rule before each increment.**
> The `publish.md` increment (#1423) found **40** mandatory statements where this ledger listed 39: it
> omitted the `REL-022` invariant that a version-bump PR must carry a _regenerated_ changelog. The
> extraction nearly dropped it, and the loss surfaced only because the increment diffed the rule's
> invariants before/after rather than trusting the list — reading did not catch it.
>
> Treat every section below as a **starting point, not a manifest**. Before extracting a rule, re-derive
> its mandatory statements from the current file on the integration branch (a stale worktree is how the
> `publish.md` gap arose) and reconcile against the ledger. Report any additions found; the counts here
> are provisional until an increment confirms them.

### 7.1 `backlog-execution.md` — 44 invariants (unaudited)

| ID    | Invariant                                                                                                                | Post-change home                                                               |
| ----- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| BE-01 | Agent must form a recommendation with explicit reasoning before acting on agent authority                                | stays                                                                          |
| BE-02 | Agent must document the reasoning inline when acting on agent authority                                                  | stays                                                                          |
| BE-03 | Agent must stop and ask when any of the seven user-judgment conditions holds                                             | stays                                                                          |
| BE-04 | Disclosure in a PR body / commit / backlog note is never approval                                                        | stays                                                                          |
| BE-05 | Never write "사용자 결정 필요" without a concrete recommendation                                                         | stays                                                                          |
| BE-06 | A recommendation must include all seven listed elements                                                                  | stays (document contract)                                                      |
| BE-07 | Stop and ask when the recommendation is weak, conflicts, or needs product judgment                                       | stays; routing edge in the orchestrator                                        |
| BE-08 | Finish one backlog completely before starting the next — zero exceptions                                                 | stays                                                                          |
| BE-09 | The working tree must be clean before creating the PR                                                                    | stays (cross-ref `git-branch.md`)                                              |
| BE-10 | Do not combine unrelated backlogs in one PR                                                                              | stays                                                                          |
| BE-11 | One backlog = one PR by default; splits need named work units, each with its own gate                                    | stays                                                                          |
| BE-12 | Related items serialize; unrelated ship as separate units, still merged in sequence                                      | stays                                                                          |
| BE-13 | A PR description opens with Background and follows the seven ordered sections § PR Unit Rule owns; no agent-session link | stays                                                                          |
| BE-14 | Every backlog changing runnable user-facing behavior carries `## User Execution Test Scenarios` first                    | stays                                                                          |
| BE-15 | Disposable live-verification scripts live in `scratch/src/`, never in `packages/` or `apps/`                             | stays                                                                          |
| BE-16 | A scenario must use a product surface; engineering/governance verification never qualifies                               | stays                                                                          |
| BE-17 | Doc/rule/skill/backlog/governance-only changes mark the gate N/A — do not invent a scenario                              | stays                                                                          |
| BE-18 | A documented-procedure scenario must execute the procedure, not inspect the document                                     | stays                                                                          |
| BE-19 | A user-facing capability is not done until reachable via a product surface AND agent-run verified                        | stays                                                                          |
| BE-20 | The plan must include surface-wiring + agent-run verification from the start                                             | stays                                                                          |
| BE-21 | Capability specs declare the three frontmatter keys; the scan enforces no N/A dodge                                      | stays                                                                          |
| BE-22 | Before writing a scenario the agent must answer "can I execute this via Bash now?"                                       | `user-execution-scenario` skill (routing) + agent criteria                     |
| BE-23 | Writing an unexecutable scenario not labeled `manual-only:` is a process violation                                       | stays                                                                          |
| BE-24 | Each scenario must include all six listed fields                                                                         | stays (document contract)                                                      |
| BE-25 | A missing test environment must be built, proposed, or decided with the user first                                       | stays                                                                          |
| BE-26 | The agent must execute the scenario as a final gate whenever it is available from the workspace                          | stays                                                                          |
| BE-27 | Evidence is mandatory and must be written back into the backlog before completion                                        | stays                                                                          |
| BE-28 | Code-changing evidence must reference durable repo artifacts; retirement needs `evidence-superseded`                     | stays                                                                          |
| BE-29 | `status: done` requires BOTH gate stages — absolute, only the documented exceptions apply                                | stays                                                                          |
| BE-30 | Stage 1: every scenario fully written, or a recorded reason per unwritten scenario                                       | `backlog-gate-guard` agent (criteria) + stays (the mandate)                    |
| BE-31 | Stage 2: all three checkboxes `[x]` — agent-executed, matched, evidence recorded                                         | `backlog-gate-guard` agent (criteria) + stays (the mandate)                    |
| BE-32 | A capability-absence claim is invalid without a recorded probe                                                           | stays                                                                          |
| BE-33 | Engineering verification is NEVER user-execution evidence (authoritative statement)                                      | **stays — must not move** (externally cited)                                   |
| BE-34 | On gate pass, the final response states verification, command/steps, expected result, evidence                           | stays                                                                          |
| BE-35 | Scenario surface preference order 1→2→3; credential-only observables are a design smell                                  | `user-execution-scenario-author` agent                                         |
| BE-36 | Completion: status + `completed:` date, `git mv`, both in ONE commit                                                     | `backlog-execution-orchestrator` (ordering) + stays (the one-commit invariant) |
| BE-37 | Frontmatter `status:` is the only status record; `## Status` body sections are banned                                    | stays                                                                          |
| BE-38 | No terminal-status file in the root; no open-status file in `completed/`; `done` requires `completed:`                   | stays                                                                          |
| BE-39 | `wontfix`, `skipped`, `superseded` are valid terminal statuses                                                           | stays                                                                          |
| BE-40 | Always `git mv`, never `cp` — the root must have no duplicate                                                            | stays                                                                          |
| BE-41 | Initiative flow: base from `develop`, child PR per backlog, final PR to `develop`, never auto-merged                     | `multi-backlog-initiative` (ordering) + stays (never auto-merge)               |
| BE-42 | Backlog implementation must preserve owner boundaries                                                                    | **relocate** to `.agents/project-structure.md`                                 |
| BE-43 | An orchestration skill must stay thin — sequence, gate, record; never duplicate or redefine                              | **relocate** to `enforcement-architecture.md`                                  |
| BE-44 | Each of the eleven stop conditions halts the work                                                                        | stays; terminate-edges in the orchestrator                                     |

### 7.2 `git-branch.md` — 35 invariants (**re-derived 2026-07-26: 84**)

> **The undercount here was the largest of the four rules.** Increment 3 re-derived this rule statement by
> statement against the live file and found **77** mandatory statements, not 35 — and its review round then
> found **7 more, for 84** — of which **26+ have no row below at any granularity** and 16 are subordinate
> clauses folded into a headline row. One of the seven was the single statement the increment was actually
> relocating, which is the sharpest form of the failure: **the statement a ledger is most likely to omit is
> the one the change is about to move.** Re-derive, then re-check the ledger specifically against the diff.
> The pattern
> increment 2 identified is confirmed and is worse in prose-dense sections: § Commit Cadence, § PR
> Batching, § Merge Landing Verification and § Pre-Merge Code-Review Gate each contributed **one** row here
> while carrying 4–6 independent mandates apiece. Examples this table has no row for: "a filling context
> window is not a reason to stop implementing"; `delete_branch_on_merge` is deliberately off; "never run
> `gh pr merge` and the deletion in one blind sequence"; "one conventional commit per logical step within
> the PR"; "no merge — admin or otherwise — before the gate completes"; "never treat `pending` or
> `not-required-skipped` as pass". **Treat every count in §7 as a lower bound, and re-derive before
> extracting.** Increment 3's full 77-row ledger, with each statement's post-change home, is recorded in
> the `HARNESS-049` backlog item.

| ID    | Invariant                                                                                                   | Post-change home                                         |
| ----- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| GB-01 | One working tree per session — never edit or commit another tree from this one                              | stays                                                    |
| GB-02 | Worktrees only in the managed/isolated path, never nested in the tracked tree                               | stays                                                    |
| GB-03 | Each worktree gets its own branch cut from a freshly-fetched `origin/develop`                               | stays                                                    |
| GB-04 | Clean up worktrees when done                                                                                | stays; steps in `worktree-parallel-orchestration`        |
| GB-05 | Every modified/new file must be staged, ignored, or explicitly discarded before commit                      | stays                                                    |
| GB-06 | The working tree must be clean before push                                                                  | stays                                                    |
| GB-07 | Run the CI-equivalent verification entry point on a built tree before pushing or merging                    | stays                                                    |
| GB-08 | No commit or push without explicit user approval                                                            | stays                                                    |
| GB-09 | Conventional commit format, max 72 chars, from the valid type list                                          | stays                                                    |
| GB-10 | Commit at logical boundaries as work progresses; never batch, never defer, never fragment                   | stays                                                    |
| GB-11 | Never pass `--delete-branch` to `gh pr merge` — zero exceptions                                             | stays                                                    |
| GB-12 | Deleting a confirmed-merged branch is the agent's own call and must not be left undone                      | `post-merge-cycle` (ordering) + stays (the mandate)      |
| GB-13 | Do not delete a branch with unmerged commits, one checked out/locked, or an integration/release branch      | stays (judgement checklist)                              |
| GB-14 | Confirm the PR is `MERGED` before deleting a remote branch — zero exceptions                                | stays                                                    |
| GB-15 | `main` is protected; a PR to `main` may only come from `develop` or a release/hotfix branch                 | stays                                                    |
| GB-16 | `develop` is protected; branch first, then PR                                                               | stays                                                    |
| GB-17 | Feature branches come from freshly-fetched `origin/develop`; zero merge commits in the PR range             | stays                                                    |
| GB-18 | Merging `develop` into `main` requires explicit user approval                                               | stays                                                    |
| GB-19 | Always merge back to the fork origin; verify the fork point; never assume `main`                            | stays                                                    |
| GB-20 | A different merge target requires an explicit recommendation and user approval                              | stays                                                    |
| GB-21 | Before creating a branch, check for unmerged branches; if one is open, stop and ask                         | stays; check step in `branch-guard`                      |
| GB-22 | The only exceptions are explicit user instruction or worktree-parallel disjoint-file subagents              | stays                                                    |
| GB-23 | Bundle by coherence AND the soft ceiling; unrelated backlogs stay separate; bundling never waives a gate    | stays                                                    |
| GB-24 | Never delete `develop` or `main`; verify ancestry before remote deletion                                    | stays                                                    |
| GB-25 | A merge must be independently verified as landed on the target's remote head, per hop                       | stays (mandate); criteria → `merge-verifier`             |
| GB-26 | Discard transient churn with a scoped checkout, then pull, branch, and verify the base                      | `post-merge-cycle`                                       |
| GB-27 | Never commit the auto-generated evals lessons; stage explicit paths, not a broad directory add              | stays                                                    |
| GB-28 | Never bare-`git stash` known churn; pop by explicit ref                                                     | stays                                                    |
| GB-29 | Never commit directly to `main` or a release branch; always create a feature branch                         | stays                                                    |
| GB-30 | On a release branch, propose integration option A or B; never merge without proposing                       | stays (mandate); flow → `branch-guard`                   |
| GB-31 | Branch naming is `<type>/<topic>`                                                                           | stays                                                    |
| GB-32 | Every PR the agent opens must pass `/code-review` with all findings resolved before merge — zero exceptions | stays (mandate); sequence → `pr-finding-resolution-loop` |
| GB-33 | A finding is resolved only by fix, written refutation, or a linked deferral — none left silent              | stays                                                    |
| GB-34 | Scope: code-changing PRs; doc-only exempt; mixed PRs in scope                                               | stays                                                    |
| GB-35 | Release-branch changes are not deployed until merged to `main`                                              | stays (ownership questioned — §9)                        |

### 7.3 `spec-workflow.md` — 35 invariants (**re-derived 2026-07-26: 91**)

> **Increment 4 reconciliation — 35 → 91, the largest ratio of the four (2.6×).** Re-derived from the
> live file at the granularity increments 2 and 3 settled on: **one row per independent mandate**, not
> per section topic. The confirmed pattern held again — a section with six independent mandates
> contributed one row. Statements with no row at any granularity include: the User Request gate's
> zero-exception clause ("regardless of how the request is phrased"); "No exceptions. One-line fixes,
> evaluation findings, and 'obvious' improvements all require this gate"; **every enforcement fact** —
> the `.claude/hooks/spec-first-gate.sh` UserPromptSubmit hook, `pnpm harness:conformance`'s exit-code
> contract, and its `deps`-scan trigger that gates every PR and release (increment 3 predicted exactly
> this gap and it was there); the whole four-item "Authority order by question" list; "Document
> authority is determined by path and role, not by a broad word in the filename"; the three named
> structural documents; the package-local `docs/ARCHITECTURE-MAP.md` mandate; three of the five content
> promotion rules; and both follow-on clauses of Cross-Package SPEC Reference Policy.
>
> **Counting convention, stated explicitly because it is this rule's blind spot.** `spec-workflow.md`
> is table-dense where `git-branch.md` was prose-dense, so the convention decides the number. **A table
> counts as ONE statement** — the mandate is "the table binds", and its rows are that mandate's body.
> Counted per-obligation instead, the change→section table (7 rows), the status/folder table (7 rows)
> and the Document Authority table (5 rows × 3 obligation columns) alone would add ~31. The coarse
> convention has a real cost, surfaced by the increment-4 review: **a table-coarse ledger cannot
> register a mandate change that is a table-ROW addition**, which is exactly what this increment
> proposed and then reverted (see the design doc's "no unexamined behavioral GAIN" agreement).

| ID    | Invariant                                                                                                                             | Post-change home                                                              |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| SW-01 | Every PR introducing a listed change MUST update the governing `docs/SPEC.md` in the same PR                                          | stays                                                                         |
| SW-02 | A PR changing package behavior without a SPEC update is an incomplete change                                                          | stays                                                                         |
| SW-03 | Update only the affected sections; never rewrite the whole document                                                                   | stays                                                                         |
| SW-04 | Write the new SPEC section before implementation code; back-filling is a process violation                                            | stays                                                                         |
| SW-05 | Spec drift is a process violation; schedule a dedicated catch-up backlog before continuing                                            | stays                                                                         |
| SW-06 | Contract-boundary changes MUST update or create the governing spec before implementation                                              | stays                                                                         |
| SW-07 | Spec format follows the boundary type                                                                                                 | stays                                                                         |
| SW-08 | Every spec change MUST include a verification test plan                                                                               | stays                                                                         |
| SW-09 | Implementation that does not conform to its governing spec is a bug                                                                   | stays                                                                         |
| SW-10 | New gaps/fixes/improvements are written to `spec-docs/draft/` first, then run the gate pipeline                                       | stays; sequence → `backlog-pipeline`                                          |
| SW-11 | A validated recommendation — not the first coherent design — must precede sign-off                                                    | stays                                                                         |
| SW-12 | Contract-boundary / wide-blast-radius designs must verify reachability, capability preservation, adversarial pass                     | stays (mandate); criteria → `proposal-reviewer` / `architecture-audit-fanout` |
| SW-13 | Record the verification in Architecture Review before GATE-APPROVAL; otherwise a process violation                                    | stays                                                                         |
| SW-14 | A new surface must mirror an analogous existing layer or justify differing, and state its product family                              | stays (mandate); criteria → `architecture-audit-fanout` structure channel     |
| SW-15 | A new surface reuses shared core/contract layers, never a skin on a sibling product                                                   | stays (mandate); criteria → `architecture-audit-fanout` structure channel     |
| SW-16 | Placement must be independently validated and the verdict recorded; a bare "reviewed" claim is insufficient                           | stays                                                                         |
| SW-17 | Placement must be surfaced to the owner FIRST, above styling and scope                                                                | stays                                                                         |
| SW-18 | All four placement items recorded before GATE-APPROVAL; otherwise a process violation                                                 | stays                                                                         |
| SW-19 | Before a spec exists: no `Write`/`Edit` to source files, no new source files, no code generation                                      | stays                                                                         |
| SW-20 | Sequence: explore → draft → pipeline through GATE-APPROVAL → implement                                                                | `user-request-gate` (existing skill)                                          |
| SW-21 | A user waiver must be acknowledged in the response and noted as a process exception                                                   | stays                                                                         |
| SW-22 | Any gap/improvement/fix follows the five-step gate — no exceptions, including one-line fixes                                          | stays (mandate); sequence → `backlog-pipeline`                                |
| SW-23 | GATE-APPROVAL requires an explicit user sign-off quoted in the Evidence Log                                                           | stays                                                                         |
| SW-24 | Each status transition is a gate; every gate leaves an Evidence Log entry                                                             | stays                                                                         |
| SW-25 | Any SPEC/contract change MUST be followed by a conformance verification loop before completion                                        | stays                                                                         |
| SW-26 | The spec is the source of truth: fix code, add a contract test per fix, loop to zero, then regress                                    | stays; loop → `spec-code-conformance`                                         |
| SW-27 | Any code change MUST be preceded by a spec update                                                                                     | stays                                                                         |
| SW-28 | NEVER modify the SPEC to match code during verification; a wrong SPEC is a separate deliberate correction, then verification restarts | stays; the four-step exception → `spec-code-conformance`                      |
| SW-29 | Boundary-affecting refactors MUST be followed by reverse SPEC verification                                                            | stays                                                                         |
| SW-30 | The document-class authority table binds what each class must and must not contain                                                    | stays — canonical                                                             |
| SW-31 | Promote accepted decisions into the owner document in the same PR; never leave contract truth only in README/task/backlog             | stays                                                                         |
| SW-32 | Structural package changes MUST update the structural architecture docs in the same PR                                                | stays                                                                         |
| SW-33 | Do not append subsystem detail to the architecture-map router when a subdocument owns it                                              | stays                                                                         |
| SW-34 | GATE-CONFORMANCE passes only when the mechanical check exits 0 and no unresolved P0 finding remains                                   | stays                                                                         |
| SW-35 | SPEC.md must not hardcode counts or details owned by another package                                                                  | stays                                                                         |

### 7.4 `publish.md` — 39 invariants

| ID    | Invariant                                                                                                   | Post-change home                                     |
| ----- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| PB-01 | Release state must be written and kept current before any release, main merge, bump, or publish             | `release-orchestration` (duty) + stays (the mandate) |
| PB-02 | The state MUST include all six listed fields                                                                | stays (artifact contract)                            |
| PB-03 | Do not begin OTP-sensitive work while the release state is unclear                                          | stays                                                |
| PB-04 | A version-specific release-run file must exist under `.agents/release-runs/`                                | stays                                                |
| PB-05 | Before publish the release-run artifact MUST pass the `--publish` check                                     | stays                                                |
| PB-06 | CI-fix work during release MUST append a structured triage note before code changes                         | stays                                                |
| PB-07 | Release operations run in the stated order unless the user changes the target                               | `release-orchestration`                              |
| PB-08 | Never edit the lockfile manually; run install when manifests change                                         | stays                                                |
| PB-09 | Create the bump branch from latest `origin/main`, not a stale local branch                                  | stays                                                |
| PB-10 | Do not mix unrelated process fixes into a version-bump PR                                                   | stays                                                |
| PB-11 | Before changing code for a failing gate, record the failure class and the validation path                   | stays (mandate); criteria → `ci-failure-triager`     |
| PB-12 | The triage note MUST include all five listed fields                                                         | `ci-failure-triager` (output contract) + stays       |
| PB-13 | Do not patch by inspection when logs exist; do not treat a pending check as failed                          | stays                                                |
| PB-14 | Every wait must have a reason; stop and triage when a gate exceeds expectation for its step                 | `release-orchestration` (routing) + stays            |
| PB-15 | Terminate watchers before switching tasks or after a user interrupt                                         | stays                                                |
| PB-16 | Build once at the root and pass `dist` artifacts to the quality job; never per-package CI builds            | stays                                                |
| PB-17 | `agent-core` MUST NOT depend on any `agent-*` package, transitively included; violation blocks publishing   | stays (duplication flagged — §9)                     |
| PB-18 | Always use the single sanctioned publish command                                                            | stays                                                |
| PB-19 | Never use `--filter`, bare `pnpm publish`, `changeset publish`, or `npm publish`                            | stays                                                |
| PB-20 | No `--tag` flag on publish                                                                                  | stays                                                |
| PB-21 | All publish operations go through `pnpm publish`; the `prepublishOnly` guard is a net, not a substitute     | stays                                                |
| PB-22 | All non-private packages publish together; never cherry-pick                                                | stays                                                |
| PB-23 | Any committed change under a package directory requires a changeset, bump, and publish                      | stays                                                |
| PB-24 | Before the publish flow, the control plane must identify SHA, version, gate, next action, stop condition    | stays                                                |
| PB-25 | Build must pass before dry-run; the agent verifies it, not the script                                       | stays                                                |
| PB-26 | On a package's first publish, remove "not yet published" references from `content/` and `docs/`             | stays                                                |
| PB-27 | Every step of the OTP sequence must complete before the next                                                | `npm-otp-publish`                                    |
| PB-28 | Never ask for OTP before the release-run check passes                                                       | stays                                                |
| PB-29 | Never publish without `--otp`, before receiving it in the current turn, or after running another command    | stays                                                |
| PB-30 | Never ask the user to type the OTP at an interactive prompt                                                 | stays                                                |
| PB-31 | Do not run the auth check as the first step of the flow                                                     | stays                                                |
| PB-32 | Never infer a publish failure from filtered dry-run output; re-run the full unfiltered dry-run              | stays                                                |
| PB-33 | Treat sandbox/network/cache errors as environment failures until confirmed otherwise                        | stays                                                |
| PB-34 | The publish command is the boundary; OTP belongs only after dry-run success inside it                       | stays                                                |
| PB-35 | Publishing must stop before OTP when the release-run is missing, pending, failed, or has uncleared watchers | stays                                                |
| PB-36 | On publish failure, classify first; retry only missing packages through the script; never publish manually  | stays                                                |
| PB-37 | `private: true` packages are never published; a first publish needs explicit user approval                  | stays                                                |
| PB-38 | Each of the six stop conditions halts the release                                                           | stays; terminate-edges in `release-orchestration`    |
| PB-39 | The final release report MUST list merged PRs, version, gates, and skipped/deferred checks                  | stays (artifact contract)                            |

**Ledger summary:** of 153 invariants, **131 stay textually in their rule**, 18 keep their mandate in
the rule while their ordering or criteria move to a named skill or agent, and **4 relocate to a
different owner document** (BE-42 → `project-structure.md`, BE-43 → `enforcement-architecture.md`,
plus the two duplications in §9). **Zero invariants are dropped.** Phase 2 must reproduce this table
with an actual post-change location per row.

---

## 8. Sequencing recommendation

**Extract `publish.md` first.**

The item mandates one rule at a time, so the first increment should be the one with the clearest
boundaries and least cross-referencing. Measured on the tree:

| Rule                   | Skill files referencing it | Enforcement surfaces referencing it (hooks, CI, husky, agent files, scans) |
| ---------------------- | -------------------------- | -------------------------------------------------------------------------- |
| `publish.md`           | **0**                      | **1** (one release-governance scan)                                        |
| `backlog-execution.md` | 3                          | 2                                                                          |
| `spec-workflow.md`     | 9                          | 1                                                                          |
| `git-branch.md`        | 10                         | 8                                                                          |

Four reasons, in order of weight:

1. **It is the only one of the four with zero inbound skill references.** Nothing in
   `.agents/skills/` points at `publish.md`, so extracting it cannot break another skill's anchor.
   `git-branch.md` is the opposite extreme — ten skills, two agent files, two hooks, a CI workflow,
   a husky hook, and two harness scripts all reference it; changing it first means negotiating with
   all of them at once.
2. **Its procedure has no existing owner to negotiate with.** There is no release orchestration skill
   today, so the extraction _creates_ structure instead of reconciling with it. Every other candidate
   must merge into a skill that already exists and already has opinions
   (`backlog-execution-orchestrator`, `branch-guard`, `pr-finding-resolution-loop`, `user-request-gate`,
   `backlog-pipeline`).
3. **It has the highest procedure density and the clearest nesting.** 21 of its 27 numbered steps sit
   in three sections that are unambiguously procedure, and they decompose into three phases that are
   each a pipeline. It is the best available proof that the target shape is real rather than
   theoretical — which matters, because §5.4 shows the shape does _not_ apply everywhere.
4. **Its invariants are unusually crisp.** 39 statements, most of them flat prohibitions with obvious
   post-change homes, which makes the no-behavioural-loss diff cheap to review.

**The honest counter-argument.** Release procedure is the hardest to rehearse: the test-plan item
"dispatch the extracted agent once on a real task and confirm it produces the same verdict" cannot be
fully satisfied without an actual release. The mitigation is that `ci-failure-triager` — the only new
agent the increment introduces — _can_ be dispatched on any real red CI run, which exercises the one
genuinely new role. The OTP and publish phases would ship as extracted-but-unrehearsed procedure, no
worse than their current unrehearsed prose state, but no better verified either.

**If the owner prefers a rehearsable first increment**, the alternative is `spec-workflow.md`: zero
new artifacts, pure deletion-and-point, and every affected skill already exists and is exercised
daily. It is the lowest-risk increment — but per §5.4 it proves nothing about nesting, so it should
be sequenced as a cleanup, not as the demonstration.

**Recommended order:** `publish.md` → `backlog-execution.md` → `git-branch.md` → `spec-workflow.md`.
`backlog-execution` second because it introduces the `backlog-gate-guard` agent extraction that
`spec-workflow`'s cleanup then depends on; `git-branch` third because by then
`pr-finding-resolution-loop` and `post-merge-cycle` are the only unresolved pieces; `spec-workflow` last
because it is mostly deletion and benefits from every earlier increment having settled its
destinations.

---

## 9. Sections that resist clean classification

These are the interesting ones. Each is recorded with its tension rather than forced into a label.

**1. `backlog-execution.md` § Recommendation Gate — the agent judges its own recommendation.**
The section is simultaneously a document contract (the seven required elements), a pipeline phase
(present → judge → proceed or stop), and a _self-judgement_: the agent decides whether its own
recommendation is "coherent with repository rules, layering, architecture, and the backlog intent."
`enforcement-architecture.md` forbids exactly this — a role that both produces and judges. Dispatching
`proposal-reviewer` resolves it cleanly, but that is a **behavioural change**, not a relocation: today
no independent reviewer is required at this gate. Phase 2 must surface it as a decision, not slip it
in as part of the move.

**2. `backlog-execution.md` § Stop Conditions and `publish.md` § Stop Conditions — invariant or
routing?** Under "a pipeline is a state machine", a stop condition _is_ a terminate-edge, which makes
it orchestration content. But each condition is also a standalone constraint that holds whether or
not anyone is running the pipeline. Recorded as `invariant` with the terminate-edge duplicated as
routing in the skill — which is the one place this inventory knowingly proposes the same fact in two
forms. The alternative (routing-only) would silently weaken eleven and six mandatory conditions
respectively. Flagged for an explicit owner decision.

**3. `backlog-execution.md` § One-Backlog-At-A-Time — a sequence that is a definition.** Its four
numbered steps look like a runbook, but they define what "complete" _means_ rather than instructing
how to achieve it. Classified `invariant`. A reasonable reviewer could call it `procedure`; the
deciding factor was that removing the numbers loses no force.

**4. `git-branch.md` § `--delete-branch` is Prohibited — three kinds in one section.** A flat ban
(invariant), a precondition (invariant), a judgement checklist of four don't-delete-when cases
(role-shaped), and shell commands (procedure). The judgement list is genuinely agent criteria, but it
is four bullets and no agent would exist to hold it alone — extracting it would create a file smaller
than its own frontmatter. Kept as `invariant` with the tension recorded. If a
`branch-cleanup` worker ever exists for another reason, this is its criteria.

> **RESOLVED 2026-07-26 (increment 3), on a better reason than file size.** All four conditions are
> **mechanically decidable from observable state**, so they are gate conditions the orchestrator
> (`post-merge-cycle`) evaluates — not a verdict a role forms. The design doc now settles this as a general
> corollary. They stay `invariant`; the door to a future `branch-cleanup` agent is closed, not deferred.

**5. `git-branch.md` § Deployment — right content, wrong document.** Cloudflare Pages behaviour, the
docs-deploy command, and release-branch deploy semantics are deployment topology, not git or branch
policy. It is invariant either way, so nothing is at risk, but its owner should probably be
`.agents/project-structure.md` or a deployment spec. Recorded as an ownership question, not a
classification one.

> **STILL OPEN after increment 3, deliberately.** The relocation was not attempted: the target document was
> outside that increment's file ownership (the BE-42/BE-43 precedent), and the section's literal
> "Cloudflare Pages (blog, docs) deploys automatically when `main` is updated" is quoted as evidence by
> `ARCH-AUDIT-004` and two `.design/architecture-audit/` documents — so a move must be a deliberate change
> that updates them, not a side effect of a git-rule refactor.

> **RESOLVED 2026-07-26 (increment 4) — the relocation is REFUTED; it is a deletion, not a move.**
> Three findings settle it:
>
> 1. [`architecture-map/apps-and-deployment.md`](architecture-map/apps-and-deployment.md) **already
>    owns** bullets 1–2 (Cloudflare Pages auto-deploy from `main` for blog + docs; the manual
>    `deploy-cloudflare-pages.mjs` upload). They are duplication to delete, not content to move.
> 2. Bullets 3–4 ("release-branch changes are not deployed until merged to `main`"; "create a PR from
>    the release branch to `main` and ask the user to merge") are **branch policy** and belong exactly
>    where they are. § Deployment shrinks; it does not relocate.
> 3. All three quoting documents are **archival** — a `completed/` backlog item and two dated
>    architecture-audit records. Rewriting them would falsify the historical record, so the "must update
>    the documents that quote these sentences" instruction in the live rule is itself wrong.
>
> **Reported, not fixed (an actual bug, and the increment-3 note has the stale side backwards):**
> `git-branch.md` and `scripts/docs/deploy-cloudflare-pages.mjs` both target `apps/docs/.vitepress/dist`;
> `apps/docs` has **no `.vitepress` directory** and builds with `next build && pagefind --site out`, so
> `pnpm docs:deploy` cannot succeed. `apps-and-deployment.md` is the correct side. Fixing it means
> editing `scripts/**` and `git-branch.md`, both outside increment 4's ownership.

**6. `spec-workflow.md` § Status levels / Lifecycle folders — duplicated fact, two owners.** The
status vocabulary (`draft → review-ready → … → done`) and the folder mapping appear both here and as
the state-machine table in `backlog-pipeline/SKILL.md`. `AGENTS.md` requires exactly one owner per
fact. The skill's table is richer (it carries next-action and folder-move columns), which argues for
the skill owning it and the rule pointing — but that puts a _fact_ in a skill, which the design's
neutrality section argues against. Genuinely unresolved; flagged for phase 2.

> **RESOLVED 2026-07-26 (increment 4), in the rule's favour — and richness was the wrong tiebreaker.**
> The rule now owns a full status ↔ folder table under
> `spec-workflow.md` > **Spec-Document Status and Lifecycle Folders**; `backlog-pipeline` dropped its
> `Folder` and `Folder move on PASS` columns and **derives** every move ("go to the folder the rule maps
> the NEXT status to; same folder ⇒ no move"), which was verified to resolve all six transitions.
> The skill's copy being richer argued for the skill only if richness settles ownership; it does not —
> the rule absorbed what was missing (`rejected`, and the `in-progress`/`verifying` both-map-to-`active/`
> fact the old arrow-list actively obscured) and the duplication is gone. **Verified before merging:**
> this is a different vocabulary from `backlog-execution.md` > Status Invariants (spec-doc lifecycle vs
> `.agents/tasks/` item placement); they share the tokens `in-progress`/`done` but not their meaning,
> so neither overrides the other, and the rule now says so.
>
> **Reported, not closed:** there is **no mechanical floor** asserting folder ↔ status agreement
> (`check-spec-doc-frontmatter.mjs` validates the status enum only), and six documents in
> `spec-docs/done/` currently violate it (`INFRA-016`, `INFRA-019`, `INFRA-020` at `draft`; `PM-026`,
> `PM-030` at `approved`; `DATA-002` at `in-progress`). Increment 4 therefore kept the pre-existing
> force — NON-COMPLIANCE **on the next gate run** — rather than promoting it to an unenforced
> repo-wide assertion, which would have contradicted `enforcement-architecture.md` in the same PR that
> strengthens it. `scripts/**` is outside the increment's ownership.

**7. `publish.md` § Foundation Package Dependency Rule — a third copy of a dependency rule.**
Dependency direction is owned by `.agents/project-structure.md` and mechanically checked by the
dependency-direction scan. The publish-time restatement adds a _publish-blocking_ consequence the
SSOT does not carry, so it is not pure duplication — but it is close enough that a reader could
change one and miss the other. Recommend keeping only the publish-blocking consequence here and
pointing at the SSOT for the rule itself.

**8. `.agents/rules/index.md` — is a routing table a skill?** The design settles that "the router is
a skill" because routing is procedure. But `index.md` routes _documents_, not pipeline steps — it
answers "which document owns this fact", which is the rule-shaped question. Classified `invariant`.
The design's settled point is about pipeline routing and should probably say so explicitly, since the
word "router" now names two different things in this harness.

**9. `memory-mirroring.md` § How to apply — five numbered items that are not steps.** They read as a
procedure but each is independently a scoping constraint (what counts as durable, what does not,
where a fact belongs). Classified `invariant`. Weak case for `procedure`; nothing changes either way,
which is itself the argument for leaving it alone.

**10. `dependency-graph-extraction` — a skill that is not a pipeline.** It has no branches, no gates,
and no routing: three commands run unconditionally. By the design's definitions it is neither an
orchestration skill (no control flow) nor an agent (no judgement). The honest classification is that
it should not be a standalone artifact at all — see §4. **Resolved in increment 5:** it was a fact
catalogue, folded into `architecture-conformance-audit` step 1 and deleted. This entry is historical.

**11. Rules that should not change at all.** `frontend.md`, `code-quality.md`, `naming-style.md`,
`testing-layering.md`, `memory-mirroring.md`, `common-mistakes.md`, and the three pointer stubs are
already exactly the right shape: pure invariants with pointers to their owners. `learning-loop.md`
and `research.md` are the best existing examples of the target — each states the constraint and names
the skill or agent that carries the procedure. **Phase 2 should not touch any of them.** Maximum
churn is not the goal.

---

## Revision log

| Date       | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-07-26 | Created as `HARNESS-049` phase 1. 142 sections across 22 rule files classified (116 invariant / 21 procedure / 5 role); reuse check against the 14 existing agents; nesting trees for the four large rules; 14 routing gaps; 153-statement invariant ledger; sequencing recommendation.                                                                                                                                                                                                                                                                                                                                                                               |
| 2026-07-26 | Increment 4 reconciliation for `spec-workflow.md` and the **final four-increment verdict**. §5.4's refutation CONFIRMED (zero new skills/agents) with two phase-1 errors inside it corrected; §9.5 (§ Deployment) resolved as a **refutation** — it is duplication to delete plus branch policy that stays, not a relocation; §9.6 (status ↔ folder) resolved in the rule's favour with `backlog-pipeline` deriving every move. §7.3 re-derived **35 → 91** — the largest ratio of the four — and the table-counting convention is now stated. Added the "is this inventory trustworthy?" reconciliation: **classification trustworthy, ledger not — regenerate §7.** |
| 2026-07-26 | Marked the invariant ledger **provisional** after increment 1's measured undercount.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 2026-07-26 | Increment 3 reconciliation for `git-branch.md`. §5.2's tree **partly refuted** — only `post-merge-cycle` was built; the `branch-guard` promotion and its `branch-creation` phase were rejected with reasons. §7.2's ledger re-derived from the live file: **35 → 77** (26 statements had no row at any granularity), the largest undercount of the four rules; §7 counts are now explicitly lower bounds.                                                                                                                                                                                                                                                             |
| 2026-07-26 | Phase 2 increment 1 (`publish.md`, #1423) confirmed the nesting tree and step ranges, added a shared `ci-gate-watch` phase, and **found the invariant ledger undercounts** (40 vs 39 for `publish.md`) — ledger marked provisional, per-increment audit now required.                                                                                                                                                                                                                                                                                                                                                                                                 |
