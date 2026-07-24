---
title: 'HARNESS-023: 릴리스 게이트 스캔 자체 테스트: publish-safety·release-governance부터 fixture'
status: done
completed: 2026-07-24
created: 2026-07-04
priority: medium
urgency: soon
area: scripts/harness
depends_on: []
---

# 릴리스 게이트 스캔 자체 테스트: publish-safety·release-governance부터 fixture

Re-audit P2-14 (GATE-003). 45종 중 ~15종 스캔이 자체 테스트 전무 — 특히 릴리스 안전 게이트가
무검증이라 게이트가 조용히 무력화되어도 감지 수단이 없다.

## What

1. publish-safety → release-governance → spec-publish-claims 순 위반 fixture 단위 테스트.
2. 무테스트 스캔 우선순위 현황표 산출(잔여는 순차 후속).

## Test Plan

- 각 게이트 위반 fixture fail + 정상 pass; 하네스 스위트 green.

## User Execution Test Scenarios

Not applicable — harness tooling only. Engineering evidence: fixture red/green per gate.

## Outcome (2026-07-24)

Status of the three named release gates at execution time:

1. **publish-safety** — already covered by `scripts/harness/__tests__/check-publish-safety.test.mjs`
   (fixture red/green, including the absorbed spec-publish-claims Guard G4 / AF-15 shape). No gap.
2. **spec-publish-claims** — absorbed into `check-publish-safety.mjs`
   (`findPublishClaimFindings`); covered by the same test file. No gap.
3. **release-governance** — was fully untested (the actual gap). Closed:
   - `check-release-governance.mjs` refactored into an exported, workspace-root-parameterized
     `collectReleaseGovernanceFindings()` with the standard CLI entry guard (identical
     output/exit-code behavior; real-repo scan still passes).
   - New `scripts/harness/__tests__/check-release-governance.test.mjs`: a fully wired green
     fixture workspace + red fixtures per gate class (missing governance file, control-plane
     script drift, dropped runbook section, scan-before-build ordering, OTP-before-preflight
     ordering, missing CI dist artifact, template field loss, runner de-registration) + CLI
     exit-code tests. TDD red first: 9/11 failed pre-refactor; 11/11 green after.

Additionally, `release-run.mjs` (the release control-plane machinery the governance scan
guards) had publish-gate and CLI gaps — closed in `release-run.test.mjs`: Gate-status enum,
angle-bracket placeholders, Cleanup-status publish block, open-triage publish block,
placeholder triage fields at the publish gate, missing triage fields, and a child-process CLI
lifecycle suite (init → check → triage → publish gate → report, plus error paths). Red proof by
mutation: disabling the cleanup-status gate fails 1 test; disabling the open-triage gate fails
2 tests (unit + CLI); restored source re-greens (harness suite 486/486).

### Untested-scan status table (item 2 — remaining scans for sequential follow-up)

Computed mechanically from the `run-all-scans.mjs` scan table vs `scripts/harness/__tests__/`
on 2026-07-24. 44/58 registered scan scripts have direct or indirect test coverage; the 14
below have none:

| Priority | Scan (no direct test)                     | Rationale                                              |
| -------- | ----------------------------------------- | ------------------------------------------------------ |
| High     | `scan-dist-freshness.mjs`                 | Release-adjacent: stale dist can green-light a publish |
| High     | `scan-conflict-markers.mjs`               | Rule-enforcement floor (mechanized AGENTS.md checks)   |
| Medium   | `scan-memory-mirror.mjs`                  | Absolute memory-mirroring rule floor                   |
| Medium   | `scan-spec-research.mjs`                  | Research-first gate floor                              |
| Medium   | `scan-orchestration-map.mjs`              | Keeps the orchestration registry mechanically current  |
| Medium   | `scan-review-findings.mjs`                | Review-gate machinery                                  |
| Medium   | `check-nested-package-glob-coverage.mjs`  | INFRA-021 nesting blind-spot guard                     |
| Medium   | `check-spec-doc-frontmatter.mjs`          | Spec-doc gate pipeline input validation                |
| Medium   | `scan-deprecated-markers.mjs`             | Rot guard                                              |
| Low      | `check-architecture-map-paths.mjs`        | Doc-conformance; drift is visible in review            |
| Low      | `check-architecture-map-completeness.mjs` | Doc-conformance                                        |
| Low      | `check-document-standards-index.mjs`      | Doc-taxonomy router check                              |
| Low      | `check-design-doc-completeness.mjs`       | Doc-completeness (has fixtures dir, no assertions)     |
| Low      | `check-adr-completeness.mjs`              | Doc-completeness (has fixtures dir, no assertions)     |

(`scan-consistency.mjs`, `audit-spec-coverage.mjs`, `check-interface-imports.mjs` are covered
indirectly via `harness-smoke.test.mjs` / `check-interface-package-deps.test.mjs`.)
