---
title: 'INFRA-2655: Scan integrated dependencies without manifest changes'
issue: https://github.com/woojubb/robota/issues/2655
status: done
created: 2026-09-12
completed: 2026-09-12
priority: high
urgency: now
area: workspace build and verification
depends_on: []
---

# INFRA-2655: Scan integrated dependencies without manifest changes

## Objective

Run a full dependency scan for every develop push, independent of changed paths, preserving manual scans and checksum verification. Revalidate all four original advisory families against the committed lockfile and live scan results.

Parent: AGREEMENT-2655; canonical umbrella: https://github.com/woojubb/robota/issues/2655.

## Plan

- [x] TC-01: Implement and regression-test full-lockfile scanning on every develop push, bound to the triggering SHA without path filters or cancellation by a later push.
- [x] TC-02: Preserve manual main/develop scans, actual per-leg identity, read-only credentials, scanner/checksum pins and fail-closed execution; verify positive and negative cases.
- [x] TC-03: Obtain a real develop full-scan result and explicit version-bound dispositions for all nine original advisory IDs across the four families.
- [x] TC-04: Run focused workflow/compatibility tests, affected static checks and formatting; record exact scope, results and any declared omissions without claiming local CI equivalence.

## Cause and design ownership

Nash's supplied assessment is `DEPTH: FOUNDATIONAL`: the automatic integrated-dependency scan path
is absent. INFRA-2655 already owns that cause and the four-family reconciliation; no additional
Task or reduced scope is needed. The paired design is
`.agents/spec-docs/done/INFRA-2655-scan-integrated-dependencies-without-manifest-changes.md`.

The proposed direction extends the existing full-lockfile workflow, not the PR audit or a new
schedule. Alternatives and the complete nine-advisory population are owned by the paired spec.

**REVIEW VERDICT: ENDORSE** — Pascal, 2026-09-12. The absent automatic scan path, preserved manual
targets, pinned scanner and existing advisory upgrades were independently verified against source.
Directly declaring the YAML parser is appropriate; no extra scope or corrective finding was raised.
The final changed lockfile and actual delivering push remain verification obligations, not claims
proved by the earlier manual develop scan.
Nash found that root `yaml`, `js-yaml` and `@actions/expressions` do not resolve. The implementation
scope therefore includes a direct root `yaml` devDependency in `package.json` and its necessary
`pnpm-lock.yaml` resolution for parsed workflow tests. Do not borrow a private/transitive parser;
no scanner-config or product dependency changes are planned unless live findings require them.

## Delivery

Main verifies the actual required PR CI results on the reviewed head and current base before any
authorized merge; focused local results are not a substitute. This is delivery evidence, not a
circular pre-merge Plan checkbox requiring the merge to have already happened.

Delivery acceptance also requires the authorized merge to be present in origin/develop and an
actual push-triggered full scan whose inspected SHA is the delivering commit. Record its run,
result and commit in the source Issue and coordinate the child's parent projection. A manual run
alone does not establish the new push path. Keep AGREEMENT-2655 and Issue #2655 open until all other
source outcomes are delivered; this child does not finish or modify its siblings.

## Test Plan

Use the paired spec's four-row Test Plan: parsed workflow event/target regressions, mocked
checksum/scanner failure boundaries, a real develop full-lockfile scan with all nine dispositions,
and focused compatibility/static/format checks. Do not substitute version numbers, historical
global CI or the removed local CI mirror for execution evidence. Inspect tests before running them;
use no Git initialization, worktree or clone fixtures. A real develop manual scan can establish
TC-03 before merge; the delivering push scan remains separate post-merge acceptance.

## Verification result

The paired spec owns the exact commands, results and nine advisory dispositions. Focused tests and
the changed-lockfile OSV scan passed. The original manual run's develop leg passed while its main
leg failed. Actual delivering-push acceptance remains outstanding under Delivery above.

## Goal authorization and current constraints

**Approval route:** `DIRECT`

**Instruction (verbatim):** "#2655 이슈를 처리하고 origin/develop 브랜치에 머지할 때까지 반복해서 처리 완료 해줘."

**Given:** 2026-09-12, owner-preserved conversation instructions.

**Current owner instruction (verbatim):** "멀티에이전트는 허용합니다. 워크트리는 여전히 불허합니다"

These preserve the goal authorization, not a current spec approval or gate PASS. Main owns all Git
operations; use the existing checkout with disjoint delegated ownership, no worktrees or clones.

## Historical provenance

The paired spec records the preserved stash and corrected dependency-upgrade attribution.
Historical checkpoint evidence is not substituted for the current implementation checkpoint.

## User Execution Test Scenarios

**Subject:** INFRA-2655 — this Task and its paired spec.

**Author assessment:** Nash; supplied for this exact dependency-scan work unit.

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** 설치된 Robota의 명령, 대화 응답, 세션 상태, 도구 동작 및 공개 SDK 호출에는 변화가 없으며, 변경 효과는 저장소 관리자가 의존성 취약점 정보를 확인하는 시점과 대상 커밋에만 한정됩니다.
