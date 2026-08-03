# Mandatory Rules Index

All rules are mandatory and non-negotiable. Domain-specific rules live in
[skills index](../skills/index.md) and [package specs](../../packages/*/docs/SPEC.md).

## Amendable by amendment — and mandatory until then

Read this section as a constitution reads: **every rule here is MANDATORY, and the only thing that
changes one is an amendment.** Both halves are load-bearing, and the second must never be heard as
softening the first.

**While a rule stands, it binds.** Disagreeing with it does not suspend it. Neither does judging it
mis-encoded, inconvenient, inapplicable here, or wrong. You do not quietly deviate, reinterpret it
into non-existence, or downgrade it to a recommendation because you have an argument against it — an
argument is the input to an amendment, not an exemption from the rule.

**It changes only by amendment**, because a rule in this tree is the current best ENCODING of an
engineering intent — usually a universal principle, sometimes a decision about this repository — and
an encoding can be wrong, or right when written and wrong later. When that is demonstrated the rule
changes, through the procedure and not around it.

**The minimum evidence that an amendment was ATTEMPTED is a filed backlog item.** Below that bar
nothing has been attempted: an objection in a PR comment, a paragraph in a commit message, a
disagreement stated and then acted on is not an amendment, it is non-compliance wearing an argument.
So the standing instruction is exact:

- **If you are not going to file it, the rule is mandatory and you comply.** That is the honest
  description of that state, and saying "mandatory" of it is correct.
- **If you believe the rule is wrong, file the item** — root cause, the principle it fails, the text
  you would change — and comply meanwhile. Amending and obeying are not alternatives; the change that
  proposes the amendment still lands under the current rule unless the owner decides otherwise.
- **An amendment that lands must leave nothing contradicting it**, or the amendment is only partial:
  [learning-loop.md](learning-loop.md) § "Contradiction Between Rules".

Three consequences worth stating, because each was learned by getting it wrong:

- **An outside argument from a universal principle can beat a rule here** — by carrying an amendment,
  not by being persuasive at the moment it is raised. Precedence and the narrow exceptions:
  [agent-conduct.md](agent-conduct.md) § "A local rule is an encoding, not the ground truth".
- **A contradiction between two rules is a defect of the rule set**, closed continuously rather than
  when someone notices: [learning-loop.md](learning-loop.md) § "Contradiction Between Rules".
- **A rule nothing can check is a wish.** Preferring a mechanical floor over more prose is itself a
  rule ([learning-loop.md](learning-loop.md) § Enforcement Preference) — and a rule whose subjects
  violate it at landing is filed, not assumed
  ([HARNESS-071](../tasks/HARNESS-071-loops-with-no-progress-escape.md) is the live example).

A rule set that treats itself as terminal stops being a description of how to build well and becomes
a thing to be satisfied. A rule set whose "revisability" is a disposition rather than a procedure
decays the other way, into advice. Neither failure announces itself, which is why the amendment bar
is written here as a bar and not as an attitude.

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
