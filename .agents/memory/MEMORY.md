# In-Repo Agent Memory — Index

Durable, cross-session agent knowledge for this repo. Governed by
[`../rules/memory-mirroring.md`](../rules/memory-mirroring.md): anything written to an agent's session/host
memory MUST also be mirrored here so every clone shares the same harness knowledge. One line per fact below;
each fact is a file in this directory. One owner per fact — if an existing rule/spec/lesson owns it, link there.

- [Self-improving harness north-star](self-improving-harness-northstar.md) — robota ALWAYS runs the correct process inside an automated harness that SELF-IMPROVES to make robota continuously better; control loop SENSE(measure firing) → ENFORCE(mechanical dispatch) → IMPROVE(compounding lesson loop); vehicle = epic HARNESS-017 (type: INFRA)
- [Harness reliability is mechanical, not skill-tree depth](harness-mechanical-not-skilltree.md) — dispatch/gate reliability comes from mechanical hooks + measurement, NOT a router→orchestrator→leaf skill tree (skills are agent-invoked prose; a router skill is prose-guessing +1 hop); independently endorsed by architecture-auditor + proposal-reviewer (2026-07-16)
