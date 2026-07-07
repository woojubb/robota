---
name: documentation-refresh
description: Thin orchestration for the recurring documentation audit→fix→re-audit loop. It holds NO documentation policy — it only sequences two subagents (doc-auditor, doc-fixer) and re-calls them until an audit round is clean. All judgement (what to audit, what "good" means, how to fix) lives in the agents. Use when docs must be brought current with the code and a single pass won't finish it.
---

# Documentation Refresh — pipeline only

This skill is a **thin pipeline**. It carries no documentation policy: what counts as an in-scope doc, the quality criteria, how to verify, and how to edit all live in the agents. The skill only calls them, checks the convergence signal, and re-calls them.

- **`doc-auditor`** (`agentType: doc-auditor`, read-only) owns: scoping/enumeration, the doc-quality criteria, verification against code, and the `ACTIONABLE FINDINGS: <n>` signal.
- **`doc-fixer`** (`agentType: doc-fixer`, edits docs only) owns: the apply discipline (verify-before-write, scope-disjoint, deletions, i18n).

Do not restate the agents' policy here.

## Pipeline

1. **Audit.** Dispatch `doc-auditor` over the target. For a large surface, fan out one auditor per disjoint area (auditors are read-only, so over-provisioning is safe). Collect each area's findings + its `ACTIONABLE FINDINGS` count.
2. **Converged?** Convergence — not a fixed number of passes — is the loop's stop condition. A round is converged only when a full audit surfaces **no material findings** (nothing above the agents' low/polish severity) across every area. If any area still reports material findings, you are **not** done, regardless of how many rounds have already run.
3. **Fix.** For each area that has findings, dispatch one `doc-fixer` with exactly that area's findings. **Fixers must own disjoint files** (never two fixers on the same file) so parallel writes cannot collide.
4. **Re-audit.** Run `doc-auditor` again on the areas that changed — confirming both that each applied fix is correct AND that it introduced no new inconsistency (a fix can create fresh drift).
5. **Loop** the audit → fix → re-audit cycle until step 2 reports convergence. Do **not** stop after one or two passes because "it looks done" — a large surface rarely converges that fast; keep going while any round still finds material drift. A **round cap** is only a safety checkpoint, never a finish line: on reaching it with material findings still open, pause and report the itemized residuals for a human decision — do not silently stop, and do not claim "docs current". Only a final, materially-clean audit round licenses the "docs current" claim.
6. **Land** the result through the repo's normal review/CI/merge flow.

That is the whole skill. Everything else is the agents'.
