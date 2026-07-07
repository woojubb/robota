---
status: done
type: INFRA
tags: [cli]
---

# INFRA-036: agent-skill-author write-agent + standalone capability-extraction orchestration skill

## Problem

INFRA-030 mechanized the agent/thin-skill convention as a document-type contract
(`.agents/specs/document-standards/index.md`) plus a mechanical guard
(`scripts/harness/check-agent-def-convention.mjs`, `harness:scan` → `agent-def-convention`), and built the
read-only `capability-scout`. It intentionally **deferred** two pieces:

1. **`agent-skill-author`** — an LLM write-agent that authors agent/skill files from an approved
   `capability-scout` decomposition.
2. **A standalone `capability-extraction` orchestration skill** — a thin pipeline sequencing
   scout → proposal-reviewer → author → guard.

These were deferred because an LLM-writes-agent-files output is only safe once its **completion gate**
(the convention guard) exists. INFRA-030 delivered that guard; these follow-ons are now unblocked.

Currently the loop from "discovered role" → "authored agent/skill file" is **manual** (the main loop hand-writes
each `.claude/agents/*.md`). There is no reusable, gated write-path, and the "Agent definition" document-type
row in `document-standards/index.md` sits at `partial` because no author/template pair backs it.

## Why deferred (not dropped)

- The guard + scout + registered type contract already deliver the anti-drift value; the write-agent is
  additive automation, not a correctness gap.
- The write-agent's output contract MUST require `agent-def-convention` to pass on its emitted files, and the
  orchestration skill MUST include a post-author **re-audit** step so it mirrors the audit→apply→re-audit
  shape the existing loops (`architecture-refresh`, `documentation-refresh`) have. Capability-extraction
  remains a **specialization dispatched by `lesson-to-harness`**, not a parallel institutionalization loop.

## Architecture Review

### Affected Scope

- `.claude/agents/agent-skill-author.md` (NEW) — edit-capable (Read/Grep/Glob/Edit/Write) write-agent. Given an
  ENDORSE'd `capability-scout` DECOMPOSITION, it authors/edits the specified `.claude/agents/*.md` and/or thin
  `.agents/skills/*/SKILL.md` files to match the decomposition. Its **output contract requires
  `agent-def-convention` to pass** on every emitted/edited agent file, and index registration
  (`.agents/skills/index.md` / document-standards row) to be updated. It does NOT invent roles beyond the
  decomposition and does NOT self-approve — it consumes an already-reviewed decomposition. **It declares no
  `signal:` frontmatter field**, so the INFRA-030 guard's signal check does not apply — the guard classifies
  signal-bearing agents by the _presence of a `signal:` field, never by tool presence/absence_ (see
  `check-agent-def-convention.mjs` header). This matches `architecture-implementer`/`architecture-fixer`, which
  carry Edit/Write and declare no signal. It correctly emits no terminal machine-signal because the pipeline's
  convergence is read from the terminal `agent-def-convention` re-audit's PASS/FAIL (the analogue of
  `architecture-refresh` reading `ACTIONABLE FINDINGS`), not from the author.
- `.agents/skills/capability-extraction/SKILL.md` (NEW) — thin, pipeline-only orchestration skill:
  `capability-scout` (decompose) → `proposal-reviewer` (ENDORSE gate) → `agent-skill-author` (write) →
  `agent-def-convention` guard (re-audit) → stop on convergence. Registered in `.agents/skills/index.md`.
  Dispatched **from `lesson-to-harness`** (existing dispatch pointer), not a standalone institutionalization loop.
- `.agents/specs/document-standards/index.md` — flip the "Agent definition" document-type row from `partial`
  to `defined`, made **honest** (per review): the row's quartet resolves to {form/template = the
  `agent-def-convention` guard + the existing exemplar agent files as the machine-enforced shape; authoring
  skill = `capability-extraction` (which dispatches `agent-skill-author`); gate = `agent-def-convention`;
  location = `.claude/agents/`}. INFRA-030 originally named a separate prose "agent-definition template" as a
  second deferred follow-on; this spec **retracts that follow-on** on the ground that a machine-checked shape
  (the guard) is a stronger enforced form than a prose template — and rewrites the follow-on cell + status-note
  in the SAME change so a `defined` row is never left describing a deferred follow-on.

