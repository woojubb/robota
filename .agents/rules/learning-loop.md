# Learning Loop Rules

Mandatory rules for turning repeated work lessons into durable repository safeguards.
Parent: [process.md](process.md) | Index: [rules/index.md](index.md)

### Lesson Capture

- The procedural "how" for turning repeated lessons into enforced repo rules is the [lesson-to-harness](../skills/lesson-to-harness/SKILL.md) skill (mine → approve → normalize → wire every touchpoint → enforce → ship). Invoke it on **either** a repeated user correction / an explicit "from now on …" principle, **or** a recurring agent/technical failure class — the same _kind_ of failure hit 2×+ in a session even with no user correction (e.g. fixing the same category of CI/scan failure twice). A recurring agent mistake is a first-class lesson trigger, not only user corrections; when you find yourself fixing the same _class_ of failure a second time, invoke the loop.
- **Fixing an instance never closes a recurring mistake.** For any recurring failure, the only terminal state is a mechanical PREVENTION that stops the cause from recurring (steps 8–9 of the skill: mechanize, or infeasible-now + tracked backlog, then prove it fails pre-fix). Correcting the current occurrence without analyzing the cause and preventing recurrence leaves the lesson open.
- When a problem, review comment, CI failure, user correction, or debugging pattern repeats, do not leave it only in chat, PR notes, or a task file.
- Extract the general invariant behind the event. The rule must be domain-neutral unless the invariant belongs to a package SPEC.
- Record the invariant in the narrowest owner document:
  - `.agents/rules/` for repository-wide constraints;
  - `.agents/skills/` for procedural workflow;
  - `packages/*/docs/SPEC.md` for package contracts;
  - harness or hook code when the invariant can be checked mechanically.
- **The repo is the single source of truth for persistent lessons, preferences, and project facts; memory-only recording is prohibited.** Session/agent memory may hold a copy, but any persistent item MUST also live in the repo (`.agents/`, `AGENTS.md`, package SPECs) — these load as session context, so the lesson applies without memory. If the agent records a lesson/preference in memory, it must record it in the repo in the same change.

### Contradiction Between Rules

- **A contradiction between two rules is a defect of the rule set, and closing the instance does not
  close it.** When one document's normative claim negates another's, correct the losing text AND ask
  what let the pair diverge — usually one fact written in two places. Prefer deleting the restatement
  to keeping both and checking them.
- **A rule believed wrong is still in force until amended**, and a filed backlog item is the minimum
  evidence of an amendment attempt — [rules/index.md](index.md) § "Amendable by amendment" owns that
  bar. Recording a contradiction without filing anything leaves the rule set as contradictory as it
  was.
- **The precedence chain resolves a conflict for a reader; it does not license one.** Precedence says
  which side wins when two texts disagree. It is not a reason to leave them disagreeing: a rule a
  reader must override to obey another rule has failed at the only job a rule has.
- **When landing a rule, sweep for what it now contradicts** — skills, drafts, specs, registries and
  in-repo memory, not only the rules tree — and record the sweep and its result in the same change. A
  MUST is not in force while another document permits its negation.

### Enforcement Preference

- **A prose rule alone does not close a lesson.** Every institutionalized lesson MUST reach one of exactly
  two terminal states: (a) **mechanized** — a harness scan FAIL, a hook check, a unit/scenario test, or a
  package-local contract test that trips on the violation; or (b) **infeasible-now** — a written, concrete
  reason mechanization is not yet practical PLUS a tracked backlog/task item to add it. "Will be careful,"
  "documented in the rule," "when practical," and untracked follow-ups are NOT terminal states.
- Mechanize **by default**: reach for a check whenever the violation is detectable with reasonable signal.
  The burden is to justify NOT mechanizing (a specific obstacle), never to justify mechanizing.
- **Fix the class, not the instance.** When a lesson comes from a concrete defect, name the invariant
  (the class), enumerate every current instance of it in the repo, fix them all in the same change, and
  make the mechanism catch the whole class so a future sibling instance fails. Fixing only the triggering
  instance leaves the lesson open.
- **Prove the check.** A new check must demonstrably FAIL on the triggering incident (or a fixture that
  reproduces it) and PASS after the fix; a check that would not have caught the original event is not
  enforcement. Record the before/after result.
- Any new mechanical enforcement must include its own test coverage and must not broaden checks beyond the
  changed or owned scope without a documented reason.
- A recurring auto-lesson candidate (e.g. in `.agents/evals/lessons/`) that keeps accruing frequency with
  no mechanism is an **open** lesson — promote it to a mechanism or record why it cannot be, do not let it
  sit as a perpetual candidate.

### Pattern Generalization

- Do not add user-specific, prompt-specific, branch-specific, or incident-specific examples as rules.
- Convert incidents into reusable language: trigger, invariant, correct behavior, and verification method.
- If the same correction has occurred more than once, treat it as a candidate for `common-mistakes.md` or automated harness enforcement.
- When fixing a repeated failure, update the governing rule or check in the same PR whenever feasible.

### Contract Before Automation

- Before building a generator pipeline, a validation gate, or a skill on top of an artifact type, that type MUST publish a precise **required-contents contract**: required sections, a machine-checkable completeness definition, source integrity, and ownership. No contract → no automation.
- Why: a generator produces toward a target and a gate validates against one. With no defined contract, both are arbitrary and drift; the contract is the single source the pipeline and the gate share.
- How to apply: when an artifact type lacks a contract, define the contract first, then derive the pipeline/gate/skill from it. For document artifacts, the per-type contracts and their router live in the [document-standards index](../specs/document-standards/index.md). Hand-making a few instances without a contract is a shortcut — the contract is what makes the output repeatable and enforceable.
