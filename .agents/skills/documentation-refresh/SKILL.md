---
name: documentation-refresh
description: Orchestrates a convergent audit→fix→re-audit→fix loop that brings a codebase's living documentation back in line with the actual code. Use when docs across README/guides/API-or-spec docs/changelog/examples/site content have drifted and must all be made current with nothing missed. Fans out the read-only doc-auditor over the doc surface, fans out the doc-fixer to apply findings, re-audits changed areas, and repeats until an audit pass is clean (or a round cap). Universal/neutral — judges docs by universal quality criteria against the code, not by house style.
---

# Documentation Refresh (orchestrator)

Drives the loop that a single pass cannot finish: **scope → audit → fix → re-audit → fix … until clean.** You are the orchestrator. The judgement lives in two spawnable subagents — you sequence and converge them; you do not re-implement their criteria.

## The two agents (SSOT of the method)

- **`doc-auditor`** (read-only, `agentType: doc-auditor`) — enumerates every doc in a scope, judges each against the ACTUAL code by universal doc-quality criteria (accuracy, currency, completeness, consistency, runnable examples, link integrity, honesty, clarity), and returns per-file findings + a `ACTIONABLE FINDINGS: <n>` convergence signal.
- **`doc-fixer`** (write-docs-only, `agentType: doc-fixer`) — applies a given findings list precisely, re-verifying each fact against code before writing; edits only its assigned files.

Do not restate their criteria here or inline them — dispatch the agents.

## When to use

- After a release / large feature / refactor, or on demand, when documentation has fallen behind the code and "all docs, none missed" is required. Also as a recurring pass to keep docs from drifting.

## Procedure

1. **Scope the doc surface.** Enumerate the LIVING product docs and record the list (this is how "no doc missed" is guaranteed). Explicitly EXCLUDE, and say so: frozen/versioned snapshots (e.g. a `v*/` docs archive), dated/point-in-time records (design audits, ADRs, historical release notes), and vendored/external docs. Confirm the include/exclude set with the user when the boundary is non-obvious (versioned sites, i18n, historical design docs).
2. **Partition into disjoint areas** so auditors and fixers never touch the same file concurrently — e.g. root canon, package API/spec docs, package READMEs, site content (+ i18n), apps, examples. Disjoint file sets are what make the fan-out safe.
3. **Round = audit → fix → validate:**
   - **Audit fan-out:** one `doc-auditor` per area (parallel). Collect each area's findings + `ACTIONABLE FINDINGS` count.
   - **Stop check:** if every area reports 0 actionable findings, the round is clean → **converged**, exit the loop.
   - **Fix fan-out:** for each area with findings, one `doc-fixer` given exactly that area's findings (parallel; disjoint files). Fixers verify-before-write and may skip a finding the code contradicts.
   - **Validate:** run the repo's doc gates if present (doc-example typecheck, docs-structure/link scan, a build of the docs site) and a grep that the targeted stale strings are gone and no dangling reference remains.
4. **Re-audit only the changed areas** next round (a fixer can introduce or reveal a second-order issue; a skipped finding must be reconsidered). Repeat step 3.
5. **Converge:** stop when a full audit round yields 0 actionable findings, OR at a **round cap** (default 3) — if capped with findings remaining, report the residual explicitly rather than silently stopping. Never claim "all docs current" without a final clean audit pass or an itemized residual list.
6. **Land the change** through the repo's normal review/CI/merge flow; record what was refreshed.

## Fan-out shape (reference)

```
partition docs into areas (disjoint file sets)
round = 0
repeat:
  round += 1
  findings[area] = parallel( doc-auditor over each area )       # read-only
  if all areas report 0 actionable  -> converged, break
  parallel( doc-fixer(area, findings[area]) for areas with findings )  # disjoint writes
  run doc gates (typecheck/scan/build) + stale-string/link grep
  restrict next round's audit to the changed areas (+ any deferred)
until converged or round == cap
report: rounds run, files changed, residual findings (if capped)
```

Notes: auditors are read-only (safe to over-provision); fixers must own disjoint files (never two fixers on one file). Prefer many small, well-scoped areas over a few huge ones. A finding a fixer skipped (code contradicted it) is resolved, not residual — record the reason.

## Rule anchor

- `AGENTS.md` Owner Knowledge Policy (each package owns its spec doc) + "prefer a mechanical check over prose" — the auditor treats such SSOT docs as _inputs to verify against the code_, not as ground truth themselves.
- Universal doc-quality criteria live in `.claude/agents/doc-auditor.md`; the apply discipline lives in `.claude/agents/doc-fixer.md`. This skill only sequences them.
