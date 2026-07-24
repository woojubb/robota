# Mandatory Rules Index

All rules are mandatory and non-negotiable. Domain-specific rules live in
[skills index](../skills/index.md) and [package specs](../../packages/*/docs/SPEC.md).

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

| Document                                       | Scope                                                                                                       |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| [spec-workflow.md](spec-workflow.md)           | Spec-first development, document authority, structural docs                                                 |
| [tdd-and-planning.md](tdd-and-planning.md)     | TDD red-green-refactor, planning requirements                                                               |
| [verification.md](verification.md)             | Build, browser, harness, and pre-push verification gates                                                    |
| [testing-layering.md](testing-layering.md)     | CLI = thin-wrapper/TUI tests only; feature behaviour = framework functional test                            |
| [publish.md](publish.md)                       | Single release runbook: publish safety gate, scope approval, release state machine, CI triage, publish flow |
| [release-operations.md](release-operations.md) | Pointer stub — merged into [publish.md](publish.md)                                                         |
| [documentation-sync.md](documentation-sync.md) | Document role, package README, and robota.io documentation gates                                            |
| [research.md](research.md)                     | Research-first implementation and recommendation authority                                                  |
| [backlog-execution.md](backlog-execution.md)   | Backlog recommendation gates, user execution test scenario gates, initiative PRs                            |
| [operational.md](operational.md)               | No fallback policy, idea capture, feature documentation, API boundary & lifecycle                           |
| [learning-loop.md](learning-loop.md)           | Lesson capture, contract-before-automation, and mechanical enforcement preference                           |
