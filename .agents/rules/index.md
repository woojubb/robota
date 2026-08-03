# Mandatory Rules Index

All rules are mandatory and non-negotiable. Domain-specific rules live in
[skills index](../skills/index.md) and [package specs](../../packages/*/docs/SPEC.md).

## This rule set is not the end of the argument

**Mandatory and revisable are different axes, and both hold.** "Non-negotiable" governs OBEDIENCE: while
a rule stands you follow it, and you do not quietly deviate, reinterpret it into non-existence, or
treat it as advisory because it is inconvenient here. It does not govern AUTHORITY: no rule here is
final, correct by virtue of being written down, or beyond being shown wrong.

A rule in this tree is the **current best encoding** of an engineering intent — usually a universal
principle, sometimes a decision about this repository specifically. An encoding can be wrong, can be
right when written and wrong later, and can be narrower or broader than the intent it serves. When
that is demonstrated, the rule changes. The path is: argue it, amend it, record why — never ignore it
and never leave the contradiction standing.

Three consequences worth stating, because each was learned by getting it wrong:

- **An outside argument from a universal principle can beat a rule here**, and then this rule set is
  what changes. Precedence and the narrow exceptions:
  [agent-conduct.md](agent-conduct.md) § "A local rule is an encoding, not the ground truth".
- **A contradiction between two rules is a defect of the rule set**, closed continuously rather than
  when someone notices: [learning-loop.md](learning-loop.md) § "Contradiction Between Rules".
- **A rule nothing can check is a wish.** Preferring a mechanical floor over more prose is itself a
  rule ([learning-loop.md](learning-loop.md) § Enforcement Preference) — and a rule whose subjects
  violate it at landing is filed, not assumed
  ([HARNESS-071](../tasks/HARNESS-071-loops-with-no-progress-escape.md) is the live example).

A rule set that treats itself as terminal stops being a description of how to build well and becomes
a thing to be satisfied. That failure is silent, which is why the principle is written here rather
than assumed.

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

| Document                                       | Scope                                                                                                                                                |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| [spec-workflow.md](spec-workflow.md)           | Spec-first development, document authority, structural docs                                                                                          |
| [tdd-and-planning.md](tdd-and-planning.md)     | TDD red-green-refactor, planning requirements                                                                                                        |
| [verification.md](verification.md)             | Build, browser, harness, and pre-push verification gates                                                                                             |
| [testing-layering.md](testing-layering.md)     | CLI = thin-wrapper/TUI tests only; feature behaviour = framework functional test                                                                     |
| [publish.md](publish.md)                       | Release invariants: publish safety gate, scope approval, OTP prohibitions, stop conditions, triage mandate                                           |
| [release-operations.md](release-operations.md) | Pointer stub — merged into [publish.md](publish.md)                                                                                                  |
| [documentation-sync.md](documentation-sync.md) | Document role, package README, and robota.io documentation gates                                                                                     |
| [research.md](research.md)                     | Research-first implementation and recommendation authority                                                                                           |
| [backlog-execution.md](backlog-execution.md)   | Backlog recommendation gates, user execution test scenario gates, initiative PRs                                                                     |
| [operational.md](operational.md)               | No fallback policy, idea capture, feature documentation, API boundary & lifecycle                                                                    |
| [finding-depth.md](finding-depth.md)           | A review finding is classified by DEPTH before it is fixed (LOCAL / FOUNDATIONAL / INVALID / UNDETERMINED); a foundational one is filed, not patched |
| [helper-limits.md](helper-limits.md)           | A helper's stated limits are re-judged at every consumer whose consequences differ                                                                   |
| [learning-loop.md](learning-loop.md)           | Lesson capture, contract-before-automation, and mechanical enforcement preference                                                                    |