### Alternatives Considered

1. **Keep hand-authoring agents/skills (current state).**
   - Con: no reusable gated write-path; each new agent is bespoke and un-orchestrated; the `partial`
     document-type row never closes. Rejected — INFRA-030 explicitly scheduled this follow-on (TC-05).
2. **Build only the `agent-skill-author` write-agent, skip the orchestration skill.**
   - Pro: smaller. Con: without the thin skill the scout→review→author→guard sequence stays implicit in the
     main loop, so the "mirror audit→apply→re-audit" obligation from INFRA-030 is unmet; the write-agent would
     be invoked ad-hoc with no enforced re-audit step.
3. **Build both the write-agent and the thin capability-extraction skill (author gated on the guard;
   skill enforces scout→review→author→re-audit), dispatched by `lesson-to-harness`.**
   - Pro: closes the deferral exactly as INFRA-030 specified; the author's output is gated; the skill enforces
     the re-audit; ownership stays with `lesson-to-harness` (no parallel loop). Chosen.

### Decision

**Alternative 3.** Author + thin skill, with four hard invariants: (a) the author's output contract requires
`agent-def-convention` green on emitted files; (b) the skill is pipeline-only (no policy — policy lives in the
scout/reviewer/author/guard) and includes a terminal re-audit; (c) capability-extraction is dispatched by
`lesson-to-harness`, not institutionalized as a separate always-on loop; (d) the author declares **no `signal:`
field** and convergence is read from the terminal `agent-def-convention` re-audit — the guard classifies signals
by the `signal:` field's presence, never by tool presence. Flip the "Agent definition" document-type row to
`defined` **and** retract INFRA-030's separate prose-template follow-on in the same change (the machine-checked
guard is the enforced form), so the row is honest.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — `.claude/agents/`, `.agents/skills/`, `document-standards/index.md`
- [x] Sibling scan 완료 — mirrors `architecture-refresh`/`documentation-refresh` (audit→apply→re-audit),
      `capability-scout`/`proposal-reviewer`/`architecture-implementer` agent patterns, INFRA-030 guard
- [x] 대안 최소 2개 검토 완료 — 3개(hand-author / author-only / author+skill)
- [x] 결정 근거 문서화 완료 — author gated on guard + thin re-audit skill + lesson-to-harness dispatch

## Solution

1. Author `.claude/agents/agent-skill-author.md` — role: turn an ENDORSE'd DECOMPOSITION into agent/skill
   files. Frontmatter: name, description, tools (Read/Grep/Glob/Edit/Write). Body states: consumes a reviewed
   decomposition; authors/edits only the named files; updates index/document-standards registration; **its
   emitted files MUST pass `agent-def-convention`**; stops-and-reports if the decomposition is ambiguous or a
   target already exists with a conflicting role. No fabricated scope; no self-approval.
2. Author `.agents/skills/capability-extraction/SKILL.md` — thin pipeline: scout → proposal-reviewer (require
   `REVIEW VERDICT: ENDORSE`) → agent-skill-author → `agent-def-convention` re-audit → converge. Policy-free.
   Register in `.agents/skills/index.md`; add a dispatch pointer from `lesson-to-harness`.
3. Flip the "Agent definition" row in `document-standards/index.md` from `partial` to `defined`, resolving the
   quartet {form = `agent-def-convention` guard + exemplar agent files; authoring skill = `capability-extraction`;
   gate = `agent-def-convention`; location = `.claude/agents/`}. In the **same edit**, retract the separate
   prose "agent-definition template" follow-on INFRA-030 listed (the machine-checked shape supersedes it) and
   rewrite that follow-on cell + the row's status-note so a `defined` row never describes a deferred follow-on.

## Affected Files

- `.claude/agents/agent-skill-author.md` (NEW)
- `.agents/skills/capability-extraction/SKILL.md` (NEW)
- `.agents/skills/index.md` (register capability-extraction)
- `.agents/skills/lesson-to-harness/SKILL.md` (dispatch pointer to capability-extraction)
- `.agents/specs/document-standards/index.md` ("Agent definition" row partial → defined)

