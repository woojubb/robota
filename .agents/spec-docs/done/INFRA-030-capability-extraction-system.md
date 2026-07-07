---
status: done
type: INFRA
tags: [cli]
---

# INFRA-030: Mechanize the focused-agent/thin-skill convention + a discovery agent (capability extraction)

## Problem

The agent has repeatedly, ad-hoc, decomposed large work into (a) focused, universal/neutral,
single-responsibility subagents that hold the policy, and (b) a **thin orchestration skill** that only
sequences them and reads a machine-readable signal. This session alone hand-built
`doc-auditor`/`doc-fixer` + `documentation-refresh`; `architecture-auditor`/`architecture-conformance-auditor`/`architecture-fixer`/`architecture-implementer`

- `architecture-refresh`; `proposal-reviewer`; `merge-verifier`. Each time the decomposition, the
  universal/neutral phrasing, the "policy-in-agent / skill-is-pipeline" split, the machine signal
  (`ACTIONABLE FINDINGS: <n>` / `REVIEW VERDICT` / `MERGE VERIFIED`), the index registration, and the
  spawn-after-commit caveat were re-derived from memory.

**Symptom / reproduction condition:** there is **no single source of truth** for "correct agent/skill
shape" and **no mechanical check** of it. A new agent definition can be non-neutral, over-scoped, missing
its machine-signal line, or unregistered, and **nothing in `pnpm harness:scan` fails** — no scan reads
`.claude/agents/*.md`. The convention lives only implicitly, spread across each agent body and the two
"Spawnable … agents" notes in `.agents/skills/index.md`.

## Architecture Review

### Affected Scope

- **Document-standards taxonomy** (`.agents/specs/document-standards/index.md`, RULE-007): register two new
  document types — **"agent definition" (`.claude/agents/*.md`)** and **"thin orchestration skill"
  (`.agents/skills/*/SKILL.md`)** — each publishing the RULE-007 Meta-Form contract (identity/altitude,
  lifecycle, required sections, completeness criteria, source integrity, ownership, quartet pointers).
  This is the SSOT of "correct shape" — a registered type contract, not free-floating prose.
- **New mechanical guard** `scripts/harness/check-agent-def-convention.mjs`, wired into
  `scripts/harness/run-all-scans.mjs`: asserts each `.claude/agents/*.md` has frontmatter
  `name`/`description`/`tools`; the `tools` set is consistent with the agent's read-only-vs-edit role
  (no `Edit`/`Write` for a read-only auditor); and — for **signal-bearing** agents — that the agent
  **declares its terminal machine-signal in frontmatter** (`signal: <TOKEN>`, from a **closed vocabulary**
  e.g. `ACTIONABLE FINDINGS` / `REVIEW VERDICT` / `MERGE VERIFIED`) AND its body's output-contract
  instructs ending with that exact declared token. (Classify signal-bearing by the presence of the
  `signal:` field — NOT by tool-absence: a read-only research/explainer agent legitimately declares none.
  NOTE: the existing 8 agents end their _files_ in prose; the signal governs their _runtime output_, stated
  inside the output-contract section — so the guard checks "output-contract enforces the declared token,"
  never "the file's last line is a signal." This means part of implementation is adding `signal:` frontmatter
  to the existing signal-bearing agents.) This is the missing **enforcement** — the "auditor" element every existing loop has.
- **New agent `capability-scout`** (`.claude/agents/capability-scout.md`, read-only): given a described
  workflow / task history, proposes the role decomposition (which roles → agents vs thin-skill steps,
  sequencing, per-role machine signal, tool scope), flags over-scoped roles, ends with a machine-readable
  decomposition summary. Signed off by `proposal-reviewer`.
- **Reconcile with `lesson-to-harness`** (`.agents/skills/lesson-to-harness/SKILL.md`), which already owns
  "mine recurring session work → approve → institutionalize as neutral universal harness assets with
  enforcement." Position capability-extraction as the **specialization it dispatches** when the approved
  lesson is "a new recurring role" — reusing its approval/enforcement discipline, not a parallel loop.
