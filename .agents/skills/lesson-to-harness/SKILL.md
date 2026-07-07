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
5. **Generalize to the class, then sweep** — a lesson from a concrete defect is never about the one
   instance that triggered it. Name the **class** (the invariant that, if violated anywhere, reproduces
   the symptom), then **enumerate every current instance** of that class in the repo and fix them all in
   this change — not just the triggering one. If you fixed file A, the same defect in sibling files B/C
   is still latent and will resurface. (Example shape: "a `packages/*` glob in build/CI tooling that
   omits a nested package group" — fix the one that failed _and_ every other `packages/*` glob.) The
   count of swept instances is part of the report.
6. **Find every touchpoint** (consistency, no partial wiring) — candidates: `.agents/rules/index.md`,
   the AGENTS.md Mandatory Rules table, related skills (`backlog-gate-guard` GATE-_,
   `post-implementation-checklist`, `spec-writing-standard`, `harness-governance`, …), and — when the
   invariant is mechanically checkable — `.claude/hooks/_`and`scripts/harness/\*`.
7. **Write** — create/update the canonical `.agents/rules/<slug>.md` (neutral, domain-free) and wire a
   reference into **all** the touchpoints above. One owner document per fact; no duplication.
8. **Build the mechanism (mandatory — the lesson is not closed without it)** — a rule in prose is the
   weakest possible outcome and, alone, does **not** institutionalize a lesson. Produce a **means that
   makes recurrence fail loudly**, and reach one of exactly two terminal states:
   - **Mechanized** — a `pnpm harness:scan` FAIL condition, a `.claude/hooks/` check, or a test that
     trips on the violation. This is the default; mechanize unless you can show it is infeasible.
   - **Infeasible-now** — a written, specific reason mechanization is not yet practical **plus** a tracked
     backlog/task item to add the check. "Hard to check," "low value," or silence are not acceptable
     reasons; only a concrete obstacle is.

   "Documented in a rule, will-be-careful, when-practical, follow-up-later (untracked)" are **not**
   terminal states — they are the formal/weak handling this step exists to prevent.

9. **Prove the mechanism catches the incident** — a check that would not have caught the original event
   is not enforcement. Demonstrate it: run the new check against the **pre-fix state** (or a fixture that
   reproduces the incident) and confirm it FAILS, then against the fixed state and confirm it PASSES.
   The new check carries its own coverage (a fixture / unit case) and stays scoped to the class — it must
   not broaden beyond the owned scope without a documented reason. Record the before/after result.
10. **Ship** — follow the repo gates ([git-branch.md](../../rules/git-branch.md)): branch (no `git worktree`)
    → conventional commit → PR → the **Pre-Merge Code-Review Gate** (`/code-review`, resolve all findings)
    → `gh pr merge`. Run `pnpm harness:scan` green before the PR.
11. **Report** — list the repo files wired, the **swept instance count** (step 5), the **terminal state**
    of the mechanism (mechanized vs infeasible-now+backlog, step 8), and the **prove result** (step 9).
    A report that cannot name a mechanism terminal state means the lesson is not yet closed.

## New recurring role → dispatch capability-extraction (don't duplicate this loop)

When an approved lesson is **"a new recurring role"** (the session kept hand-building the same kind of
focused, universal/neutral subagent + a thin orchestration skill that only sequences it), the
institutionalization is a **specialization of this loop**, not a parallel one: dispatch
capability-extraction — `capability-scout` proposes the role decomposition → `proposal-reviewer` signs
it off → an author writes the role(s) to the **agent-definition convention** (document type in
[`document-standards/index.md`](../../specs/document-standards/index.md)) → the
`check-agent-def-convention.mjs` guard (`harness:scan` → `agent-def-convention`) gates it. Reuse this
skill's approve→institutionalize→**enforce** discipline; the guard is the mechanism terminal state
(step 8) for a role lesson. (The `agent-skill-author` write-agent + a standalone capability-extraction
orchestration skill are deferred behind the guard — INFRA-030.)

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

| Anti-pattern                                             | Correct behavior                                                                    |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Mistaking a one-off instruction for a lesson             | Only 2x+ repeats or an explicit correction/principle                                |
| Institutionalizing a candidate without approval          | Present candidates → institutionalize only approved                                 |
| Recording in session/agent memory only                   | Repo (`.agents/`, AGENTS.md) is the single source                                   |
| Incident-specific / blame phrasing                       | Normalize to a neutral, universal principle                                         |
| **Stopping at a rule doc / "will be careful"**           | **Prose alone never closes a lesson — reach a mechanism terminal state (step 8)**   |
| **"Mechanize when practical" used as an opt-out**        | **Mechanize by default; only a concrete, written obstacle + a backlog item defers** |
| **Fixing the one instance, not the class**               | **Name the class, sweep every current instance, make the check catch all (step 5)** |
| **Adding a check you never proved**                      | **Prove it FAILS on the pre-fix incident and PASSES after (step 9)**                |
| **Leaving high-frequency auto-lesson candidates parked** | **A recurring signal with no mechanism is an open lesson, not a closed one**        |
| Editing one file only (partial wiring)                   | Wire every touchpoint consistently                                                  |

## See also

- [learning-loop.md](../../rules/learning-loop.md) — the lesson-capture philosophy this skill executes.
- [harness-governance](../harness-governance/SKILL.md) — rule/skill consistency + mechanical checks.
- [git-branch.md](../../rules/git-branch.md) — shipping gates + the Pre-Merge Code-Review Gate.
