---
name: architecture-refresh
description: Thin orchestration for the recurring architecture audit→apply→re-audit loop. It holds NO architecture policy — it only sequences four subagents (two auditors, two appliers) and re-calls them until an audit round is materially clean. All judgement (what to audit, which universal principles, how to check conformance, how to fix docs, how to implement code, the safe/gated boundary) lives in the agents. Use to keep the architecture and the implementation in sync when a single pass won't finish it.
---

# Architecture Refresh — pipeline only

This skill is a **thin pipeline**. It carries no architecture policy: the universal design criteria, how
to scope a target, how to check conformance, how to fix docs vs implement code, the safe/gated boundary,
and the convergence signal all live in the agents. The skill only calls them, checks the signal, routes
each finding to the right applier, and re-calls them.

Four agents, two read-only auditors and two appliers:

- **`architecture-auditor`** (read-only) — judges whether the design is **good** by universal principles.
- **`architecture-conformance-auditor`** (read-only) — judges whether the design and the code are **in
  sync**, both directions, classifying each finding **doc-side** or **code-side**. Both auditors end
  with `ACTIONABLE FINDINGS: <n>` (material = blocker/high/medium).
- **`architecture-fixer`** (edits docs only) — resolves **doc-side** findings: brings architecture
  docs/SPECs/maps in line with the code.
- **`architecture-implementer`** (edits code) — resolves **code-side** findings: brings the code in line
  with the intended architecture, verified (build/tests green), following the repo's change process;
  stops-and-plans when a change is too large to make safely.

Do not restate the agents' policy here.

## Pipeline

1. **Audit.** Dispatch the auditors over the target. For **full coverage**, enumerate every package and
   app first, then fan out so **no unit is skipped** — one auditor per disjoint area (package, layer, or
   subsystem; auditors are read-only, so over-provisioning is safe). Run `architecture-auditor` (design
   quality) and `architecture-conformance-auditor` (architecture↔implementation sync) across the areas.
   Collect each area's findings, each classified **doc-side** or **code-side**, plus its `ACTIONABLE
FINDINGS` count. If you must bound coverage, **log what you did not audit** — never let a skipped area
   read as clean.
2. **Converged?** Convergence — not a fixed number of passes — is the loop's stop condition. A round is
   converged only when a full audit surfaces **no material findings** (blocker/high/medium) across every
   area, in **both directions** (doc→code and code→doc). If any area still reports material findings you
   are **not** done, regardless of how many rounds have run.
3. **Apply — route by side.** For each area with findings, dispatch appliers on **disjoint targets**
   (never two on the same file):
   - **doc-side** findings → `architecture-fixer` (bring the docs to the code).
   - **code-side** findings → `architecture-implementer` (bring the code to the intended architecture,
     verified). A code change that is too large/risky to make safely comes back as an **escalated
     remediation plan** routed to the repo's gated backlog — reported, never dropped, and it does not by
     itself count as convergence-blocking once recorded.
     Collect each applier's applied / skipped / escalated lists.
4. **Re-audit.** Run the conformance auditor (and the design auditor where design changed) again on the
   changed areas — confirming each applied change is correct AND introduced no new drift on the other
   side (a doc fix can expose a code violation; a code change can stale a doc). Keep architecture and
   implementation in step.
5. **Loop** the audit → apply → re-audit cycle until step 2 reports convergence. Do **not** stop after one
   or two passes because "it looks done" — a large surface rarely converges that fast; keep going while
   any round still finds material drift in either direction. A **round cap** is only a safety checkpoint,
   never a finish line: on reaching it with material findings still open, pause and report the itemized
   residuals (and all escalated code-side plans) for a human decision — do not silently stop, and do not
   claim "architecture and implementation in sync". Only a final, materially-clean audit round licenses
   that claim.
6. **Land** doc-side changes and safe code-side changes through the repo's normal review/CI/merge flow;
   route escalated code-side remediation plans into the repo's gated backlog process.

That is the whole skill. Everything else is the agents'.
