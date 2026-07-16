---
status: draft
type: INFRA
tags: [harness, code-review, orchestration, ci, pr]
---

# HARNESS-018: async PR-review orchestration (reviewer → writer → fixer, loop-to-clean → merge)

## Problem

When a PR is opened, code review is a manual, main-loop-blocking step: the agent must stop its own work,
run `/code-review`, read findings, fix them, and re-review by hand. There is no **asynchronous** pipeline that,
on a PR, spawns a background review orchestration and drives review → fix → re-review until findings are clean,
then hands the PR to merge. The owner wants: on a PR, the main agent spawns ONE orchestrator that runs in a
separate/background session (so the main loop is not blocked); inside it three roles run as a pipeline — a
REVIEWER that finds issues (critical/major/minor), a REVIEW-WRITER that records the review, and a FIXER that
applies fixes — looping until findings reach zero, at which point the PR is mergeable. Today none of this is
wired; the review/fix/merge loop is entirely hand-driven.

## Prior Art Research

Comparable products, from product documentation (not source):

- **Severity taxonomy.** CodeRabbit uses 🔴 Critical / 🟠 Major / 🟡 Minor (+ trivial/info); Qodo/PR-Agent emits
  blocker-first severity ratings. Robota's `critical/major/minor` matches the industry norm — no new vocabulary
  needed. [CodeRabbit review overview](https://docs.coderabbit.ai/guides/code-review-overview),
  [Qodo GitHub install](https://qodo-merge-docs.qodo.ai/installation/github/)
- **Re-review vs convergence loop.** Every bot re-reviews on new commits, but that is _incremental feedback on a
  push_, not a self-declaring "zero findings → merge" loop. A documented failure mode (GitHub Copilot code review)
  is that re-review **re-raises already-resolved comments** — so a naive "loop until raw findings == 0" oscillates.
  [Copilot code review](https://docs.github.com/en/copilot/how-tos/copilot-on-github/use-copilot-agents/copilot-code-review)
- **Auto-merge-when-clean is declarative.** GitHub native auto-merge merges when required reviews + required
  checks pass; Mergify splits `queue_conditions` (entry) vs `merge_conditions` (front-of-queue, e.g. CI green +
  approvals) and reads branch-protection/rulesets. The mature shape _enables_ auto-merge and lets branch
  protection be the gate, rather than an actor imperatively merging.
  [GitHub auto-merge](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/incorporating-changes-from-a-pull-request/automatically-merging-a-pull-request),
  [Mergify queue rules](https://docs.mergify.com/merge-queue/rules/)
- **Security caveat.** A review→fix→merge loop needs write access + secrets/model keys — exactly the privilege
  set that makes `pull_request_target` running untrusted fork code a "pwn request". `actions/checkout` v7 now
  refuses fork PR code under `pull_request_target` by default (2026-07-16).
  [Securely using pull_request_target](https://docs.github.com/en/actions/reference/security/securely-using-pull_request_target),
  [Preventing pwn requests](https://securitylab.github.com/resources/github-actions-preventing-pwn-requests/)
- **Loop bounding.** Documented defenses: a hard max-iteration cap, a token/time budget, and progress detection
  (hash each recurring finding; if it repeats _k_ times, declare "stuck" and escalate) rather than infinite loops.
  [Preventing AI agent infinite loops](https://docs.bswen.com/blog/2026-03-11-prevent-ai-agent-infinite-loops/)

**Constraint for Robota / reuse vs add.** Robota already owns the REVIEWER + REVIEW-WRITER halves: the
`/code-review` skill (`package-code-review`) + the cloud "ultrareview"; the `architecture-refresh` auto-loop that
converges on `ACTIONABLE FINDINGS: 0`; independent `proposal-reviewer` / `merge-verifier` agents; merge gating via
rulesets; and the worker/guardian/orchestrator enforcement rule. The novel piece is the **FIXER + convergence loop**;
its real prior art is `architecture-refresh`, not the review bots. **Recommendation:** run the loop in the
**trusted main-agent-spawned background session** (reuse the flat `backlog-pipeline`/`architecture-refresh` shape —
no new tiers), keep GitHub Actions on the plain `pull_request` event as the required-check floor only (never
`pull_request_target` executing fork code); gate merge on **unresolved Critical == 0 AND Major == 0** (Minor fixed
or explicitly refuted/deferred), aligned with git-branch.md's "resolved" definition — not literal raw-count zero;
bound the loop at **max 3 iterations + progress detection**, then escalate (halt-for-user). Merge policy per
git-branch.md: `develop` = gated admin-merge after convergence + `merge-verifier`; **`main` = hand to the user**
(the agent never merges `main`).

## Architecture Review

### Affected Scope

New review-orchestration skill + a FIXER worker agent + a review-findings scan floor + a PR-trigger wiring; a
GitHub Actions `pull_request` check job (floor only). Reuses `package-code-review`, `merge-verifier`,
`proposal-reviewer`, `architecture-refresh` loop shape, `backlog-pipeline` orchestrator shape. No `packages/`/`apps/`
source change.

### Alternatives Considered

1. **Main-agent-spawned background orchestrator; GitHub Actions on `pull_request` as check-floor only (CHOSEN).**
   - ✅ Reuses Robota's agent-orchestration + `/code-review` + merge-verifier; the privileged fixer runs in the
     trusted local session, **avoiding the `pull_request_target` pwn surface entirely**; async (main loop unblocked).
   - ❌ The background session is tied to a running agent host (not a server-side webhook), so a PR opened while no
     agent host is up is reviewed on the next spawn, not instantly.
2. **GitHub Action with `pull_request_target` running an autonomous fixer in CI.**
   - ✅ Truly server-side/instant on every PR, no local host needed.
   - ❌ Runs untrusted fork diff with repo secrets + write token = the documented pwn-request; for a repo that
     builds/executes AI-agent code this is the highest-risk shape. **REJECTED** on security.
3. **Do nothing — keep manual `/code-review`.**
   - ✅ Zero build cost.
   - ❌ Review stays main-loop-blocking and hand-driven; the owner's async converge-then-merge goal is unmet. REJECTED.

### Decision

Adopt (1). Roles map onto [enforcement-architecture.md](../../rules/enforcement-architecture.md): **REVIEWER =
guardian** (judges, emits `REVIEW FINDINGS: <n>`; reuse `/code-review`; must not fix), **FIXER = worker** (applies
fixes; must not judge its own output), **REVIEW-WRITER = thin worker** (records the verdict to the PR), and the
**review orchestrator** routes on the token and loops, does no domain work, and **cannot merge `main`**. Loop-back
is the hybrid completeness shape: auto-re-drive to convergence, bounded (max 3) + progress detection, then
halt-for-user.

### Architecture Review Checklist

- [x] 영향 패키지/레이어: `.agents/skills/` (new orchestrator), `.claude/agents/` (FIXER), `scripts/harness/` (scan floor), `.github/workflows/` (check floor). No package/app source.
- [x] Sibling scan 완료 — reuses the `architecture-refresh` loop shape + `backlog-pipeline` orchestrator + `package-code-review`/`merge-verifier`/`proposal-reviewer`; no new tier invented, no skin-on-a-sibling.
- [x] 대안 최소 2개 — 3 considered (background-orchestrator CHOSEN; pull_request_target-fixer REJECTED on pwn-security; do-nothing REJECTED), each Pro+Con.
- [x] 결정 근거 — security (avoid pull_request_target), reuse-over-reinvention, and the owner's async converge-then-merge goal; independent prior-art research backs the trigger + merge-gate + loop-bound decisions.

## Solution

- **REVIEWER (guardian).** Reuse `/code-review` (`package-code-review`); it must end with a machine token
  `REVIEW FINDINGS: <n>` where `n` = count of **unresolved Critical + Major** (Minor tracked separately). Read-only.
- **REVIEW-WRITER (thin worker).** Posts the reviewer's structured findings as a PR review/comment; records the
  token. No judgment.
- **FIXER (worker).** New `.claude/agents/pr-review-fixer.md` (edit-capable): applies fixes for the reviewer's
  findings on the PR branch; must not judge its own output (re-review is the reviewer's job).
- **Orchestrator (new thin skill).** Route-only: spawn in background on a PR → REVIEWER → if `REVIEW FINDINGS: 0`
  → merge-path; else → REVIEW-WRITER → FIXER → re-REVIEW. Bounded at **max 3 iterations** + progress detection
  (same finding recurring across rounds ⇒ stuck) → escalate to the user. Never merges `main`.
- **Merge path.** `develop`: after convergence + required checks green, gated admin-merge, then `merge-verifier`
  (`MERGE VERIFIED: PASS`). `main`: enable auto-merge / mark ready and **hand to the user** — agent never merges.
- **Floor.** `scripts/harness/scan-review-findings.mjs` verifies the review-findings token contract + that the
  merge gate (Critical == 0 AND Major == 0) is expressed mechanically, not by model prose.

## Affected Files

| File                                                                   | Change                                                                 |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `.agents/skills/pr-review-orchestration/SKILL.md` (new)                | route-only orchestrator                                                |
| `.claude/agents/pr-review-fixer.md` (new)                              | FIXER worker agent                                                     |
| `scripts/harness/scan-review-findings.mjs` (new) + `run-all-scans.mjs` | token/merge-gate floor                                                 |
| `.github/workflows/pr-review-checks.yml` (new)                         | `pull_request` check floor (never `pull_request_target`)               |
| `.agents/skills/index.md`                                              | register orchestrator + FIXER agent                                    |
| `.agents/rules/git-branch.md`                                          | reference the merge-gate rule (Critical/Major == 0; main = user-merge) |

## Completion Criteria

- [ ] TC-01: On a fixture PR, the orchestrator spawns in the background and the main loop is not blocked (returns immediately).
- [ ] TC-02: REVIEWER ends with `REVIEW FINDINGS: <n>`; `scan-review-findings.mjs` FAILs a run whose reviewer output omits the token.
- [ ] TC-03: With unresolved Critical+Major > 0, the orchestrator drives REVIEW-WRITER → FIXER → re-REVIEW; with `REVIEW FINDINGS: 0` it proceeds to the merge path.
- [ ] TC-04: The loop halts and escalates to the user after 3 iterations OR when a finding recurs unchanged (progress detection) — verified by a fixture that never converges.
- [ ] TC-05: The merge path merges `develop` only after Critical == 0 AND Major == 0 AND required checks green, then runs `merge-verifier`; for a `main`-targeted PR it does NOT merge (hands to the user).
- [ ] TC-06: REVIEWER (guardian) and FIXER (worker) are separate definitions — the reviewer never edits, the fixer never emits the findings verdict (verified by `agent-def-convention` + role scan).
- [ ] TC-07: The `pull_request` workflow uses the plain `pull_request` event (no `pull_request_target`) — verified by a scan/grep.

## Test Plan

| TC    | Verification                                                        | Type/Tool                          |
| ----- | ------------------------------------------------------------------- | ---------------------------------- |
| TC-01 | fixture PR → background spawn returns immediately                   | orchestration fixture              |
| TC-02 | reviewer-output-without-token → scan FAIL                           | `scan-review-findings.mjs` fixture |
| TC-03 | findings>0 drives fix loop; ==0 → merge path                        | orchestrator fixture               |
| TC-04 | non-converging fixture → halt+escalate at cap                       | orchestrator fixture               |
| TC-05 | develop merge gated on C==0&&M==0 + merge-verifier; main not merged | merge-path fixture                 |
| TC-06 | reviewer read-only, fixer no-verdict                                | `agent-def-convention` + role scan |
| TC-07 | workflow has no `pull_request_target`                               | scan/grep                          |

## Tasks

`.agents/tasks/HARNESS-018.md` — 미생성 (GATE-APPROVAL 통과 후 생성). May split into: orchestrator + FIXER agent
(P1), findings token + scan floor (P2), merge path + merge-verifier wiring (P3), PR-trigger + workflow floor (P4).

## Evidence Log

_(empty — populated during GATE-VERIFY / GATE-COMPLETE.)_
