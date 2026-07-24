---
name: lesson-to-harness
description: Invoke when the user says "turn this session's repeated requests into rules/skills", "교훈 처리해줘", "규칙으로 박아줘", or when the agent detects a repeated user correction/preference in-session (same kind of correction 2x+, or an explicit "from now on do/don't ..."). Mines lesson candidates from the session, proposes them for approval, and institutionalizes only the approved ones as neutral, universal principles wired into the repo harness (.agents/rules, AGENTS.md, related skills, harness scan / hooks) as a single source — never memory-only. Operationalizes learning-loop.md.
---

# Lesson → Harness

The step-by-step "how" for [learning-loop.md](../../rules/learning-loop.md): mine repeated user
corrections, and after approval institutionalize them as rules **enforced by the repo harness**.
The `.claude/hooks/correction-detect.sh` UserPromptSubmit hook nudges this skill on strong
preference/principle signals — on that nudge (or self-detection), run the procedure. A one-off
"just do X this once" is NOT a lesson.

## Procedure

1. **Mine the session** — collect items the user repeated or explicitly turned into a principle,
   each with evidence (where / how many times). Exclude one-off task-specific instructions.
2. **Propose + approve** — present candidates; only user-approved ones proceed. Never
   institutionalize without approval.
3. **Normalize** — one neutral, universal principle per lesson (`Principle / Why / How to apply`);
   remove incident/blame/one-off phrasing.
4. **Choose the enforcement tier** — **A**: hard gate → AGENTS.md Mandatory Rules row +
   `.agents/rules/<slug>.md` + a `harness:scan` FAIL condition or `.claude/hooks/` check;
   **B**: process guidance → rule doc + skill checklist line + index entries; **C**: augment an
   existing rule/skill.
5. **Generalize to the class, then sweep** — a lesson is never about the one triggering instance.
   Name the **class** (the invariant that reproduces the symptom anywhere it's violated), then
   enumerate and fix **every current instance** in the repo in this change. The swept-instance
   count is part of the report.
6. **Find every touchpoint** — `.agents/rules/index.md`, the AGENTS.md Mandatory Rules table,
   related skills, and (when mechanically checkable) `.claude/hooks/` + `scripts/harness/*`. No
   partial wiring.
7. **Write** — the canonical `.agents/rules/<slug>.md` (neutral, domain-free) + references at all
   touchpoints. One owner document per fact.
8. **Build the mechanism (mandatory — the lesson is not closed without it)** — prose alone never
   closes a lesson. Reach one of exactly two terminal states:
   - **Mechanized** — a `harness:scan` FAIL condition, hook check, or test that trips on the
     violation (the default).
   - **Infeasible-now** — a written, concrete obstacle **plus** a tracked backlog item to add the
     check. "Hard to check" / "low value" / silence are not acceptable reasons.
9. **Prove the mechanism catches the incident** — run the new check against the **pre-fix state**
   (or a reproducing fixture) and confirm it FAILS, then against the fixed state and confirm it
   PASSES. The check carries its own coverage and stays scoped to the class. Record the
   before/after result.
10. **Ship** per [git-branch.md](../../rules/git-branch.md) (branch → conventional commit → PR →
    Pre-Merge Code-Review Gate → merge), `pnpm harness:scan` green before the PR.
11. **Report** — files wired, swept-instance count (step 5), mechanism terminal state (step 8),
    prove result (step 9). No named terminal state = the lesson is not closed.

## New recurring role → dispatch capability-extraction

When an approved lesson is "a new recurring role" (the session kept hand-building the same focused
subagent + thin orchestration skill), dispatch the thin
[capability-extraction](../capability-extraction/SKILL.md) pipeline (`capability-scout` →
`proposal-reviewer` → `agent-skill-author` → the `agent-def-convention` guard) instead of
hand-rolling this loop — the guard is the step-8 mechanism terminal state for a role lesson.

## Single source = the repo

The canonical home is the repo (`.agents/`, `AGENTS.md`) — never record a persistent lesson in
session/agent memory only. Memory may hold a copy; the repo copy is canonical.

## See also

- [learning-loop.md](../../rules/learning-loop.md) — the lesson-capture philosophy.
- [harness-governance](../harness-governance/SKILL.md) — rule/skill consistency + mechanical checks.
