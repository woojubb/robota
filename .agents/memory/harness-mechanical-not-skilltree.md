# Harness reliability is mechanical, not skill-tree depth

**Principle.** Harness dispatch and gate reliability come from **mechanical hooks + measurement**, NOT from
skill-tree depth (a router → intermediate-orchestrator → leaf skill hierarchy).

**Why.** `.agents/skills/` are **agent-invoked prose, not auto-firing** (a skill fires only when the model
decides to invoke it). So a leaf skill three hops below a "router skill" fires **no more reliably** than a flat
skill — every hop is a model decision, not a mechanical call. A router _skill_ is therefore prose-guessing with
one extra indirection hop, and a mandatory middle-orchestrator tier only adds per-request context cost. The
things that actually make the right process fire are mechanical: `.claude/hooks/` (dispatch/guards) and
`scripts/harness/` scans (gates), plus measurement to prove it.

**Also:** robota's skills are already lean (≈58 files, avg ~101 lines; common preamble is a short `## Rule
Anchor` pointer, not duplicated bulk), and the orchestration layer is already the clean thin-sequencer pattern
(`backlog-pipeline` route-only state machine + `backlog-gate-guard` single-gate validator). So a shared-core
extraction or a new orchestration spine would be **reorganization without a performance gain**.

**How to apply.** When asked to improve harness "performance," reach first for a mechanical dispatcher/gate/metric
(hook or scan), not a new skill layer. Adopt orchestration structure only where it does mechanical work. Measure
firing before reorganizing — an unmeasured reorg is unfalsifiable.

**Provenance.** Independent `architecture-auditor` + `proposal-reviewer` passes (2026-07-16) both endorsed this
axis and rejected a proposed router→orchestrator→leaf "skill org" for robota as right-pattern-wrong-layer.

Related: `self-improving-harness-northstar.md` (the SENSE→ENFORCE→IMPROVE loop this principle serves).

_Mirror of session/host memory per `../rules/memory-mirroring.md`._
