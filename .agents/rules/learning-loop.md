# Learning Loop Rules

Mandatory rules for turning repeated work lessons into durable repository safeguards.
Parent: [process.md](process.md) | Index: [rules/index.md](index.md)

### Lesson Capture

- When a problem, review comment, CI failure, user correction, or debugging pattern repeats, do not leave it only in chat, PR notes, or a task file.
- Extract the general invariant behind the event. The rule must be domain-neutral unless the invariant belongs to a package SPEC.
- Record the invariant in the narrowest owner document:
  - `.agents/rules/` for repository-wide constraints;
  - `.agents/skills/` for procedural workflow;
  - `packages/*/docs/SPEC.md` for package contracts;
  - harness or hook code when the invariant can be checked mechanically.

### Enforcement Preference

- Prefer mechanical enforcement over prose when a repeated issue can be detected with reasonable signal.
- Acceptable enforcement paths include harness scans, pre-commit/pre-push hooks, unit tests, scenario records, or package-local contract tests.
- If mechanical enforcement is not practical yet, document the rule and add the missing automation as backlog or task work.
- Any new mechanical enforcement must include its own test coverage and must not broaden checks beyond the changed or owned scope without a documented reason.

### Pattern Generalization

- Do not add user-specific, prompt-specific, branch-specific, or incident-specific examples as rules.
- Convert incidents into reusable language: trigger, invariant, correct behavior, and verification method.
- If the same correction has occurred more than once, treat it as a candidate for `common-mistakes.md` or automated harness enforcement.
- When fixing a repeated failure, update the governing rule or check in the same PR whenever feasible.