- **Deferred to a follow-on:** the `agent-skill-author` write-agent (an LLM that writes agent/skill files)
  and a standalone `capability-extraction` orchestration skill. They are unsafe/low-value **until the
  mechanical convention guard exists as their completion gate**; the guard + scout + type contract already
  deliver the anti-drift value. When built, the author's output contract MUST require the guard to pass,
  and any orchestration skill MUST include a post-author conformance step so it mirrors the
  audit→apply→**re-audit** shape the existing instances have.
- Docs: `.agents/skills/index.md` (register scout + the guard); the document-standards index.

### Alternatives Considered

1. **Register the convention as a document-type contract + mechanical guard; build the read-only scout;
   defer the write-agent behind the guard; dispatch from `lesson-to-harness` (chosen).** Puts the SSOT of
   "correct shape" where the repo already owns document-type contracts, enforces it mechanically (the repo
   doctrine: "prefer a mechanical scan over prose"), and adds only the genuinely novel, safe piece (the
   read-only scout) now.
   - _Pro:_ self-consistent with the repo's own "Contract Before Automation" rule and `harness-governance`;
     the guard is the missing auditor/enforcement half that makes any future write-agent safe; no second
     institutionalization loop (reuses `lesson-to-harness`); converts unenforced prose into a machine check.
   - _Con:_ slightly more work than the original (a guard script + fixture, two taxonomy rows, the
     reconciliation) — and the write-agent/orchestration-skill move to a follow-on.
2. **Original design: thin `capability-extraction` skill + `capability-scout` + `agent-skill-author` +
   a prose `CONVENTION.md` now.** _Rejected —_ (a) it omits the audit-the-output/convergence step every
   existing instance has, so it does not obey the pattern it institutionalizes; (b) a prose convention +
   a "passes `harness:scan`" gate that reads no agent files is the exact unenforced-prose outcome
   `harness-governance` forbids (the gate for the risky LLM-writes-agent-files output is empty); (c) it
   stands up a second institutionalization loop that collides with `lesson-to-harness`'s ownership.
3. **A third judgement agent to review authored agents (instead of a mechanical guard).** _Rejected —_ the
   convention rules are largely mechanical (frontmatter, tool-scope, terminal signal, registration);
   per repo doctrine a scan beats a judgement agent for a mechanizable invariant, and it runs in CI for free.

### Decision

