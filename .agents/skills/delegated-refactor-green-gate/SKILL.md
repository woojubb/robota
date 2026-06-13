---
name: delegated-refactor-green-gate
description: Pattern for handing a large mechanical refactor to a subagent with a hard completion gate — reach build/typecheck/test/dep-direction/conformance green or report blockers, never leave a broken commit, leave changes unstaged for orchestrator review, and have the orchestrator independently re-verify. Use when delegating a big mechanical change.
---

# Delegated Refactor Green Gate

Reusable pattern for delegating a large mechanical change (mass rename, type extraction, import rewrite)
to a subagent under a hard completion gate, so the orchestrator never inherits a broken or unverified state.

## Rule Anchor

- `AGENTS.md` > "Rules and Skills Boundary"
- `.agents/rules/git-branch.md` > Clean Working Tree Before Every Commit and Push

This skill references those rules; it does not redefine them.

## When to Use

- A change is large but mechanical (predictable, repetitive edits across many files).
- The work can be specified precisely enough that a subagent can execute it without product decisions.
- Examples: workspace type-extraction refactor, dependency-direction cleanup, mass import path rewrite.

## The Delegation Contract (give this to the subagent verbatim)

The subagent MUST satisfy a **hard completion gate** before reporting success:

1. **Reach green or report blockers.** Drive the change until ALL of the following pass, OR stop and
   report the specific blocker — never both partially-done and silent:
   - `pnpm build` (affected packages)
   - `pnpm typecheck`
   - `pnpm test` (affected packages)
   - the relevant dependency-direction / conformance guard (e.g. `pnpm harness:scan`)
2. **Never leave a broken commit.** If green cannot be reached, do not commit; report the blocker with the
   exact failing command and output.
3. **Leave changes UNSTAGED for orchestrator review.** Do not `git add`, do not commit, do not push.
   The orchestrator reviews the working-tree diff and owns the commit decision.
4. **Report the exact verification evidence** — each command run and its observed result/exit code.

## Orchestrator Responsibilities (after the subagent returns)

- Treat the subagent's "green" as a hypothesis, not a fact.
- **Independently re-run the key gates** in the orchestrator's own context (typecheck + the relevant
  scan/guard + `pnpm install --frozen-lockfile` when the lockfile was touched). See
  [`post-implementation-checklist`](../post-implementation-checklist/SKILL.md) step 2a.
- Review the unstaged diff for scope creep before staging or committing.
- Only then stage and commit (with user approval per the git rules).

## Anti-Patterns

| Anti-pattern                                            | Correct behavior                                             |
| ------------------------------------------------------- | ------------------------------------------------------------ |
| Subagent commits/pushes the refactor itself             | Leave changes unstaged; orchestrator owns the commit         |
| Subagent reports "done" with a half-green build         | Reach full green or report the blocker; never partial+silent |
| Orchestrator trusts the green report without re-running | Independently reproduce the green result before trusting     |
| Leaving a broken intermediate commit "to fix later"     | Never leave a broken commit; report the blocker instead      |
