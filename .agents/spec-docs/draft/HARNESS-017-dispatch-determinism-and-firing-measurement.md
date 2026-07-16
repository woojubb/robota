---
status: draft
type: INFRA
tags: [harness, routing, measurement, gate-mechanization, self-improvement]
---

# HARNESS-017 (EPIC): self-improving automated dev harness — sense → enforce → improve

## Rule Anchor

Governed by [process.md](../../rules/process.md) (spec-first, gate pipeline), [backlog-execution.md](../../rules/backlog-execution.md)
(orchestration/PR-unit rules) and [harness-governance](../../skills/harness-governance/SKILL.md). Institutionalizes an
independent architecture-auditor + proposal-reviewer finding (2026-07-16) about where real harness performance is capped.

## Problem

Owner north-star: robota must **always run the correct development process inside an automated harness**, and the harness
must **self-improve so it continuously makes robota better** (compounding loop). That requires a control loop —
**SENSE → ENFORCE → IMPROVE** — none of whose three legs is currently closed:

1. **SENSE gap — no firing measurement.** `.agents/evals/metrics.md` tracks only outcomes (One-Shot CI Pass, Human
   Intervention, Tool Diversity, Build Verification); `local-metrics/` has `sessions.jsonl`, `corrections.jsonl`
   (**41/7d**), `reverts.jsonl` (**159/7d**). **Nothing** records which skill was invoked or whether the required gate
   ran for a request class. Any harness change is therefore **unfalsifiable**. `.agents/evals/scenarios/*.md` (4 files)
   have **no runner** — verified: no `scripts/` or `package.json` entry reads `evals/scenarios`.
2. **ENFORCE gap — non-deterministic dispatch.** Only **2 of the 15 request classes** enumerated in Solution below have
   any mechanical dispatch — the `UserPromptSubmit` hooks `.claude/hooks/spec-first-gate.sh` and `correction-detect.sh`
   (verified in `.claude/settings.json`). Both only **inject** a reminder to stdout; neither **blocks**. Every other class
   relies on the model reading prose (`AGENTS.md`, `.agents/skills/index.md`, per-skill `## When to Use`) and choosing
   right → missed-gate / wrong-skill risk.
3. **IMPROVE gap — the compounding loop is open.** `lesson-to-harness` institutionalizes corrections (real, disciplined)
   but is triggered by correction frequency, not by a routing/process-miss detector, and there is no measured feedback
   that a harness change actually reduced misses. The loop does not close on data.
4. **Enforcement bleed — prose-only gates.** The recommendation gate, the product-surface scenario-evidence gate, and
   GATE-APPROVAL-before-first-edit are enforced by prose the model may skip, not by commit/PR-time scripts.
5. **Orchestrator responsibility bleed.** `backlog-execution-orchestrator/SKILL.md:46-65,108-148` **restates verbatim**
   the User-Execution-Scenario contract / PR-body / stop-conditions that `backlog-execution.md` already owns (§124-289,
   §107-122, §385-413), violating that rule's own Orchestration-Skill Rule (:380 "must not duplicate the detailed procedures").

## Architecture Review

### Placement Decision (the primary, owner-visible decision)

**Build the harness control loop by EXTENDING the existing mechanism substrate — `.claude/hooks/` + `scripts/harness/` +
`.agents/evals/` — NOT by adding a router→orchestrator→leaf skill tree.** Reliability comes from mechanical hooks +
measurement; skills are agent-invoked prose, so tree depth adds context cost and indirection with zero new mechanical
guarantee. No new package, no `packages/`/`apps/` change.

### Affected Scope

- **Changed:** `.claude/settings.json` (register classifier hook); `.agents/skills/backlog-execution-orchestrator/SKILL.md`
  (dedup → pointer); `AGENTS.md` (routing → SSOT map); `.agents/evals/metrics.md` (+ routing-correctness metric).
- **New:** `.agents/harness/request-map.json` (routing SSOT); `.claude/hooks/request-classifier.sh` (reads the map);
  `scripts/harness/run-scenarios.mjs` (scenario runner); `scripts/harness/firing-log.mjs` (skill/gate firing detector);
  `.agents/evals/local-metrics/firing.jsonl`; commit/PR-time gate scripts (P4).
- **Not touched:** any `packages/`/`apps/` source; the 49 existing scans; the 58 skills' bodies (except P3's one file).

### Alternatives Considered

1. **Router→orchestrator→leaf "skill org" + `_shared/` core.**
   - ✅ Pro: legible single request→skill map; departmental grouping reads like an org chart; matches the owner's
     "build a company" instinct.
   - ❌ Con (disqualifying): skills are **agent-invoked prose, not auto-firing** (`lesson-to-harness:99`), so a leaf three
     hops below a router fires **no more reliably** than a flat skill — pure reorganization, zero new mechanical guarantee,
     plus higher per-request context cost. Skills are already lean (58 files, avg ~101 lines) so `_shared/` solves a
     non-problem. **REJECTED** by independent architecture-auditor.
