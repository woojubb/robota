# Process Rules

Parent: [AGENTS.md](../../AGENTS.md)
Index: [index.md](index.md)

## Ordinary delivery

Ordinary work has two decision boundaries:

1. **Entry** — understand one authoritative request/issue, its intended outcome, scope, risks, and focused verification.
2. **Completion** — prove the outcome, obtain one independent final review, pass selected CI, merge, and update the authoritative record.

No intermediate role chain, lane declaration, lifecycle move, loop ledger, or receipt commit is mandatory. Extra design review is selected by material risk.

## Routed owners

- Public package behavior and contracts: [spec-workflow.md](spec-workflow.md)
- RED/GREEN and planning: [tdd-and-planning.md](tdd-and-planning.md)
- Affected verification ownership: [verification.md](verification.md)
- Git and publication: [git-branch.md](git-branch.md), [publish.md](publish.md)
- Work execution and findings: [backlog-execution.md](backlog-execution.md)

A process failure must still be visible and actionable. Simplification removes duplicate decisions, not error reporting.
