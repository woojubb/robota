# Learning Loop Rules

Mandatory rules for turning repeated work lessons into durable repository safeguards.
Parent: [process.md](process.md) | Index: [rules/index.md](index.md)

### Lesson Capture

- The procedural "how" for turning repeated user corrections/preferences into enforced repo rules is the [lesson-to-harness](../skills/lesson-to-harness/SKILL.md) skill (mine → approve → normalize → wire every touchpoint → enforce → ship). Invoke it on a repeated correction or an explicit "from now on …" principle.
- When a problem, review comment, CI failure, user correction, or debugging pattern repeats, do not leave it only in chat, PR notes, or a task file.
- Extract the general invariant behind the event. The rule must be domain-neutral unless the invariant belongs to a package SPEC.
- Record the invariant in the narrowest owner document:
  - `.agents/rules/` for repository-wide constraints;
  - `.agents/skills/` for procedural workflow;
  - `packages/*/docs/SPEC.md` for package contracts;
  - harness or hook code when the invariant can be checked mechanically.
- **The repo is the single source of truth for persistent lessons, preferences, and project facts; memory-only recording is prohibited.** Session/agent memory may hold a copy, but any persistent item MUST also live in the repo (`.agents/`, `AGENTS.md`, package SPECs) — these load as session context, so the lesson applies without memory. If the agent records a lesson/preference in memory, it must record it in the repo in the same change.

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

### Contract Before Automation

- Before building a generator pipeline, a validation gate, or a skill on top of an artifact type, that type MUST publish a precise **required-contents contract**: required sections, a machine-checkable completeness definition, source integrity, and ownership. No contract → no automation.
- Why: a generator produces toward a target and a gate validates against one. With no defined contract, both are arbitrary and drift; the contract is the single source the pipeline and the gate share.
- How to apply: when an artifact type lacks a contract, define the contract first, then derive the pipeline/gate/skill from it. For document artifacts, the per-type contracts and their router live in the document-standards index (see `.agents/spec-docs/` `RULE-007`). Hand-making a few instances without a contract is a shortcut — the contract is what makes the output repeatable and enforceable.
