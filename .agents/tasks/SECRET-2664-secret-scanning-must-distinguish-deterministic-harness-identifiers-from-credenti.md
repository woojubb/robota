---
title: 'SECRET-2664: Secret scanning must distinguish deterministic harness identifiers from credentials'
issue: https://github.com/woojubb/robota/issues/2664
status: todo
created: 2026-09-21
priority: medium
urgency: soon
area: .gitleaks.toml, .github/workflows/gitleaks.yml, harness recommendation-review evidence
depends_on: []
---

# SECRET-2664: Secret scanning must distinguish deterministic harness identifiers from credentials

## Objective

Make the repository's secret-scan policy distinguish deterministic harness identifiers from credentials without weakening detection of real credentials in harness metadata or adjacent paths.

The default `generic-api-key` rule currently classifies a generated 64-hex `endorsementKey` as a credential. This is foundational rather than local to one ledger row: the same metadata shape has been introduced by 17 commits, and suppressing one occurrence leaves every later recommendation-review record exposed to the same CI failure.

## Evidence

- PR #2786 failed `Secret scan (gitleaks)` on deterministic `endorsementKey` metadata: https://github.com/woojubb/robota/actions/runs/35555892844/job/106199343983
- Local gitleaks 8.30.1 reproduction matched the CI fingerprint and exited 1; the range immediately before the recommendation-review record exited 0.
- The finding-depth guardian returned `DEPTH: FOUNDATIONAL` based on the repeated shape in commit `4bd782c1` and 17 commits that introduced the same field.
- Registration on issue #2664: https://github.com/woojubb/robota/issues/2664#issuecomment-5754838887

## Plan

- [ ] Characterize every generated deterministic identifier shape that can reach secret scanning and record the exact false-positive rule and carrier paths.
- [ ] Choose a narrow policy or evidence-serialization contract that distinguishes those identifiers without exempting a directory, file class, or unrelated high-entropy assignment.
- [ ] Add positive and negative regression fixtures proving deterministic harness identifiers are accepted while credential-shaped values in the same surface are still rejected.
- [ ] Run the pinned local scanner and the GitHub `Secret scan (gitleaks)` gate, then record the verified boundary and residual risk.

## Test Plan

- Run pinned gitleaks 8.30.1 over a commit range containing generated recommendation-review evidence and require exit 0.
- Plant synthetic credential-shaped values in an isolated fixture covering the same carrier path and require the relevant secret rules to report them.
- Run focused scanner-policy tests plus affected harness scans.

## User Execution Test Scenarios

<!-- backlog-execution.md § User Execution Test Scenario Rule. Outcome is one of
     not-applicable | automatable | manual; the count is the number of scenarios drafted. Keep the
     not-applicable form ONLY with a product-surface reason (≥ 50 characters, not build/typecheck
     evidence); otherwise write the scenario a user can run and raise the count. -->

**Author verdict:** `SCENARIO DRAFTED: automatable | 1`

### Scenario 1 — A normal recommendation-review record does not block its PR as a secret

**Prerequisites:** A branch based on current `develop`, GitHub Actions enabled, and a harness workflow that records a recommendation endorsement.

**Steps:**

1. Run the normal recommendation-review workflow so it appends a deterministic `endorsementKey` record.
2. Commit that generated evidence and open a draft pull request to `develop`.
3. Wait for `Secret scan (gitleaks)` to complete.

**Expected observable result:** The secret-scan check passes for the generated deterministic identifier. Scanner-policy regression tests still demonstrate that credential-shaped values in the same surface are rejected.

**Cleanup:** Close the draft PR and delete its temporary branch after capturing the check URL.

**Evidence:** Pending implementation.
