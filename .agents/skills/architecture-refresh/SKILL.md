---
name: architecture-refresh
description: Thin orchestration for the recurring architecture audit→apply→re-audit loop. It holds NO architecture policy — it only sequences four predefined subagents (two auditors, two appliers), reads their convergence signal, routes each finding to the applier the auditor named, and re-calls them until an audit round is materially clean. Every judgement lives in the agents. Use to keep architecture and implementation in sync when a single pass won't finish it.
---

# Architecture Refresh — pipeline only

This skill only **calls predefined agents and manages the loop**. It carries no architecture policy —
all judgement (criteria, scoping, conformance checks, how to fix docs, how to implement code, the
safe/gated boundary, what counts as material) lives in the agents. The skill names them, reads their
signal, and routes.

The four predefined agents (spawn by `agentType`):

- `architecture-auditor` — read-only; returns findings + `ACTIONABLE FINDINGS: <n>`.
- `architecture-conformance-auditor` — read-only; returns findings, each labelled **doc-side** or
  **code-side**, + `ACTIONABLE FINDINGS: <n>`.
- `architecture-fixer` — applier for **doc-side** findings.
- `architecture-implementer` — applier for **code-side** findings.

## Pipeline

1. **Audit.** Fan out both auditors over the target, one per disjoint area, covering every unit (log any
   area you leave out). Collect each area's findings and `ACTIONABLE FINDINGS` count.
2. **Converged?** Stop only when a full audit round reports **no material findings** in any area. Never
   stop on a round count.
3. **Judge the depth.** Dispatch `finding-depth-triager` on the round's findings and keep its `DEPTH:`
   verdicts. This step is here because the appliers cannot do it: they carry no `Agent` tool, so a verdict
   can only ever be HANDED to them — and their instruction to take one reads as enforced while being
   unreachable if this pipeline never produces it.
4. **Apply.** Per area, call the applier the auditor named — doc-side → `architecture-fixer`, code-side →
   `architecture-implementer` — on **disjoint files**, passing each finding's verdict with it. Send only
   LOCAL findings; a FOUNDATIONAL one goes to the root item instead of an applier, an INVALID one is
   dropped with what the code actually does recorded, and an UNDETERMINED one is re-judged once the thing
   its verdict names as missing is obtained. Keep whatever each applier reports back (applied / skipped /
   escalated).
5. **Re-audit.** Re-run the auditors on the changed areas.
6. **Loop** 1–5 until step 2 says converged.
7. **Land** the applied changes through the repo's normal flow; pass any escalations the appliers return
   into the repo's gated backlog.

That is the whole skill. Everything else is the agents'.
