---
status: review-ready
type: INFRA
tags: [cli]
---

# INFRA-030: Capability-extraction system — repeatably turn ad-hoc work into focused agents + thin orchestration

## Problem

The agent has repeatedly, **ad-hoc**, decomposed a large task into (a) focused, universal/neutral,
single-responsibility subagents that hold all the policy, and (b) a **thin orchestration skill** that
only sequences them and reads their machine-readable signal. This session alone produced, by hand:
`doc-auditor`/`doc-fixer` + `documentation-refresh`; `architecture-auditor`/`architecture-conformance-auditor`/`architecture-fixer`/`architecture-implementer`

- `architecture-refresh`; `proposal-reviewer`; `merge-verifier`. Each time the decomposition, the
  universal/neutral phrasing, the "policy lives in the agent / skill is pipeline-only" split, the
  `ACTIONABLE FINDINGS: <n>` / `VERDICT` signal, the index registration, and the spawn-after-merge caveat
  were re-derived from memory. That is exactly the kind of recurring, re-invented work this pattern says
  to institutionalize.

**Symptom / reproduction condition:** when a new recurring role is needed, there is no skill or agent
that (1) recognizes "this ad-hoc workflow should be split into focused agents + a thin skill", (2)
proposes the correct role decomposition, and (3) authors the agent/skill files to the established
convention. It is done freehand each time, so quality and conventions drift (e.g. a skill that restates
agent policy, a missing convergence signal, an unregistered agent).

## Architecture Review

### Affected Scope

- **New skill:** `.agents/skills/capability-extraction/SKILL.md` — thin pipeline that sequences the
  discovery + authoring agents and registers the result. Holds no authoring policy.
