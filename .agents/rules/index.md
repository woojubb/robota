# Mandatory Rules Index

All rules are mandatory and non-negotiable. Domain-specific rules live in [skills index](../skills/index.md) and package specs (`packages/*/docs/SPEC.md`).

## Amendable by amendment

Read this section as a constitution reads: **every rule here is MANDATORY, and the only thing that
changes one is an amendment.** Both halves are load-bearing, and the second must never be heard as
softening the first.

**While a rule stands, it binds.** Disagreeing with it does not suspend it. Neither does judging it
mis-encoded, inconvenient, inapplicable here, or wrong. Do not quietly deviate, reinterpret it into
non-existence, or downgrade it to a recommendation on the strength of an argument against it: an
argument is the input to an amendment, not an exemption from the rule.

**A rule changes only by amendment**, because a rule is the current best encoding of an engineering
intent — usually a universal principle, sometimes a decision about this repository. An encoding can be
wrong, or right when written and wrong later. When that is shown, the rule changes through the
procedure and not around it.

**A filed backlog item is the minimum evidence that an amendment was attempted.** Below that bar
nothing has been attempted: an objection in a review comment, a paragraph in a commit message, or a
disagreement stated and then acted on is non-compliance, not amendment. Therefore:

- Not filing it means the rule is mandatory and is complied with. "Mandatory" is the accurate
  description of that state.
- Believing a rule is wrong means filing the item — the intent it fails, and the text to change — and
  complying meanwhile. Amending and obeying are not alternatives; a change that proposes an amendment
  still lands under the current rule unless the owner decides otherwise.
- An amendment that lands must leave nothing contradicting it, or it is only partial:
  [learning-loop.md](learning-loop.md) § "Contradiction Between Rules".

An argument from a universal principle outranks a rule here by carrying an amendment, not by being
persuasive when raised — [agent-conduct.md](agent-conduct.md) § "A local rule is an encoding" states
the precedence and its exceptions.

## How a rule is written

**A rule states an invariant, universally and neutrally.** A reader must be able to obey it without
knowing any history, and it must hold for a repository that shares none of this one's incidents.

- **No case narrative.** Numbers of pull requests, issues or review rounds; dates; "this happened
  when…", "measured on…", named past failures — none of these belong in a rule. The incident that
  prompted a rule is evidence for adopting it, not part of it, and it belongs in the record that owns
  it: a task, a lesson, a spec document, or a commit message.
- **A reference is not a narrative.** The ban is on retelling, not on pointing. An identifier that a
  reader or a check must RESOLVE stays: a containment note naming the item that holds an accepted
  gap, a format specimen's identifier slot, the name of the check that enforces the rule and its
  suppression syntax, a path showing what obeying looks like. The test is whether removing it changes
  what someone does. An identifier that only says where a rule came from fails that test; one that
  says where to go does not.
- **Two reasons, and the second is the stronger.** Every line of a rule is loaded before any work
  begins, so narrative costs attention on every task forever. And a rule justified by an incident
  invites the reader to judge whether their case resembles it — which is exactly the discretion a rule
  exists to remove.
- **No repository specifics where a general statement does the same work.** Package names, product
  names and vendor details make a rule that applies here and nowhere else; put them in the package
  specification or the skill that owns the domain.
- **The test.** Delete every proper noun, number and date from a rule and read what remains. If the
  invariant survives, the deleted matter was not carrying it. If it does not survive, either the
  deleted matter was a reference the reader acts on, or the rule was a story whose invariant has not
  been written yet — and those are told apart by asking what a reader would do differently.
- Adding a rule replaces prose only when nothing mechanical can carry it — see
  [learning-loop.md](learning-loop.md) § Enforcement Preference.

## Top-Level Rules

| Group             | Document                                                   | Scope                                                                                             |
| ----------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Code Quality      | [code-quality.md](code-quality.md)                         | Type system, imports, development patterns                                                        |
| Process           | [process.md](process.md)                                   | Pointer stub — process routing lives in this index (see Process Sub-Rules below)                  |
| API Boundary      | [api-boundary.md](api-boundary.md)                         | Pointer stub — API specification and app lifecycle rules live in [operational.md](operational.md) |
| Naming & Style    | [naming-style.md](naming-style.md)                         | Language policy, agent identity, styling                                                          |
| Git & Branch      | [git-branch.md](git-branch.md)                             | Git operations and branch policy                                                                  |
| Frontend          | [frontend.md](frontend.md)                                 | React only, Next.js for SSR, Tailwind-only styling                                                |
| Common Mistakes   | [common-mistakes.md](common-mistakes.md)                   | Observed failure patterns                                                                         |
| Agent Conduct     | [agent-conduct.md](agent-conduct.md)                       | RCP conduct authority (precedence on conflict)                                                    |
| Memory Mirroring  | [memory-mirroring.md](memory-mirroring.md)                 | Session/host memory writes must be mirrored to in-repo `.agents/memory/`                          |
| Enforcement Arch. | [enforcement-architecture.md](enforcement-architecture.md) | Worker/guardian/orchestrator split; guardian backed by a scan/hook floor; hybrid loop-back        |

## Process Sub-Rules

| Document                                               | Scope                                                                                                                                                |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| [spec-workflow.md](spec-workflow.md)                   | Spec-first development, document authority, structural docs                                                                                          |
| [tdd-and-planning.md](tdd-and-planning.md)             | TDD red-green-refactor, planning requirements                                                                                                        |
| [verification.md](verification.md)                     | Build, browser, harness, and pre-push verification gates                                                                                             |
| [testing-layering.md](testing-layering.md)             | CLI = thin-wrapper/TUI tests only; feature behaviour = framework functional test                                                                     |
| [publish.md](publish.md)                               | Release invariants: publish safety gate, scope approval, OTP prohibitions, stop conditions, triage mandate                                           |
| [release-operations.md](release-operations.md)         | Pointer stub — merged into [publish.md](publish.md)                                                                                                  |
| [documentation-sync.md](documentation-sync.md)         | Document role, package README, and robota.io documentation gates                                                                                     |
| [research.md](research.md)                             | Research-first implementation and recommendation authority                                                                                           |
| [backlog-execution.md](backlog-execution.md)           | Backlog recommendation gates, user execution test scenario gates, initiative PRs                                                                     |
| [operational.md](operational.md)                       | No fallback policy, idea capture, feature documentation, API boundary & lifecycle                                                                    |
| [finding-depth.md](finding-depth.md)                   | A review finding is classified by DEPTH before it is fixed (LOCAL / FOUNDATIONAL / INVALID / UNDETERMINED); a foundational one is filed, not patched |
| [helper-limits.md](helper-limits.md)                   | A helper's stated limits are re-judged at every consumer whose consequences differ                                                                   |
| [measurement-provenance.md](measurement-provenance.md) | A size a check reports about itself is produced by the traversal that did the work, and is tested as the output it is                                |
| [work-run-measurement.md](work-run-measurement.md)     | Topic-work lifecycle, Git/PR identity, durable receipt populations, and pre-push/CI enforcement                                                      |
| [learning-loop.md](learning-loop.md)                   | Lesson capture, contract-before-automation, and mechanical enforcement preference                                                                    |