2. **Mechanical dispatch + firing measurement + targeted refactors + closed improvement loop (CHOSEN).**
   - ✅ Pro: puts determinism where it can be mechanical (a classifier hook reading a data SSOT); makes performance
     **falsifiable** (firing metric); closes the self-improvement loop on data; refactors only the one orchestrator that
     actually violates route-only.
   - ❌ Con (owned, not hidden): a keyword/signal classifier is **heuristic coverage, not perfect determinism** — it
     inherits the paraphrase/third-language blind spot the Problem indicts; blocking on a false positive is a real UX
     hazard. Mitigation: per-class block-vs-inject policy + P1 measurement proving coverage before tightening. Added hook
     latency on every prompt (bounded, ms).
3. **Do nothing.** ❌ REJECTED — the 159-rework / 41-correction weekly signal stays undiagnosed; north-star unreachable.

### Architecture Review Checklist

- [x] 영향 패키지/레이어: `.claude/hooks/`, `scripts/harness/`, `.agents/evals/`, `.agents/harness/`, one skill + AGENTS.md. No package/app.
- [x] Sibling scan 완료 — mirrors the existing hook/scan/eval mechanism layer (`spec-first-gate.sh`, `run-all-scans.mjs`, `local-metrics/`); no skin-on-a-sibling, no new surface.
- [x] 대안 최소 2개 — 3 considered (skill-org REJECTED w/ independent audit; mechanical CHOSEN; do-nothing REJECTED), each Pro+Con.
- [x] 결정 근거 — determinism must be mechanical + falsifiable; independent architecture-auditor + proposal-reviewer both endorse axis B over A.

## Solution

**The 15 request classes** (TC-3 falsifiability list): 1 impl-new-feature · 2 bug-fix · 3 refactor · 4 spec/backlog-author ·
5 code-review · 6 architecture-refresh/audit · 7 doc-refresh · 8 release/version-bump · 9 publish · 10 deploy ·
11 conformance-audit · 12 capability-extraction/harness-governance · 13 test-authoring · 14 dependency/security-update ·
15 lesson-to-harness/correction.

**Routing SSOT** = `.agents/harness/request-map.json`: `class → { signals[], required_skill, required_gate, mode: block|inject }`.
Consumed by (a) the classifier hook, (b) the scenario runner, (c) AGENTS.md routing. Single source; a bash regex is NOT the SSOT.

- **P1 — SENSE (measurement first, gate-bearing).** `firing-log.mjs` detects actual firing (parse the session transcript /
  Stop-hook for Skill-tool invocations + which scans ran) → `firing.jsonl`. `run-scenarios.mjs` executes
  `evals/scenarios/*.md` (Input → expected class/skill/gate from the SSOT) and **fails on mismatch**. `metrics.md` gains a
  Routing-Correctness + Gate-Firing metric with a captured baseline. **Note:** the runner's mechanical assertion target is
  the classifier output, so a **minimal P2 stub ships with P1** (the SSOT map + a read-only classifier); P1 is not fully
  standalone, and this coupling is intentional and stated.
- **P2 — ENFORCE (dispatch).** Generalize `spec-first-gate.sh` into `request-classifier.sh` reading `request-map.json` for
  all 15 classes. Framed honestly as **raising mechanical coverage on the highest-value gate-bearing classes, proven by
  the P1 metric** — not "closing" routing. Per-class `mode`: gate-bearing classes (spec, approval, release, publish)
  `block`/evidence-check; ambiguous ones `inject`. False-positive cost owned per class.
- **P3 — route-only dedup.** Delete the duplicated policy in `backlog-execution-orchestrator/SKILL.md` and replace with a
  pointer to `backlog-execution.md` (the existing single owner). Not "move to a new owner" — deduplicate against the rule.
- **P4 — mechanize prose gates.** Commit/PR-time checks: recommendation-presented-before-impl; product-surface
  scenario-evidence block present; GATE-APPROVAL quote present before first code commit.
- **P5 — IMPROVE (close the loop).** A periodic detector reads `firing.jsonl` + `reverts.jsonl` + `corrections.jsonl`,
  finds the highest-miss request class / recurring rework, and files a harness-improvement draft via `lesson-to-harness` →
  gate → apply → **re-measure against the P1 baseline**. This is the compounding engine; it ABSORBS the existing
  documentation-refresh / architecture-refresh self-sync loops, not duplicate them.

## Child Issues

| #         | Title                                                                                              | Priority | Effort | Dependencies    |
| --------- | -------------------------------------------------------------------------------------------------- | -------- | ------ | --------------- |
| INFRA-018 | P1 SENSE: firing-log + scenario runner + routing-correctness metric (+ SSOT map + classifier stub) | Critical | ~2d    | none            |
| INFRA-019 | P2 ENFORCE: request-classifier hook, all 15 classes, per-class block/inject                        | High     | ~2d    | 018             |
| INFRA-020 | P3 route-only dedup of backlog-execution-orchestrator                                              | Medium   | ~1d    | none (parallel) |
| INFRA-021 | P4 mechanize 3 prose gates (recommendation / scenario-evidence / approval-before-edit)             | Medium   | ~2d    | 018             |
| INFRA-022 | P5 IMPROVE loop: miss-detector → lesson-to-harness → re-measure                                    | High     | ~2d    | 018,019         |

