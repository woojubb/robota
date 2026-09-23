# Specification and Work-Record Policy

Parent: [AGENTS.md](../../AGENTS.md)

## One authoritative work record

Use the user's request or canonical GitHub issue as the default work record. A repository Task is optional and exists only when it adds offline durability or multi-PR sequencing the issue cannot own. A design document records a material design decision; it is not a parallel lifecycle tracker.

Do not require separate Task/spec state, lifecycle file moves, lane declarations, registration receipts, planning-only commits, or copied parent status for ordinary work. Historical records remain readable in place and need no mass migration.

## Entry boundary

Before implementation, understand the requested outcome, affected surfaces, material risks, and focused verification. Ask for explicit direction only for material scope expansion, external contract changes, new permissions, destructive actions, or releases. Package public behavior and API changes still update the governing `packages/<name>/docs/SPEC.md` before code.

## Completion boundary

Complete the requested scope, run affected verification, execute a real user execution test scenario when behavior changed, obtain one independent final review of the meaningful diff, pass selected CI, merge, and update the authoritative record.

Historical active gate documents finish or are explicitly superseded through the current Entry and Completion boundaries. No executable legacy gate pipeline is retained, and new work never enters one.
