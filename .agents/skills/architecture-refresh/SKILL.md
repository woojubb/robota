---
name: architecture-refresh
description: Thin orchestration for the recurring architecture audit→depth→apply→re-audit loop. It holds NO architecture policy — it only sequences five predefined subagents (two auditors, the depth guardian, two appliers), reads their convergence signal, routes each finding on its depth verdict to the applier the auditor named, and re-calls them until every finding of a round is RESOLVED. Every judgement lives in the agents. Use to keep architecture and implementation in sync when a single pass won't finish it.
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
2. **Converged?** Convergence is the stop condition, never a round count — and it is **resolved**, not
   **fixed**: a round is converged when every material finding in every area has a disposition, one of
   corrected, contained under a filed root item, or recorded INVALID. "No material findings left" is a
   condition only an edit can reach, and with a foundational finding outstanding that is pressure to
   apply the patch [finding-depth.md](../../rules/finding-depth.md) forbids. **Re-plan is not on the
   list:** it changes what this pipeline is auditing, so a finding disposed of that way **halts** the
   loop and is reported with its root item rather than counted.
3. **Judge the depth.** Dispatch `finding-depth-triager` on the round's findings and keep its `DEPTH:`
   verdicts. This step is here because the appliers cannot do it: they carry no `Agent` tool, so a verdict
   can only ever be HANDED to them — and their instruction to take one reads as enforced while being
   unreachable if this pipeline never produces it.
4. **Apply.** Per area, call the applier the auditor named — doc-side → `architecture-fixer`, code-side →
   `architecture-implementer` — on **disjoint files**, passing each finding's verdict with it. Send only
   LOCAL findings; an INVALID one is dropped with what the code actually does recorded, and an
   UNDETERMINED one is re-judged once the thing its verdict names as missing is obtained. Keep whatever
   each applier reports back (applied / skipped / escalated).

   A **FOUNDATIONAL** one is not sent to an applier. File the root item where
   [finding-depth.md](../../rules/finding-depth.md) § "Where a root item lives" says it goes — under
   `.agents/backlog/`, in the format [its README](../../backlog/README.md) defines — register its GitHub
   issue, then take the disposition: **labelled containment** (hand the filed ID to the applier the
   auditor named, which writes the label at the site and nothing else — the note in a document, the
   comment in code, both opening `Contained — <ID>.`) or **re-plan** (**halt**, per step 2). Search the
   backlog before filing; the documentation pipeline often already owns an item for the same cause, and
   its ID is the one to cite. Never hand a containment instruction without an ID.

   That this pipeline CAN change code does not make a code-side foundational finding an implementation
   task. Depth is about where the defect is, not about what the loop is able to reach — and reaching it
   is precisely what turns a foundational finding into a patch on the wrong layer.

5. **Re-audit.** Re-run the auditors on the changed areas. A contained claim comes back `CONTAINED`, not
   as a finding, which is what lets a round holding a foundational verdict still converge.
6. **Loop** 1–5 until step 2 says converged.
7. **Land** the applied changes through the repo's normal flow; pass any escalations the appliers return
   into the repo's gated backlog.

That is the whole skill. Everything else is the agents'.
