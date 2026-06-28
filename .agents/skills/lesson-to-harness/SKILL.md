---
name: lesson-to-harness
description: Invoke when the user says "turn this session's repeated requests into rules/skills", "교훈 처리해줘", "규칙으로 박아줘", or when the agent detects a repeated user correction/preference in-session (same kind of correction 2x+, or an explicit "from now on do/don't ..."). Mines lesson candidates from the session, proposes them for approval, and institutionalizes only the approved ones as neutral, universal principles wired into the repo harness (.agents/rules, AGENTS.md, related skills, harness scan / hooks) as a single source — never memory-only. Operationalizes learning-loop.md.
---

# Lesson → Harness

Mine **repeated user requests/corrections** from the session and, after approval, institutionalize them
as **rules enforced by the repo harness** — so the user never has to re-explain "make this a universal,
neutral rule." This is the procedure that operationalizes [learning-loop.md](../../rules/learning-loop.md)
(the lesson-capture philosophy); this skill is the step-by-step "how."

## When to invoke

Either trigger (propose first):

- The user says "reflect this session's repeated requests as lessons", "교훈 처리해줘", "규칙/스킬로 박아줘", or similar.
- The agent detects a **repeated correction/preference** in-session (same kind of point 2x+, or an explicit "from now on do / don't ...").

A one-off single instruction ("just do X this once") is NOT a lesson — do not invoke.

## Procedure

1. **Mine the session** — scan the whole session for items the user **repeated or explicitly corrected /
   turned into a principle**. Attach **evidence** to each candidate (where/how many times it appeared).
   Exclude one-off, task-specific instructions.
2. **Propose + approve** — present the candidate list and get the user's approval for **which to
   institutionalize** (AskUserQuestion or prose). Only approved candidates proceed. Never institutionalize
   without approval.
3. **Normalize** — turn each approved lesson into ONE _neutral, universal_ principle. Remove incident /
   blame / one-off phrasing; generalize across surfaces and cases. Form: `Principle / Why / How to apply`.
   (Matches learning-loop.md "Pattern Generalization".)
4. **Choose the enforcement tier**
   - **A (always-on hard gate)**: a non-negotiable rule → a row in the **AGENTS.md Mandatory Rules** table
     - `.agents/rules/<slug>.md` + a matching `pnpm harness:scan` FAIL condition or `.claude/hooks/` check.
   - **B (process guidance)**: → `.agents/rules/<slug>.md` + a checklist line in the relevant skill +
     a `.agents/skills/index.md` / `.agents/rules/index.md` entry.
   - **C (augment)**: update an existing rule/skill only.
5. **Find every touchpoint** (consistency, no partial wiring) — candidates: `.agents/rules/index.md`,
   the AGENTS.md Mandatory Rules table, related skills (`backlog-gate-guard` GATE-_,
   `post-implementation-checklist`, `spec-writing-standard`, `harness-governance`, …), and — when the
   invariant is mechanically checkable — `.claude/hooks/_`and`scripts/harness/\*`.
6. **Write** — create/update the canonical `.agents/rules/<slug>.md` (neutral, domain-free) and wire a
   reference into **all** the touchpoints above. One owner document per fact; no duplication.
7. **Enforce when possible** — add a `pnpm harness:scan` FAIL condition or a hook check so a violation is
   actually caught (learning-loop.md "Enforcement Preference"). Do not stop at prose when mechanization
   is practical; new mechanical checks carry their own coverage and stay scoped.
8. **Ship** — follow the repo gates ([git-branch.md](../../rules/git-branch.md)): branch (no `git worktree`)
   → conventional commit → PR → the **Pre-Merge Code-Review Gate** (`/code-review`, resolve all findings)
   → `gh pr merge`. Run `pnpm harness:scan` green before the PR.
9. **Report** — list the repo files the lesson was wired into.

## Single source = the repo (default sink)

The canonical home is the **repo** (`.agents/`, `AGENTS.md`/`CLAUDE.md`) — `AGENTS.md` and `.agents/` load
as session context, so a rule applies without memory. **Do not record a persistent lesson in
session/agent memory only.** Memory may hold a copy, but a persistent lesson must also be written to the
repo (canonical = repo). New persistent lessons are institutionalized here, not parked in memory.

## Trigger (avoid missed invocation)

`.agents/skills/` are agent-invoked, not auto-firing. The `UserPromptSubmit` hook
`.claude/hooks/correction-detect.sh` detects strong preference/principle signals (from now on, don't,
avoid, rule, lesson, always, never, …) and nudges (stdout) to use this skill. On that nudge — or on
self-detecting a repeated correction / explicit principle — **run this procedure.**

## Anti-patterns

| Anti-pattern                                    | Correct behavior                                       |
| ----------------------------------------------- | ------------------------------------------------------ |
| Mistaking a one-off instruction for a lesson    | Only 2x+ repeats or an explicit correction/principle   |
| Institutionalizing a candidate without approval | Present candidates → institutionalize only approved    |
| Recording in session/agent memory only          | Repo (`.agents/`, AGENTS.md) is the single source      |
| Incident-specific / blame phrasing              | Normalize to a neutral, universal principle            |
| Documentation without enforcement               | Add a harness-scan FAIL / hook check when mechanizable |
| Editing one file only (partial wiring)          | Wire every touchpoint consistently                     |

## See also

- [learning-loop.md](../../rules/learning-loop.md) — the lesson-capture philosophy this skill executes.
- [harness-governance](../harness-governance/SKILL.md) — rule/skill consistency + mechanical checks.
- [git-branch.md](../../rules/git-branch.md) — shipping gates + the Pre-Merge Code-Review Gate.