## Completion Criteria

- [ ] TC-01: `agent-skill-author.md` exists and passes `agent-def-convention` — frontmatter valid, Edit/Write
      scope declared, and **no `signal:` field declared** (so the guard's signal check does not apply, as with
      `architecture-implementer`); its body states the guard-green output contract and reads convergence from
      the terminal re-audit.
- [ ] TC-02: `capability-extraction/SKILL.md` exists, is pipeline-only (no policy statements), sequences
      scout → proposal-reviewer → author → guard, and includes a terminal re-audit.
- [ ] TC-03: `capability-extraction` registered in `.agents/skills/index.md`; `lesson-to-harness` dispatches to it.
- [ ] TC-04: document-standards "Agent definition" row reads `defined`, its quartet resolves to existing files,
      AND the separate prose-template follow-on is retracted in the same change (no `defined` row left pointing
      at a deferred follow-on; status-note consistent).
- [ ] TC-05: `pnpm harness:scan` exit 0 (including `agent-def-convention` and `check-document-standards-index`).

## Test Plan

Mechanical guards carry verification — no new runtime code, so the gates are the existing harness scans:

- `agent-def-convention` validates the new `agent-skill-author.md` (frontmatter, tool scope, index registration);
  because it declares no `signal:` field, the guard's signal check does not apply (signal is keyed off the
  `signal:` field, never tool presence).
- `check-document-standards-index` validates the flipped row still points at existing files (no ghost pointer)
  and that the retracted follow-on leaves no dangling reference.
- Thin-skill contract: `capability-extraction/SKILL.md` contains only pipeline sequencing, no policy — verified
  by reading against the INFRA-030 thin-orchestration-skill document-type contract.
- `pnpm harness:scan` full green. This is a harness/agent-definition change; the "test" is the guard suite
  accepting the emitted files, mirroring how INFRA-030's own agents were validated.

## Tasks

- [ ] 미생성 — draft. GATE-WRITE 승격 시 상세화.

## Notes

Tracked per INFRA-030 TC-05. The convention guard (`agent-def-convention`) is now the completion gate, so this
is unblocked.

## Evidence Log

- 2026-07-08 GATE-APPROVAL round 1 — proposal-reviewer REVISE. Direction (Alt 3) correct, but two justifications
  wrong: (A) signal-classification claimed tool-presence keying (guard actually keys off the `signal:` field) —
  corrected + added the "convergence read from terminal re-audit" rationale; (B) `partial → defined` flip was
  dishonest (template quartet element unbuilt, follow-on still listed) — made honest by retracting the prose-
  template follow-on (guard supersedes) and rewriting the follow-on cell + status-note in the same change.
  Reviewer confirmed P1–P4 (guard exists+wired, mirrors refresh loops, lesson-to-harness dispatch pre-wired,
  non-duplicative of capability-scout/architecture-implementer). Both fixes reflected above.
- 2026-07-08 GATE-APPROVAL round 2 — proposal-reviewer **ENDORSE**. Both defects resolved (signal mechanism now
  matches `check-agent-def-convention.mjs` hasOwnProperty(signal) keying; `defined` flip honest via retracted
  prose-template follow-on, precedent = ADR row "(template in skill)"). Rule alignment full. 승인 → 구현 착수.
- 2026-07-08 GATE-IMPLEMENT/VERIFY/COMPLETE — Authored `.claude/agents/agent-skill-author.md` (edit-agent, no
  `signal:` field, guard-green output contract) + `.agents/skills/capability-extraction/SKILL.md` (thin
  pipeline scout→proposal-reviewer→author→`agent-def-convention` re-audit). Registered in `.agents/skills/index.md`;
  `lesson-to-harness` now dispatches capability-extraction; document-standards "Agent definition" row → **defined**
  with the prose-template follow-on retracted (status-note rewritten). Verified: `agent-def-convention` PASS
  (all agents conform, incl. the new one; classified edit-agent — no signal), `check-document-standards-index`
  PASS (row quartet resolves, no dangling follow-on), `pnpm harness:scan` **48/48 exit 0**. TC-01..05 met.
  No package src changes → no changeset. DONE.