- **New agents (`.claude/agents/`):**
  - `capability-scout` (read-only) — given a described/observed workflow or task history, identifies the
    distinct single-responsibility roles, proposes the decomposition (which roles become agents, which
    stay in a thin skill, the sequencing, and each role's machine-readable signal), and flags where a
    single agent is doing too much. Never writes.
  - `agent-skill-author` (edits harness files only) — given an approved role spec, authors the
    universal/neutral agent definition(s) and/or thin orchestration skill to the established convention,
    and registers them (skills index / spawnable note). Edits only `.claude/agents/*` and
    `.agents/skills/*` — never product code.
- **Convention contract:** a reference doc (or rule) capturing the established pattern so the author and
  scout share one definition of "done": universal/neutral (portable, judges by timeless criteria, treats
  house rules as optional context), single responsibility, **policy lives in the agent**, **orchestration
  skill is pipeline-only** (calls predefined agents, routes by their emitted labels, loops to
  convergence), a machine-readable signal (`ACTIONABLE FINDINGS: <n>` / `REVIEW VERDICT` / `MERGE
VERIFIED`), read-only vs edit tool scoping, and the "spawnable after commit + session rescan" caveat.
- **Reuses:** `proposal-reviewer` (to sign off a proposed decomposition before authoring) and
  `merge-verifier` (to confirm the harness change landed) — no change to those.

### Alternatives Considered

1. **Skill + two agents (scout + author) + a convention contract (chosen).** Mirrors the very pattern it
   institutionalizes: discovery and authoring are distinct single responsibilities; the skill only
   sequences; the convention doc is the shared SSOT of "correct agent/skill shape".
   - _Pro:_ self-consistent (the meta-system obeys the pattern it enforces); each piece independently
     reusable; the convention contract stops convention drift.
   - _Con (cost):_ three new harness artifacts to build + a convention doc to write.
2. **A single "make-an-agent" mega-skill that does discovery + authoring inline.** _Rejected —_ it would
   itself violate the pattern (a fat skill holding policy + doing the work), the exact anti-pattern the
   user has repeatedly corrected. Discovery and authoring are different responsibilities.
3. **Only a convention doc / rule, no agents (keep authoring freehand but to a checklist).** _Rejected —_
   a checklist still leaves the recurring discovery + authoring work in the main loop, re-invented each
   time; it does not make the process repeatable-by-invocation, which is the stated goal.

### Decision

**Alternative 1.** Build the `capability-extraction` thin skill + `capability-scout` (discover) +
`agent-skill-author` (author) + a convention-contract reference doc. The meta-system is itself built to
the pattern (single-responsibility agents hold policy; the skill is pipeline-only), so it is a working
example of its own output. A proposed decomposition is signed off by `proposal-reviewer` before
authoring; the landed harness change is confirmed by `merge-verifier`.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — `.agents/skills/capability-extraction/`, `.claude/agents/{capability-scout,agent-skill-author}.md`, convention reference doc, skills index
- [x] Sibling scan 완료 — reuses existing `proposal-reviewer`/`merge-verifier`; N/A for product packages (harness-only change, no `packages/*` or `apps/*` touched)
- [x] 대안 최소 2개 검토 완료 — 3 alternatives; 2 rejected (fat mega-skill violates the pattern; doc-only isn't repeatable-by-invocation)
- [x] 결정 근거 문서화 완료 — the meta-system must obey the pattern it institutionalizes (single responsibility, policy-in-agent, pipeline-only skill), so a scout+author+thin-skill split is the only self-consistent shape

## Solution

1. Write the convention-contract reference doc: the universal/neutral + single-responsibility +
   policy-in-agent + pipeline-only-skill + machine-signal + tool-scoping + spawn-caveat rules, distilled
   from the existing agents/skills as the canonical "correct shape".
2. Author `capability-scout` (read-only): input = a described workflow / task history; output = a
   proposed decomposition (roles → agents vs thin-skill steps, sequencing, per-role signal, tool
   scope), ending with a machine-readable summary; flags over-scoped roles.
3. Author `agent-skill-author` (edits harness only): input = an approved role spec; output = the agent
   definition file(s) + thin skill to the convention, plus index/spawnable-note registration.
4. Author the `capability-extraction` thin skill: pipeline only — scout → (proposal-reviewer sign-off) →
   author → register → report; re-invocable for each new capability.
5. Register all three in `.agents/skills/index.md` (skill row + spawnable-agents note).
6. Dry-run: feed the system one real recurring workflow and confirm it emits a valid, convention-passing
   agent + skill without hand-editing.
7. `pnpm harness:scan` 45/45; new agents spawnable after commit + session rescan.

## Affected Files

- New: `.agents/skills/capability-extraction/SKILL.md`
- New: `.claude/agents/capability-scout.md`, `.claude/agents/agent-skill-author.md`
- New: convention-contract reference doc (e.g. `.agents/skills/capability-extraction/CONVENTION.md` or a `.agents/rules/` entry)
- Modified: `.agents/skills/index.md` (skill row + spawnable-agents note)

## Completion Criteria

- [ ] TC-01: `.agents/skills/capability-extraction/SKILL.md` exists and is pipeline-only — it names the predefined agents and sequences them; it restates no authoring policy (grep: no quality-criteria/authoring-rules prose in the skill body).
- [ ] TC-02: `.claude/agents/capability-scout.md` exists (read-only tool set) and its output contract ends with a machine-readable decomposition summary line.
- [ ] TC-03: `.claude/agents/agent-skill-author.md` exists (edit tools limited to `.claude/agents/*` + `.agents/skills/*`) and its output contract requires convention-conformant files + index registration.
- [ ] TC-04: The convention-contract doc enumerates the pattern rules (universal/neutral, single-responsibility, policy-in-agent, pipeline-only skill, machine signal, tool scoping, spawn-after-rescan caveat).
- [ ] TC-05: `.agents/skills/index.md` lists the new skill and the two new agents in the spawnable-agents note.
- [ ] TC-06: Dry-run — invoking the system on one recurring workflow produces an agent + skill that pass `pnpm harness:scan` with no hand-editing (evidence: the generated files + scan output).
- [ ] TC-07: `pnpm harness:scan` returns 45/45 (or the then-current full count) after the change.

## Test Plan

Test strategy (INFRA, harness-only, no product code): structural + harness-scan verification; the
"functional" test is a dry-run that exercises the pipeline end-to-end on a real workflow and checks the
output passes the harness.

| TC-ID | Test Type  | Tool / Approach                                                                   | Notes                          |
| ----- | ---------- | --------------------------------------------------------------------------------- | ------------------------------ |
| TC-01 | Structural | `rg` — skill names agents + has no authoring-policy prose                         | pipeline-only assertion        |
| TC-02 | Structural | Read agent def — read-only tools + machine-summary line                           | scout contract                 |
| TC-03 | Structural | Read agent def — edit scope limited to harness dirs + registration required       | author contract                |
| TC-04 | Structural | Read convention doc — all pattern rules enumerated                                | shared SSOT of "correct shape" |
| TC-05 | Structural | `rg` in `.agents/skills/index.md` for the skill row + agent note                  | registration                   |
| TC-06 | Functional | Dry-run the pipeline on one recurring workflow; run `pnpm harness:scan` on output | end-to-end; no hand-editing    |
| TC-07 | CI/harness | `pnpm harness:scan`                                                               | full scan green                |

## Tasks

- [ ] `.agents/tasks/INFRA-030.md` — 미생성 (GATE-APPROVAL 통과 후 생성)

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-07-07

**Status upgrade:** draft → review-ready
Frontmatter: `---` block; `status: draft`; `type: INFRA` (valid); `tags: [cli]` (harness tooling is CLI-invoked).
Problem: concrete symptom (each recurring role re-derived freehand; explicit list of this session's hand-built agents/skills) + reproduction condition (new role needed, no skill/agent to decompose+author); no TBD/TODO.
Architecture Review: all 4 checklist items `[x]`; sibling scan `[x]` (reuses proposal-reviewer/merge-verifier; N/A for product packages — harness-only); 3 alternatives with pro/con (2 rejected: fat mega-skill violates the pattern, doc-only isn't repeatable-by-invocation); Decision references the self-consistency trade-off.
Completion Criteria: TC-01..TC-07, all TC-N-prefixed, structural/observable form, no vague language.
Test Plan: present; 7 rows matching TC-01..TC-07 (count matches); each row has Test Type + Tool; no "manual" rows (TC-06 is a functional dry-run).
Structure: Tasks placeholder present; Evidence Log was empty; no `## Status`/`## Classification` in body.
