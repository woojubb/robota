---
status: draft
type: INFRA
tags: [harness, code-review, orchestration, ci, pr]
---

# HARNESS-018 (EPIC): PR-review orchestration (reviewer → writer → fixer, converge → gated merge)

## Problem

When a PR is opened, code review is manual and main-loop-bound: the agent must stop its own work, run
`/code-review`, read findings, fix them, and re-review by hand. There is no orchestrated pipeline that drives
REVIEWER → REVIEW-WRITER → FIXER, loops until findings are resolved, and then takes the gated merge path. The
owner's end goal is for this to run **asynchronously in a background session** so the main loop is not blocked —
but (see Prior Art / Decision) the harness has **no background agent-spawn primitive today**, so that async
firing is a distinct prerequisite (P0). The review→fix→converge→merge _logic_ can and should be built now on the
existing synchronous orchestration shape, then wired to async once P0 exists.

## Prior Art Research

Comparable products, from product documentation (not source):

- **Severity taxonomy.** CodeRabbit uses Critical/Major/Minor; Qodo/PR-Agent emits blocker-first severity ratings.
  **Robota's own `/code-review` does NOT use these** — it classifies findings as **MUST / SHOULD / CONSIDER / NIT**
  (`.agents/skills/package-code-review/SKILL.md`). So the merge gate must be defined on MUST/SHOULD, not on an
  imported Critical/Major vocabulary. [CodeRabbit review overview](https://docs.coderabbit.ai/guides/code-review-overview),
  [Qodo GitHub install](https://qodo-merge-docs.qodo.ai/installation/github/)
- **Re-review oscillation.** Bots re-review on new commits, but that is incremental feedback, not a self-declaring
  "zero findings → merge" loop; GitHub Copilot review is documented to **re-raise already-resolved comments**, so a
  naive "loop until raw count == 0" oscillates — the loop must key on _unresolved_ findings.
  [Copilot code review](https://docs.github.com/en/copilot/how-tos/copilot-on-github/use-copilot-agents/copilot-code-review)
- **Auto-merge-when-clean is declarative.** GitHub native auto-merge merges when required reviews + checks pass;
  Mergify splits entry vs front-of-queue merge conditions and reads branch protection. The mature shape enables
  auto-merge and lets branch protection be the gate.
  [GitHub auto-merge](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/incorporating-changes-from-a-pull-request/automatically-merging-a-pull-request),
  [Mergify queue rules](https://docs.mergify.com/merge-queue/rules/)
- **Security.** A review→fix→merge loop needs write + secrets/keys — the privilege set that makes
  `pull_request_target` running untrusted fork code a "pwn request"; `actions/checkout` v7 refuses fork code under
  it by default (2026-07-16). [Securely using pull_request_target](https://docs.github.com/en/actions/reference/security/securely-using-pull_request_target),
  [Preventing pwn requests](https://securitylab.github.com/resources/github-actions-preventing-pwn-requests/)
- **Loop bounding.** Hard max-iteration cap + progress detection (identify each finding; if it recurs unchanged,
  declare stuck and escalate). [Preventing AI agent infinite loops](https://docs.bswen.com/blog/2026-03-11-prevent-ai-agent-infinite-loops/)

**Constraint for Robota / reuse vs add.** Robota already has: `/code-review` (REVIEWER logic, MUST/SHOULD vocab);
the `architecture-refresh` auto-loop converging on the **existing** `ACTIONABLE FINDINGS: <n>` signal; independent
`merge-verifier` (`MERGE VERIFIED: PASS`); rulesets for merge gating; the worker/guardian/orchestrator rule. The
novel piece is the **FIXER + convergence loop**; its prior art is `architecture-refresh`, not the review bots. **Do
NOT invent a `REVIEW FINDINGS` token** — reuse `ACTIONABLE FINDINGS: <n>` (SSOT; it is already the findings-count
convergence signal). Keep the fixer in the trusted local session (avoid `pull_request_target`). Note: robota's
`.github/workflows/ci.yml` already runs on `pull_request` for main/develop — extend it, do not add a parallel
workflow.

## Architecture Review

### Affected Scope

New review-orchestration skill; a read-only REVIEWER agent (emitting `ACTIONABLE FINDINGS: <n>`, enforced read-only
via agent tool-scope) that runs the `/code-review` logic; a FIXER worker agent; a token-format scan floor; an
extension to the existing `ci.yml` `pull_request` job. A **prerequisite P0** async/background firing mechanism (no
such primitive exists today). Reuses `merge-verifier`, `architecture-refresh` loop shape, `backlog-pipeline`
orchestrator shape. No `packages/`/`apps/` source change.

### Alternatives Considered

1. **Synchronous trusted-session orchestrator now; async firing as prerequisite P0; ci.yml as the check floor (CHOSEN).**
   - ✅ Buildable today on the existing (blocking) `backlog-pipeline`/`architecture-refresh` shape; the privileged
     fixer runs in the trusted local session, avoiding the `pull_request_target` pwn surface; honest about the async gap.
   - ❌ Until P0 lands, the loop runs **synchronously** (blocks the main loop during a review), which is not yet the
     owner's async goal — P0 must follow to deliver it.
2. **GitHub Action with `pull_request_target` running an autonomous fixer in CI.**
   - ✅ Truly server-side/instant, no local host.
   - ❌ Runs untrusted fork diff with secrets + write token = the documented pwn-request; highest-risk for a repo that
     executes AI-agent code. **REJECTED** on security.
3. **Do nothing — keep manual `/code-review`.**
   - ✅ Zero cost.
   - ❌ Review stays hand-driven; the converge-then-merge goal is unmet. REJECTED.

### Architecture Review Checklist

- [x] 영향 패키지/레이어: `.agents/skills/` (orchestrator), `.claude/agents/` (REVIEWER + FIXER), `scripts/harness/` (scan floor), `.github/workflows/ci.yml` (extend). No package/app source.
- [x] Sibling scan 완료 — reuses `architecture-refresh` loop + `ACTIONABLE FINDINGS` signal + `backlog-pipeline` orchestrator + `merge-verifier`; extends `ci.yml` rather than adding a parallel workflow; no new tier.
- [x] 대안 최소 2개 — 3 considered (synchronous-orchestrator + P0-prereq CHOSEN; pull_request_target-fixer REJECTED on pwn; do-nothing REJECTED), each Pro+Con.
- [x] 결정 근거 — security (no pull_request_target), reuse-over-reinvention (ACTIONABLE FINDINGS, /code-review, merge-verifier, ci.yml), honesty about the missing async primitive; **independently validated by a proposal-reviewer GATE-APPROVAL pass — see Evidence Log**.

## Solution

- **REVIEWER (guardian).** A new read-only reviewer agent runs the `/code-review` MUST/SHOULD/CONSIDER/NIT logic and
  ends with the existing `ACTIONABLE FINDINGS: <n>` signal, where `n` = count of **unresolved MUST + SHOULD**
  findings (CONSIDER/NIT are recorded/tracked — not gating, but not silently dropped either). Read-only is enforced by the agent's tool-scope (no Edit/Write), not
  an honor system.
- **REVIEW-WRITER (worker).** Produces a durable artifact: posts the reviewer's findings as a PR review/comment. It
  writes to GitHub — a produce action — and does not re-judge.
- **FIXER (worker).** New `.claude/agents/pr-review-fixer.md` (edit-capable): applies fixes on the PR branch; never
  emits the findings verdict (re-review is the reviewer's job).
- **Orchestrator (new thin skill), synchronous for now.** Route-only: REVIEWER → if `ACTIONABLE FINDINGS: 0` →
  merge path; else → REVIEW-WRITER → FIXER → re-REVIEW. Bounded at **max 3 iterations** + **progress detection**
  (a finding's identity = `file:line + rule/category`; if the same identity recurs unchanged across rounds ⇒ stuck)
  → escalate to the user. Never merges `main`.
- **Merge gate — respects [git-branch.md](../../rules/git-branch.md), does not weaken it.** Merge is allowed only
  when the Pre-Merge Code-Review Gate is satisfied: **no unresolved MUST finding, and every SHOULD finding is fixed
  OR filed-and-linked as a justified backlog item** (never silently deferred). `develop`: gated admin-merge after
  required checks green, then `merge-verifier` (`MERGE VERIFIED: PASS`). `main`: enable auto-merge / mark ready and
  **hand to the user** — the agent never merges `main`.
- **Floor (honest scope).** `scripts/harness/scan-review-findings.mjs` verifies the reviewer output carries a
  well-formed `ACTIONABLE FINDINGS: <n>` line and that the orchestrator's merge step references the MUST/SHOULD gate.
  It checks **presence/format**, not the truthfulness of the count (severity classification is inherent model
  judgment) — stated plainly.
- **P0 prerequisite — async firing.** True background/non-blocking execution on a PR requires a spawn primitive the
  harness lacks. P0 resolves it (a background-agent/Workflow spawn, or a `pull_request`-event dispatch that invokes
  the trusted-session orchestrator) or the epic ships synchronous-only until then.

## Child Issues

| #               | Title                                                                                                     | Priority | Depends on |
| --------------- | --------------------------------------------------------------------------------------------------------- | -------- | ---------- |
| INFRA-018a (P0) | async/background firing primitive for a PR-triggered orchestrator (or confirm synchronous-only)           | High     | —          |
| INFRA-018b (P1) | read-only REVIEWER agent (`/code-review` logic → `ACTIONABLE FINDINGS: n`) + REVIEW-WRITER + FIXER agents | Critical | —          |
| INFRA-018c (P2) | synchronous orchestrator skill: reviewer→writer→fixer loop, max-3 + progress detection                    | Critical | 018b       |
| INFRA-018d (P3) | merge path: MUST/SHOULD gate (per git-branch.md) + develop admin-merge + merge-verifier; main→user        | High     | 018c       |
| INFRA-018e (P4) | scan floor + extend `ci.yml` pull_request check                                                           | Medium   | 018b       |

(Child drafts authored at each predecessor's GATE-COMPLETE.)

## Affected Files

| File                                                                   | Change                                                           |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `.claude/agents/pr-review-reviewer.md` (new)                           | read-only REVIEWER, emits `ACTIONABLE FINDINGS: <n>`             |
| `.claude/agents/pr-review-fixer.md` (new)                              | FIXER worker                                                     |
| `.claude/agents/pr-review-writer.md` (new)                             | REVIEW-WRITER worker — posts the review to the PR                |
| `.agents/skills/pr-review-orchestration/SKILL.md` (new)                | route-only synchronous orchestrator                              |
| `scripts/harness/scan-review-findings.mjs` (new) + `run-all-scans.mjs` | token presence/format floor                                      |
| `.github/workflows/ci.yml`                                             | extend the existing `pull_request` job (no new workflow)         |
| `.agents/skills/index.md`                                              | register orchestrator + the three agents (reviewer/writer/fixer) |

## Completion Criteria

- [ ] TC-01: The orchestrator runs the reviewer→(writer→fixer)→re-review loop synchronously to a terminal state on a fixture PR (async/non-blocking is explicitly OUT of scope until P0 — TC-01 does not assert non-blocking).
- [ ] TC-02: The REVIEWER agent ends with a well-formed `ACTIONABLE FINDINGS: <n>` line; `scan-review-findings.mjs` FAILs a run whose reviewer output omits or malforms it. No new signal token is introduced (`agent-def-convention` still passes).
- [ ] TC-03: With unresolved MUST+SHOULD > 0 the loop drives writer→fixer→re-review; with `ACTIONABLE FINDINGS: 0` it proceeds to the merge path.
- [ ] TC-04: The loop halts and escalates after 3 iterations OR when a finding of identity `file:line+rule` recurs unchanged — verified by a non-converging fixture.
- [ ] TC-05: The merge path allows a `develop` merge only when no unresolved MUST and every SHOULD is fixed-or-linked-backlog AND required checks green, then runs `merge-verifier`; a `main`-targeted PR is NOT merged (handed to the user) — asserting no weakening of git-branch.md's gate.
- [ ] TC-06: REVIEWER is read-only (no Edit/Write in its tool-scope) and FIXER never emits the findings verdict — verified by `agent-def-convention` + a role scan.
- [ ] TC-07: The `pull_request` review check lives in `ci.yml` (extended), uses the plain `pull_request` event (no `pull_request_target`) — verified by grep/scan; no parallel workflow added.

## Test Plan

| TC    | Verification                                                                    | Type/Tool                                                 |
| ----- | ------------------------------------------------------------------------------- | --------------------------------------------------------- |
| TC-01 | fixture PR → synchronous loop reaches terminal state                            | orchestrator fixture                                      |
| TC-02 | reviewer output missing/malformed token → scan FAIL; agent-def-convention green | `scan-review-findings.mjs` + `check-agent-def-convention` |
| TC-03 | findings>0 drives fix loop; ==0 → merge path                                    | orchestrator fixture                                      |
| TC-04 | non-converging fixture (recurring file:line+rule) → halt+escalate at cap        | orchestrator fixture                                      |
| TC-05 | develop merge gated on MUST/SHOULD rule + merge-verifier; main not merged       | merge-path fixture                                        |
| TC-06 | reviewer tool-scope read-only; fixer no-verdict                                 | `agent-def-convention` + role scan                        |
| TC-07 | ci.yml pull_request job, no pull_request_target, no parallel workflow           | grep/scan                                                 |

## Tasks

`.agents/tasks/HARNESS-018*.md` — 미생성 (GATE-APPROVAL 통과 후, 각 child가 active로 승격될 때 생성). Epic split
INFRA-018a..e above.

## Evidence Log

- 2026-07-16 — **GATE-APPROVAL, iteration 1: REVISE** (independent `proposal-reviewer`). Flagged: critical/major/minor
  ≠ `/code-review`'s MUST/SHOULD/CONSIDER/NIT; `REVIEW FINDINGS` not in the closed signal vocab (reuse
  `ACTIONABLE FINDINGS`); no background-spawn primitive exists (async unimplementable as written); convergence gate
  weakened git-branch.md; new workflow redundant with `ci.yml`; missing read-only reviewer agent; TC-04 finding-identity
  undefined; scan over-claimed. **Revisions applied in this draft** (severity→MUST/SHOULD; reuse ACTIONABLE FINDINGS;
  descope to synchronous + P0 async prerequisite; gate aligned to git-branch.md; extend ci.yml; add read-only reviewer
  agent; TC-04 identity defined; scan scoped to presence/format; split into epic INFRA-018a..e). The New-Surface
  Architecture Placement independent-validation requirement is satisfied only by an ENDORSE pass — pending the
  iteration-2 re-review, not pre-declared here.
- 2026-07-16 — **GATE-APPROVAL, iteration 2: RE-REVIEW** (independent `proposal-reviewer`). Confirmed all 8
  iteration-1 fixes RESOLVED; flagged two follow-ups now applied: REVIEW-WRITER given an owning surface
  (`pr-review-writer.md`, added to Affected Files + INFRA-018b) so the route-only orchestrator does not perform the
  PR-comment write; and this Evidence-Log self-certification trimmed. CONSIDER/NIT clarified as tracked-not-dropped.
- 2026-07-16 — **GATE-APPROVAL, iteration 3: ENDORSE** (independent `proposal-reviewer`). Confirmed the REVIEW-WRITER
  owning surface + route-only consistency, the trimmed Evidence-Log claim, and the CONSIDER/NIT clarification; verified
  the load-bearing premises against the repo (ACTIONABLE FINDINGS, merge-verifier, /code-review vocab, ci.yml
  pull_request, git-branch gate). New-Surface placement validated as correct (mirrors architecture-refresh /
  backlog-pipeline / merge-verifier analogs). **GATE-APPROVAL PASSED.** Next: GATE-IMPLEMENT via epic children
  INFRA-018a..e. (One trivial doc-count nit — skills/index.md registration row — fixed here.)
- 2026-07-16 — **GATE-IMPLEMENT (018b + 018c).** Landed the three agents (`pr-review-reviewer` [read-only guardian,
  emits `ACTIONABLE FINDINGS: <n>`], `pr-review-writer` [worker, posts to PR], `pr-review-fixer` [edit-capable worker])
  and the route-only `pr-review-orchestration` skill (synchronous loop, max-3 + progress detection on `file:line+severity`,
  → gated merge path). All conform to `agent-def-convention`; all 51 harness scans pass. Remaining: 018d (merge-gate
  wiring + merge-verifier), 018e (scan floor + ci.yml extension), 018a (async firing, prerequisite for non-blocking).
