# Enforcement Architecture (worker / guardian / orchestrator)

How the harness makes a step actually happen — not "the model should," but a mechanism that fails loudly when
it doesn't. Every enforced process in this repo follows one shape. Parent: [process.md](process.md).

The live registry of every orchestrator/worker/guardian pipeline (at a glance, auditable, mechanically kept
current) is [.agents/specs/orchestration-map.md](../specs/orchestration-map.md).

## The three roles — strict division of labor

- **Orchestrator** — manages the PIPELINE ONLY. Runs stages in order; on a verdict it routes forward, or
  **rewinds** to an earlier stage. It performs no domain work and makes no quality judgment of its own — it
  routes purely on the verdict handed to it (and on machine-readable state such as a spec's `status:`
  frontmatter). Exemplar: `backlog-pipeline`.
- **Worker** — PRODUCES ONLY. One job (e.g. "write the spec", "research prior art"). Does not inspect its own
  output, does not judge, does not fix. Exemplars: `backlog-writer`, the `prior-art-researcher` agent.
- **Guardian** — JUDGES ONLY. Inspects a worker's output and returns a **structured, machine-actionable
  verdict** (e.g. `PASS | FAIL | NON-COMPLIANCE`) plus what is missing. It does not do the work and does not fix
  it. Exemplar: `backlog-gate-guard`.

A skill/agent that both produces and judges, or that judges and also routes, violates this rule. Split it.

## Reliability comes from (verdict + a script), not from skill-tree depth

`.agents/skills/` are agent-invoked prose, not auto-firing, so **nesting skills more deeply does not make a
step more likely to run** (see [`.agents/memory/harness-mechanical-not-skilltree.md`]). Enforcement is real only
where **(a guardian emits a machine token) + (a `scripts/harness` scan or `.claude/hooks/` check reads it)**.
Therefore:

- **Every guardian MUST be backed by a mechanical floor** — a `pnpm harness:scan` FAIL condition or a hook — so
  the machine signal, not the model's discretion, is the floor. A prose-only guardian ("should check X") buys
  nothing; it is the failure mode this rule exists to prevent.
- Do NOT add orchestration tiers or nesting to gain reliability. Reuse the flat `backlog-pipeline` shape.

## Loop-back is hybrid

On a guardian FAIL the orchestrator rewinds. Two shapes, both already in the repo, chosen by gate kind:

- **Auto-re-drive (completeness/quality gates)** — the orchestrator automatically re-runs the worker and
  re-checks, converging on a machine signal (the `architecture-refresh` shape: converge on
  `ACTIONABLE FINDINGS: 0`). Bounded by a max-iteration count, then escalate to the user. Use for gates like
  prior-art research, spec completeness, and conformance, where "just make it complete" is unambiguous.
- **Halt-for-user (human-decision gates)** — the orchestrator stops and surfaces the verdict for the user to
  decide (the current GATE-APPROVAL shape). Use where a human sign-off is the point.

## Applying it to a new enforced step

1. Name the **worker** (produces the artifact), the **guardian** (judges it, emits a verdict), and the
   **orchestrator** (routes on the verdict). Keep them separate.
2. Give the guardian a **mechanical floor** (a scan/hook) — not just a prose criterion.
3. Choose the **loop-back kind** (auto-re-drive vs halt) by whether the gate is completeness or human-decision.
4. Reuse the `backlog-pipeline` / `backlog-gate-guard` shape. Do not invent new tiers.
