# Mandatory Rules Index

All rules are mandatory and non-negotiable. Domain-specific rules live in
[skills index](../skills/index.md) and [package specs](../../packages/*/docs/SPEC.md).

## Top-Level Rules

| Group           | Document                                 | Scope                                      |
| --------------- | ---------------------------------------- | ------------------------------------------ |
| Code Quality    | [code-quality.md](code-quality.md)       | Type system, imports, development patterns |
| Process         | [process.md](process.md)                 | Routing file — see sub-rules below         |
| API Boundary    | [api-boundary.md](api-boundary.md)       | Runtime/Orchestrator API rules             |
| Naming & Style  | [naming-style.md](naming-style.md)       | Language policy, agent identity, styling   |
| Git & Branch    | [git-branch.md](git-branch.md)           | Git operations, branch policy, worktree    |
| Common Mistakes | [common-mistakes.md](common-mistakes.md) | 29 observed failure patterns               |

## Process Sub-Rules (linked from process.md)

| Document                                   | Scope                                                    |
| ------------------------------------------ | -------------------------------------------------------- |
| [spec-workflow.md](spec-workflow.md)       | Spec-first development, conformance verification         |
| [tdd-and-planning.md](tdd-and-planning.md) | TDD red-green-refactor, planning requirements            |
| [verification.md](verification.md)         | Build, browser, harness, and pre-push verification gates |
| [publish.md](publish.md)                   | Package publish safety gate and scope approval           |
| [operational.md](operational.md)           | No fallback policy, idea capture, feature documentation  |
