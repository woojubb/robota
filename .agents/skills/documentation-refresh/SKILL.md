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
2. **Converged?** If every area reports `ACTIONABLE FINDINGS: 0`, stop — done.
3. **Fix.** For each area that has findings, dispatch one `doc-fixer` with exactly that area's findings. **Fixers must own disjoint files** (never two fixers on the same file) so parallel writes cannot collide.
4. **Re-audit.** Run `doc-auditor` again on the areas that changed.
5. **Loop** 2–4 until an audit round is all-zero, or a **round cap** (default 3). If capped with findings left, report the residual findings itemized — never claim "docs current" without a final clean audit round.
6. **Land** the result through the repo's normal review/CI/merge flow.

That is the whole skill. Everything else is the agents'.