(Child drafts authored at each predecessor's GATE-COMPLETE; this epic is the parent contract.)

## Dependency Graph

```
INFRA-018 (SENSE) ─┬─> INFRA-019 (ENFORCE) ─┬─> INFRA-022 (IMPROVE loop)
                   └─> INFRA-021 (P4 gates) ─┘
INFRA-020 (P3 dedup) ── independent, can start anytime
```

## Sequencing Rationale

SENSE first: without a routing-correctness baseline, every later phase is unfalsifiable — you cannot prove ENFORCE or the
IMPROVE loop helped. ENFORCE before IMPROVE: the loop needs the classifier's per-class signal to know what missed. P3 is
independent (pure dedup) so it parallelizes.

## Affected Files

| File                                                     | Change                                   |
| -------------------------------------------------------- | ---------------------------------------- |
| `.agents/harness/request-map.json` (new)                 | routing SSOT (P1 stub, P2 full)          |
| `scripts/harness/firing-log.mjs` (new)                   | P1 firing detector                       |
| `scripts/harness/run-scenarios.mjs` (new)                | P1 scenario runner                       |
| `.agents/evals/metrics.md`                               | P1 routing-correctness metric + baseline |
| `.claude/hooks/request-classifier.sh` (new)              | P2 dispatch (reads SSOT)                 |
| `.claude/settings.json`                                  | P2 register hook                         |
| `.agents/skills/backlog-execution-orchestrator/SKILL.md` | P3 dedup → pointer                       |
| `scripts/harness/` + commit/PR hooks                     | P4 three gate checks                     |
| `scripts/harness/harness-improve.mjs` (new)              | P5 miss-detector                         |
| `AGENTS.md`                                              | routing section → request-map.json SSOT  |

## Completion Criteria

- [ ] TC-01: `pnpm harness:scenarios` runs every `evals/scenarios/*.md`, asserts expected class/skill/gate from `request-map.json`, and exits non-zero on mismatch.
- [ ] TC-02: `metrics.md` defines a Routing-Correctness metric and a baseline value is committed; `firing.jsonl` gains one entry per session (verified by a fixture session).
- [ ] TC-03: `request-map.json` enumerates all 15 classes; a fixture request per class fires the mapped gate (asserted by TC-01 runner); gate-bearing classes have `mode: block`/evidence.
- [ ] TC-04: `backlog-execution-orchestrator/SKILL.md` contains no restated `backlog-execution.md` policy — a scan asserts the duplicated headings/phrases are gone and a pointer exists; `backlog-execution.md` remains the single owner.
- [ ] TC-05: each of the 3 prose gates has a commit/PR-time check that exits non-zero when its required artifact (recommendation / scenario-evidence block / approval quote) is absent.
- [ ] TC-06: the P5 detector, run against a seeded `firing.jsonl`, emits a ranked miss list and opens a `lesson-to-harness` draft; a re-measure step compares against the TC-02 baseline.
- [ ] TC-07: no regression — the 49 existing scans + 11 hooks stay green; no skill tree added (per-request context cost unchanged).

## Test Plan

Test strategy: harness-mechanism verification (tooling, not library code) — each TC verified by its own runner/scan plus a no-regression pass.

| TC    | Verification                                           | Type/Tool                         |
| ----- | ------------------------------------------------------ | --------------------------------- |
| TC-01 | scenario runner fails on injected mismatch             | `run-scenarios.mjs` fixture       |
| TC-02 | baseline present; fixture session writes firing entry  | metric diff + `firing.jsonl`      |
| TC-03 | 15-class fixture set each fires mapped gate            | runner over `request-map.json`    |
| TC-04 | duplicated-policy scan on the SKILL                    | new `scan-orchestrator-dedup.mjs` |
| TC-05 | absent-artifact fixtures exit non-zero                 | 3 commit/PR-hook fixtures         |
| TC-06 | seeded firing.jsonl → ranked misses + draft            | `harness-improve.mjs` fixture     |
| TC-07 | full scan+hook suite green; no `_shared/`/router added | `run-all-scans.mjs` + grep        |

## Tasks

`.agents/tasks/INFRA-018.md` … `INFRA-022.md` — 미생성 (GATE-APPROVAL 통과 후, 각 child가 active로 승격될 때 생성).

## Definition of Done

1. All child items (INFRA-018..022) reach GATE-COMPLETE.
2. Routing-Correctness metric shows a measured improvement over the TC-02 baseline (the IMPROVE loop proven, not asserted).
3. AGENTS.md routing points to `request-map.json` as the single SSOT.

## Evidence Log

_(empty — populated during GATE-VERIFY / GATE-COMPLETE with runner output + before/after routing-correctness numbers.)_
