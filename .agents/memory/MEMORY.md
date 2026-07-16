# In-Repo Agent Memory — Index

Durable, cross-session agent knowledge for this repo. Governed by
[`../rules/memory-mirroring.md`](../rules/memory-mirroring.md): anything written to an agent's session/host
memory MUST also be mirrored here so every clone shares the same harness knowledge. One line per fact below;
each fact is a file in this directory. One owner per fact — if an existing rule/spec/lesson owns it, link there.

- [Self-improving harness north-star](self-improving-harness-northstar.md) — robota ALWAYS runs the correct process inside an automated harness that SELF-IMPROVES to make robota continuously better; control loop SENSE(measure firing) → ENFORCE(mechanical dispatch) → IMPROVE(compounding lesson loop); vehicle = epic HARNESS-017 (type: INFRA)
- [Harness reliability is mechanical, not skill-tree depth](harness-mechanical-not-skilltree.md) — dispatch/gate reliability comes from mechanical hooks + measurement, NOT a router→orchestrator→leaf skill tree (skills are agent-invoked prose; a router skill is prose-guessing +1 hop); independently endorsed by architecture-auditor + proposal-reviewer (2026-07-16)
- Enforcement architecture (owner: [`../rules/enforcement-architecture.md`](../rules/enforcement-architecture.md)) — every enforced process = worker (produces) / guardian (judges, emits verdict) / orchestrator (routes+rewinds); guardian MUST have a scan/hook floor; loop-back is hybrid (auto-re-drive for completeness gates, halt for human-decision gates); no skill-tree tiers. Owner decision 2026-07-16.
- Research is default-on + guarded (owner: [`../rules/research.md`](../rules/research.md)) — every draft/todo/active spec MUST carry a substantiated `## Prior Art Research` section or an explicit `Waived: <reason>`; worker = `prior-art-researcher` agent, guardian = backlog-gate-guard GATE-WRITE, floor = `scan-spec-research.mjs`. Owner requirement 2026-07-16.
