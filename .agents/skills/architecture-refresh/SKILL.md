---
name: architecture-refresh
description: Thin orchestration for the recurring architecture audit→fix→re-audit loop. It holds NO architecture policy — it only sequences two subagents (architecture-auditor, architecture-fixer) and re-calls them until an audit round is materially clean. All judgement (what to audit, which universal principles, how to fix, the safe/gated boundary) lives in the agents. Use when code and its architecture docs must be brought back into conformance and a single pass won't finish it.
---

# Architecture Refresh — pipeline only

This skill is a **thin pipeline**. It carries no architecture policy: the universal design criteria, how
to scope a target, how to verify against code, the doc-side/code-side boundary, and the convergence
signal all live in the agents. The skill only calls them, checks the signal, and re-calls them.

- **`architecture-auditor`** (`agentType: architecture-auditor`, read-only) owns: scoping, the universal
  design/conformance criteria, verification against the real code, and the `ACTIONABLE FINDINGS: <n>`
  signal (material = blocker/high/medium).
- **`architecture-fixer`** (`agentType: architecture-fixer`, edits artifacts only) owns: the apply
  discipline (verify-before-write, minimal change, scope-disjoint) and the safe/gated boundary — it
  corrects architecture docs/SPECs/maps to match code, and **escalates** genuine code-level design
  violations as gated remediation items instead of silently rewriting code.

Do not restate the agents' policy here.

## Pipeline

1. **Audit.** Dispatch `architecture-auditor` over the target. For a large surface, fan out one auditor
   per disjoint area (a package, layer, or subsystem; auditors are read-only, so over-provisioning is
   safe). Collect each area's findings + its `ACTIONABLE FINDINGS` count.
2. **Converged?** Convergence — not a fixed number of passes — is the loop's stop condition. A round is
   converged only when a full audit surfaces **no material findings** (blocker/high/medium) across every
   area; escalated code-side remediation items that require a gated change do not by themselves block
   convergence, but they MUST be reported, never dropped. If any area still reports material,
   doc-fixable findings, you are **not** done.
3. **Fix.** For each area with fixable findings, dispatch one `architecture-fixer` with exactly that
   area's findings. **Fixers must own disjoint targets** (never two on the same file) so parallel writes
   cannot collide. Collect each fixer's applied / skipped / **escalated** lists.
4. **Re-audit.** Run `architecture-auditor` again on the areas that changed — confirming both that each
   applied fix is correct AND that it introduced no new inconsistency (a fix can surface a latent
   contradiction elsewhere in the same doc).
5. **Loop** the audit → fix → re-audit cycle until step 2 reports convergence. Do **not** stop after one
   or two passes because "it looks done" — a large surface rarely converges that fast; keep going while
   any round still finds material, doc-fixable drift. A **round cap** is only a safety checkpoint, never
   a finish line: on reaching it with material findings still open, pause and report the itemized
   residuals (and all escalated code-side items) for a human decision — do not silently stop, and do not
   claim "architecture conformant". Only a final, materially-clean audit round licenses that claim.
6. **Land** the doc-side result through the repo's normal review/CI/merge flow; route escalated
   code-side remediation items into the repo's gated backlog process.

That is the whole skill. Everything else is the agents'.
