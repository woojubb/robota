---
title: 'INFRA-2655: Scan integrated dependencies without manifest changes'
issue: https://github.com/woojubb/robota/issues/2655
status: in-progress
created: 2026-09-12
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

- [ ] TC-01: Implement and regression-test full-lockfile scanning on every develop push, bound to the triggering SHA without path filters or cancellation by a later push.
- [ ] TC-02: Preserve manual main/develop scans, actual per-leg identity, read-only credentials, scanner/checksum pins and fail-closed execution; verify positive and negative cases.
- [ ] TC-03: Obtain a real develop full-scan result and explicit version-bound dispositions for all nine original advisory IDs across the four families.
- [ ] TC-04: Run focused workflow/compatibility tests, affected static checks and formatting; record exact scope, results and any declared omissions without claiming local CI equivalence.

## Cause and design ownership

Nash's supplied assessment is `DEPTH: FOUNDATIONAL`: the automatic integrated-dependency scan path
is absent. INFRA-2655 already owns that cause and the four-family reconciliation; no additional
Task or reduced scope is needed. The paired design is
`.agents/spec-docs/draft/INFRA-2655-scan-integrated-dependencies-without-manifest-changes.md`.

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

## Supplied scan evidence

Main supplied manual run `34691164956`: develop job `103546546315` succeeded at `30e0cd876`,
reporting 2176 packages, 4 existing filtered results and `No issues found`; log
`/tmp/robota-2655-infra-develop-full-scan.log`. Main job `103546546215` failed; log
`/tmp/robota-2655-infra-main-full-scan.log`. The overall workflow failed.

This is a real develop baseline, not a whole-workflow pass, new push-path proof or current gate
verdict. All nine original advisory IDs remain outside the exclusions, with resolved versions
traced to `15d423073`; explicit per-ID reconciliation and main-failure review remain work to record.
The author does not check TC boxes or advance lifecycle based on this supplied evidence.

## Goal authorization and current constraints

**Approval route:** `DIRECT`

**Instruction (verbatim):** "#2655 이슈를 처리하고 origin/develop 브랜치에 머지할 때까지 반복해서 처리 완료 해줘."

**Additional goal instruction (verbatim):** "이 깃헙 이슈를 이번에 닫는걸 목표로 하고 #2655 안에 모든 이슈를 처리해야 합니다."

**Given:** 2026-09-12, owner-preserved conversation instructions.

**Current owner instruction (verbatim):** "멀티에이전트는 허용합니다. 워크트리는 여전히 불허합니다"

These preserve the goal authorization, not a current spec approval or gate PASS. Main owns all Git
operations; use the existing checkout with disjoint delegated ownership, no worktrees or clones.
This assignment restores only this Task and its paired draft, with no implementation, gate runs,
status advances or duplicate scenario pipeline.

## Historical provenance

The prior Task and active spec are preserved in the main tree of stash
`90e57a5f76ebe8fea2590c2d675c3ec19102167e` at their original exact paths. Its checkpoint/gate evidence
is historical and unchanged, not current approval or execution evidence. The current dependency
upgrade reference is `15d423073`; the old plan's attribution of all four families to `101fda832`
was incorrect. The paired draft preserves the requirements while correcting that attribution,
the test path, permissions, local-CI assumptions and separation of verification from delivery.

## User Execution Test Scenarios

**Subject:** INFRA-2655 — `.agents/tasks/INFRA-2655-scan-integrated-dependencies-without-manifest-changes.md` and its paired draft.

**Author assessment:** Nash; supplied for this exact dependency-scan work unit.

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** 설치된 Robota의 명령, 대화 응답, 세션 상태, 도구 동작 및 공개 SDK 호출에는 변화가 없으며, 변경 효과는 저장소 관리자가 의존성 취약점 정보를 확인하는 시점과 대상 커밋에만 한정됩니다.
