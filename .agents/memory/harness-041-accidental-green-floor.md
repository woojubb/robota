# HARNESS-041 — accidental-green regression-test floor

## STATUS: DONE — merged PR #1272 (`b16e49a0e`), on develop (2026-07-23)

In-repo mirror (memory-mirroring rule). Host mirror: session memory `harness-041-accidental-green-floor.md`.

**What:** the mechanical floor backing the `pr-review-reviewer` guardian + tdd-and-planning.md "Prove the
regression test RED" rule. An _accidental-green_ regression test passes even on the buggy pre-fix code, so it
guards nothing. It recurred TWICE in one session (ARCH-004, CORE-026) before this floor existed.

**How:** `scripts/harness/check-regression-red-proof.mjs` — the intended mutation IS the inverse of the PR's own
source diff. For a `fix:` PR with a **same-package** (source+test) pair, reverse-apply the source hunks
(`git apply -R`) onto the working tree and require the changed test to FAIL. Same-package tests import source
RELATIVELY, which vitest transforms from `src` on the fly → **no rebuild needed** (empirically proven: reversing
CLI-061's hunk flipped its test 2-passed→2-failed with no build). Single targeted mutant (cheap); broad
Stryker-style sweeps stay in INFRA-042.

**Correctness constraints (from proposal-reviewer C1–C4 + pr-review):**

- **C1 (critical):** a vitest _run-error_ (transform/collection/missing-module) is INCONCLUSIVE, NEVER a pass —
  only a genuine assertion failure passes. Multi-file trap: a run-error file must not be masked by a passing
  sibling (fixed in review). A false-GREEN is structurally impossible (`RED_PROOF_OK` requires a real failed
  assertion).
- **C2:** qualifies on `fix:` only (`perf:` excluded — no boolean fail-at-base without flaky timing).
- **C3:** module-graph guard — mutate only a source file the changed test relatively imports (handles dynamic
  `import()`, strips comments, `pkgAbsRoot + path.sep` so `packages/x` ≠ `packages/x-utils`); else INCONCLUSIVE.
- **C4:** refuses to mutate a dirty tree; `finally`-restores.

**Rollout:** ADVISORY CI job `regression-red-proof` (exits 0 unless `REGRESSION_RED_PROOF_ENFORCE=1`; not in the
required-checks ruleset). Flip to required once stable across real PRs.

**Byproduct:** editing `package.json` trips the manifest-gated `security-audit` osv-scanner, which surfaced 18
pre-existing dependency advisories → filed **INFRA-044** (triage + move the audit to a schedule). The checker is
invoked via `node`, no `package.json` alias, to avoid coupling this feature to that remediation.

**Process lesson (separate, to institutionalize):** a read-only reviewer agent ran `git reset --hard` mid-review
and destroyed an untracked spec-doc. Reviewer/auditor agents must never run tree-mutating git. See
[[reviewer-agents-no-destructive-git]].