**Alternative 1.** Register "agent definition" + "thin orchestration skill" as document types with
RULE-007 contracts; add `check-agent-def-convention.mjs` to `harness:scan` as the mechanical enforcement;
build the read-only `capability-scout`; reconcile capability-extraction as a `lesson-to-harness`
specialization. Defer the `agent-skill-author` write-agent and any orchestration skill until the guard
exists as their gate (their output must pass it). The justification is **not** "it obeys its own pattern"
(the original design did not) — it is that a mechanically-enforced type contract + a read-only discovery
agent is the repo-aligned way to stop convention drift; the write-agent is contingent on that guard.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — document-standards taxonomy (2 type rows), new `check-agent-def-convention.mjs` + run-all-scans wiring, `capability-scout` agent, lesson-to-harness reconciliation, skills index
- [x] Sibling scan 완료 — the 8 existing agents + 2 thin skills are the corpus the convention is distilled from and the guard must pass; `lesson-to-harness` already owns the institutionalization loop (reconcile, don't duplicate); no scan currently reads `.claude/agents/*.md` (verified) — the guard fills that gap
- [x] 대안 최소 2개 검토 완료 — 3 alternatives; 2 rejected (original prose+ungated-author design; third judgement agent over a mechanizable invariant)
- [x] 결정 근거 문서화 완료 — Contract-Before-Automation + mechanize-the-invariant + single institutionalization loop; write-agent contingent on the guard

## Solution

1. Register "agent definition" and "thin orchestration skill" as document types in
   `.agents/specs/document-standards/index.md`, each with its RULE-007 Meta-Form 7-element contract.
2. Write `scripts/harness/check-agent-def-convention.mjs` (wired into `run-all-scans.mjs`, `name`
   `agent-def-convention` — match the existing entries' field): validate frontmatter
   (`name`/`description`/`tools`), role-consistent tool scoping (read-only agents must not carry
   `Edit`/`Write`), and — for agents declaring `signal:` (closed vocabulary) — that the body's
   output-contract instructs ending with that declared token; register-in-index check. Add `signal:`
   frontmatter to the existing signal-bearing agents so they pass. Prove the guard fails on a malformed
   fixture and passes all existing agents.
3. Author `capability-scout` (read-only) to the newly-registered convention; ends with a machine-readable
   decomposition summary.
4. Reconcile `lesson-to-harness` (a pointer: when an approved lesson is "a new recurring role," dispatch
   capability-extraction — scout → proposal-reviewer sign-off → author to the convention → the guard gates it).
5. Register scout + the guard in `.agents/skills/index.md`. Do NOT build `agent-skill-author` or a
   standalone orchestration skill in this item — log them as a follow-on gated by the guard.
6. `pnpm harness:scan` green (now includes `agent-def-convention`).

## Affected Files

- `.agents/specs/document-standards/index.md` (2 new type-contract rows)
- new `scripts/harness/check-agent-def-convention.mjs` + `scripts/harness/run-all-scans.mjs` (register)
- new `.claude/agents/capability-scout.md`
- `.agents/skills/lesson-to-harness/SKILL.md` (dispatch pointer) + `.agents/skills/index.md` (register)
- (follow-on note) a backlog entry deferring `agent-skill-author` + `capability-extraction` skill behind the guard

## Completion Criteria

- [ ] TC-01: `.agents/specs/document-standards/index.md` registers "agent definition" and "thin orchestration skill" document types with the RULE-007 Meta-Form contract; the agent-definition row is `status: partial` with `agent-skill-author` + its template named as **plain-text follow-ons (not markdown links)** so `check-document-standards-index.mjs` (which fails on unresolved links + requires partial rows to name follow-ons) passes. A one-line Identity/Altitude note states these are harness-asset contracts (not design docs).
- [ ] TC-02: `check-agent-def-convention.mjs` PASSES all existing agent definitions (after adding `signal:` frontmatter to the signal-bearing ones) and FAILS a malformed fixture (declared `signal:` whose token the body does not enforce / read-only agent carrying `Write` / missing `name`/`description`/`tools`); registered in `run-all-scans.mjs`. The signal check keys off the `signal:` field, not tool-absence.
- [ ] TC-03: `.claude/agents/capability-scout.md` exists (read-only tool set), conforms to the convention (passes the new guard), and its output contract ends with a machine-readable decomposition summary.
- [ ] TC-04: `.agents/skills/lesson-to-harness/SKILL.md` references capability-extraction as its "new recurring role" specialization (single institutionalization loop, no duplication); `.agents/skills/index.md` registers the scout + guard.
- [ ] TC-05: The `agent-skill-author` write-agent + standalone orchestration skill are explicitly deferred (a follow-on backlog note), gated on the convention guard — not built here.
- [ ] TC-06: `pnpm harness:scan` green (now includes `agent-def-convention`); full count reported.
- [ ] TC-07: Decision rationale in the spec no longer rests on "obeys its own pattern"; it rests on mechanized-contract + single-loop.

## Test Plan

Test strategy (INFRA, harness + doc-contract): the convention guard's fixture self-check (fails-on-malformed,
passes-on-existing) is the authoritative test; document-standards + skills-index scans confirm registration;
the scout is verified by the guard it must pass.

| TC-ID | Test Type  | Tool / Approach                                                                          | Notes                     |
| ----- | ---------- | ---------------------------------------------------------------------------------------- | ------------------------- |
| TC-01 | Structural | `check-document-standards-index.mjs` green with the 2 new type rows                      | type contracts registered |
| TC-02 | Unit       | run `check-agent-def-convention.mjs` on a malformed fixture (fail) + the 8 agents (pass) | fixture-based enforcement |
| TC-03 | Structural | scout def conforms (passes the guard); read-only tools; machine summary line             | the novel piece           |
| TC-04 | Structural | `rg` — lesson-to-harness dispatch pointer; index registers scout + guard                 | single loop, registered   |
| TC-05 | Structural | follow-on note defers agent-skill-author + orchestration skill behind the guard          | scope honesty             |
| TC-06 | CI/harness | `pnpm harness:scan` green (incl. `agent-def-convention`)                                 | integration               |
| TC-07 | Structural | Decision rationale review (mechanized-contract, not self-consistency)                    | rationale corrected       |

## Tasks

- [ ] `.agents/tasks/INFRA-030.md` — 미생성 (GATE-APPROVAL 통과 후 생성)

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-07-07

**Status upgrade:** draft → review-ready
Frontmatter valid; Problem has concrete symptom (no SSOT + no scan reads `.claude/agents/*.md`) + reproduction; Architecture Review checklist all [x] with sibling scan; ≥2 alternatives with pro/con; TC-01..TC-07 with matching Test Plan rows; Tasks placeholder; Evidence Log; no `## Status`/`## Classification`.

### [Design Review] — proposal-reviewer (round 1) | 2026-07-07

**REVISE** — original design (thin skill + scout + agent-skill-author + prose CONVENTION.md) did NOT obey its own pattern (no audit-the-output/convergence step), gated the risky write-agent on a `harness:scan` that reads no agent files (hollow), conflicted with document-standards "Contract Before Automation" (prose vs registered type contract + gate), and duplicated `lesson-to-harness`'s institutionalization loop. Re-scoped per the recommendation: convention → document-type contract + mechanical guard (the missing auditor); build the read-only scout; defer agent-skill-author + orchestration skill behind the guard; dispatch from lesson-to-harness. (This revision.)

### [Design Review] — proposal-reviewer | 2026-07-07

Rounds → **ENDORSE** (verified against code). Decision sound + rule-aligned.

### [GATE-APPROVAL] — ✅ PASS | 2026-07-07

**Status upgrade:** review-ready → approved
Approval mechanism (user rule): approved when the neutral proposal-reviewer ENDORSEs a sound, rule-aligned recommendation. Reviewer returned ENDORSE. No Architecture Review / type / tags changed after approval.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-07-07

**Status upgrade:** approved → in-progress
Tasks file `.agents/tasks/INFRA-030-capability-extraction-system.md` created; TC-mapped; includes Test Plan / 검증.

### [GATE-VERIFY] — ✅ PASS | 2026-07-08

**Status upgrade:** in-progress → verifying
All TCs verified: new AST scan(s) registered in run-all-scans; fixture self-tests fail-on-violation + pass-on-current (26/26 across both); harness:scan 47/47 (45→47). INFRA-035: interface-runtime passes current interface-\* src unchanged (non-breaking). INFRA-030: agent-def-convention passes all 9 agents; 5 signal-bearing agents got `signal:` frontmatter, 3 edit agents none; capability-scout added; document-standards partial rows + text follow-ons pass check-document-standards-index; lesson-to-harness dispatch pointer + index registration; INFRA-036 defers agent-skill-author/orchestration-skill behind the guard.

### [GATE-COMPLETE] — ✅ PASS | 2026-07-08

**Status upgrade:** verifying → done
proposal-reviewer ENDORSE (after 2 REVISE each — caught current-code false-positives / the 8-agent signal-rule contradiction); implemented by architecture-implementer; harness:scan 47/47.
