---
status: draft
type: INFRA
tags: [typescript]
---

# INFRA-005: ARCHITECTURE.md planned-package consistency

> Source: INFRA-002 audit findings **AF-02** (P0, CONTRADICTION) + **AF-08** (P1). See
> `.design/architecture-audit/2026-06-13/conformance-audit-report.md`.

## Problem

`ARCHITECTURE.md:38` lists `auth` and `credits` inside the live "SDK Packages" box with no qualifier,
while `.agents/project-structure.md:31-39` explicitly marks `packages/auth/` and `packages/credits/` as
"Planned (Not Yet Created)". The filesystem confirms both are absent. Two authority-tier documents
directly contradict each other on whether these packages exist. Separately, `cross-cutting-contracts.md:58-59`
(AF-08) names `packages/auth/docs/SPEC.md` and `packages/credits/docs/SPEC.md` as contract owners —
dead links to phantom owners.

**Reproduction condition:** `ls packages/auth packages/credits` → both absent, yet `ARCHITECTURE.md`
and `cross-cutting-contracts.md` reference them as if live.

## Architecture Review

### Affected Scope

- `ARCHITECTURE.md`
- `.agents/specs/architecture-map/cross-cutting-contracts.md`
- (doc correction only — no code change)

### Alternatives Considered

1. **Create the auth/credits packages now.** Pro: makes the docs true. Con: out of scope, no demand;
   ADR-002 deliberately defers them. Rejected.
2. **Mark auth/credits "Planned" everywhere they appear**, making `project-structure.md` the single SSOT
   for package existence. Pro: cheap, removes the contradiction and dead links. Con: none material. Chosen.

### Decision

Alternative 2 — annotate `auth`/`credits` as Planned in `ARCHITECTURE.md` and `cross-cutting-contracts.md`
to match `project-structure.md`. The proposed package-existence guard (INFRA-003) will enforce that every
package named in an authority doc either exists or carries a "Planned" marker.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — `ARCHITECTURE.md`, `cross-cutting-contracts.md`
- [x] Sibling scan 완료 — N/A: doc correction, not a command family
- [x] 대안 최소 2개 검토 완료 — 2 alternatives above
- [x] 결정 근거 문서화 완료 — Decision records single-SSOT-for-existence rationale

## Solution

Add a "Planned (not yet created)" marker to every `auth`/`credits` reference in `ARCHITECTURE.md` and
`cross-cutting-contracts.md`, consistent with `project-structure.md`.

## Affected Files

- `ARCHITECTURE.md`
- `.agents/specs/architecture-map/cross-cutting-contracts.md`

## Completion Criteria

- [ ] TC-01: Every `auth`/`credits` mention in `ARCHITECTURE.md` and `cross-cutting-contracts.md` carries
      a "Planned" marker; no doc presents them as live packages.
- [ ] TC-02: `pnpm harness:scan` exits 0.

## Test Plan

| TC-ID | Test Type              | Tool / Approach                                                     | Notes           |
| ----- | ---------------------- | ------------------------------------------------------------------- | --------------- |
| TC-01 | manual                 | Inspect both docs; confirm Planned marker on every auth/credits ref | doc inspection  |
| TC-02 | CI pipeline smoke test | `pnpm harness:scan` exit 0                                          | doc-only change |

## Tasks

- [ ] `.agents/tasks/INFRA-005.md` — 미생성 (GATE-APPROVAL 통과 후 생성)

## Evidence Log
