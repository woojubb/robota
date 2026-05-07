# Cross-Cutting Contracts

Repository-wide contract owners that span product shells or package families.

Back to [System Architecture Map](../ARCHITECTURE-MAP.md).

## Contract Owner Index

Architecture maps describe boundaries and routes. Detailed contract truth remains in the owning
SPEC or cross-cutting spec.

| Contract area                          | Owner document                                                                         | Notes                                                               |
| -------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Package inventory and dependency rules | [../../project-structure.md](../../project-structure.md)                               | Package list and dependency direction rules.                        |
| Built-in command ownership             | [../command-inventory.md](../command-inventory.md)                                     | Command modules, lifecycle, model visibility, and host effects.     |
| Agent invocation routing               | [../agent-invocation-router.md](../agent-invocation-router.md)                         | Deterministic agent command descriptors and routing claim guards.   |
| Background task lifecycle              | [../background-task-layer.md](../background-task-layer.md)                             | Generic background task composition, runners, and projection.       |
| Subagent process management            | [../subagent-process-manager.md](../subagent-process-manager.md)                       | CLI subagent process execution and parallel lifecycle.              |
| Verification pipeline                  | [../verification-pipeline-plan.md](../verification-pipeline-plan.md)                   | Local hooks, harness, CI, build, and release verification.          |
| Agent core contracts                   | [../../../packages/agent-core/docs/SPEC.md](../../../packages/agent-core/docs/SPEC.md) | Provider, history, permission, hooks, and model catalog contracts.  |
| Agent SDK contracts                    | [../../../packages/agent-sdk/docs/SPEC.md](../../../packages/agent-sdk/docs/SPEC.md)   | InteractiveSession, command contracts/common APIs, and SDK facades. |
| Auth contracts                         | [../../../packages/auth/docs/SPEC.md](../../../packages/auth/docs/SPEC.md)             | Auth verifier ports and scope policy.                               |
| Credits contracts                      | [../../../packages/credits/docs/SPEC.md](../../../packages/credits/docs/SPEC.md)       | Credit account, reservation, and settlement contracts.              |
| DAG core contracts                     | [../../../packages/dag-core/docs/SPEC.md](../../../packages/dag-core/docs/SPEC.md)     | DAG definitions, reducers, ports, and state rules.                  |
| DAG cost contracts                     | [../../../packages/dag-cost/docs/SPEC.md](../../../packages/dag-cost/docs/SPEC.md)     | Cost metadata, CEL evaluation, and storage ports.                   |

## Boundary Rule

When an architecture change touches one of these contract areas, update the owner SPEC/spec first and
then update the smallest relevant architecture-map subdocument. Do not copy detailed type or class
inventories into this file unless the relationship itself is cross-cutting architecture.
