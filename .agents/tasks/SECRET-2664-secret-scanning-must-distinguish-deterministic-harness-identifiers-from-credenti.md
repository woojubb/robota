---
title: 'SECRET-2664: Secret scanning must distinguish deterministic harness identifiers from credentials'
issue: https://github.com/woojubb/robota/issues/2664
status: in-progress
created: 2026-09-21
priority: medium
urgency: soon
area: .gitleaks.toml, .github/workflows/gitleaks.yml, harness recommendation-review evidence
depends_on: []
---

# SECRET-2664: Secret scanning must distinguish deterministic harness identifiers from credentials

## Current disposition — 2026-09-23

PR #2827 (`2a4a84631d24243d8dfb8ef75e04d790e8d60d37`) deliberately retired the legacy gate, checkpoint, and recommendation machinery. Its deterministic endorsement producer is absent, but the immutable migration history still reaches secret scanning. The historical population, rather than a future producer format, is the current scope.

Gitleaks 8.30.1 reported 15 findings at five unique fingerprints. Each matched span was independently recomputed from its historical owner algorithm and public input metadata. The proposed policy adds only those five exact commit/path/rule/line fingerprints; it does not exempt `endorsementKey`, 64-hex assignments, files, or directories. Same-carrier synthetic controls detect all eight planted findings, including credentials beside a valid identifier and an unverified identifier in a new context. A positive historical-range scan with those exceptions exits zero.

The redacted identifier receipt owns recomputation and control details. Final fresh-D-to-reviewed-head scanning and hosted security success remain pending; this Task stays in-progress until that boundary passes and the exact policy lands.

## Objective

Make the repository's secret-scan policy distinguish deterministic harness identifiers from credentials without weakening detection of real credentials in harness metadata or adjacent paths.

Historically, the default `generic-api-key` rule classified a generated 64-hex `endorsementKey` as a credential. This is foundational rather than local to one ledger row: the same metadata shape has been introduced by 17 commits, and suppressing one occurrence leaves every later recommendation-review record exposed to the same CI failure.

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

**Author verdict:** `SCENARIO DRAFTED: automatable | 1`

### Scenario 1 — Historical identifiers remain reviewable while same-carrier credentials are detected

Using pinned gitleaks 8.30.1 and the unchanged current rule configuration, scan the frozen historical range with the five recomputed exact fingerprints and require zero findings. Scan isolated copies of the same carrier shapes containing synthetic generic credentials, synthetic PATs, and an unverified identifier in new contexts; require all eight expected findings. Finally scan the fresh D-to-reviewed-head range and require the hosted security check to succeed. A failure remains explicit and prevents terminal acceptance.
