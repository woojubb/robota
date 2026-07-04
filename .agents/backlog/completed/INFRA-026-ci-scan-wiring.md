---
title: 'INFRA-026: develop-PR CI에 harness:scan 배선 + pre-push 하네스 전체 스위트'
status: done
completed: 2026-07-04
created: 2026-07-04
priority: high
urgency: now
area: .github/workflows, scripts/harness
depends_on: []
---

# develop-PR CI에 harness:scan 배선 + pre-push 하네스 전체 스위트

Re-audit P1-1 (GATE-001/002, HARNESS-021 동형). 45종 스캔이 develop-PR CI green 경로에 없고
(quality 잡 = harness:verify 3종 + harness:test뿐), pre-push의 harness-tests는 29개 테스트 중
11개 하드코딩 목록만 실행한다. CI 워크플로 변경은 사용자 사전 승인 완료(2026-07-04 안건 2).

## What

1. `.github/workflows/ci.yml` quality 잡에 `pnpm harness:scan` 스텝 추가.
2. `scripts/harness/verify-change.mjs`의 하드코딩 11개 목록을 전체 스위트 실행으로 교체.
3. Prove: 위반 fixture로 red 실측 후 제거하고 green.

## Test Plan

- 하네스 스위트 green; verify-change가 전체 테스트를 실행함을 로그로 확인.

## User Execution Test Scenarios

- agent-executable. 위반 fixture 커밋으로 실제 PR을 열어 CI red 실측 → revert 후 green 확인.
- Evidence: **PASS (real PR red→green, PR #950).** ① 위반 fixture
  (`packages/agent-core/x-infra026-user-execution.ts` <!-- evidence-superseded: deliberately transient red-prove fixture, reverted in the same PR; durable proof is the CI run log and the scan's own test suite -->)를 심은 커밋이 **로컬 pre-push를 통과**
  (기존 게이트 공백의 실증) → 새 CI 스텝 "Harness scan suite"가 quality job을 fail시키며
  fixture를 정확히 지목 (run 28701771833: `✗ temp-script-placement — packages/agent-core/
x-infra026-user-execution.ts`). ② fixture revert 후 green (run 28702213478: quality pass).
  ③ CI 배선이 즉시 노출한 환경 결합 2건을 범위로 흡수: done-evidence 스캔을 fs 존재 →
  **git-tracked 기준**으로 교정(dist/.env류 로컬 전용 참조가 로컬 green/CI red로 갈리던 결함;
  비 git 픽스처 루트는 fs 폴백), dist 스캔은 헌장상 로컬 pre-CI 검사라 CI 호출에서
  reported-never-silent `--skip dist`(unknown 이름은 에러). pre-push의 harness-tests는
  하드코딩 11파일 → 전체 디렉터리(30파일/238테스트, `pnpm harness:verify` 로그로 실측).
  Durable artifacts: `.github/workflows/ci.yml`(Harness scan suite 스텝),
  `scripts/harness/verify-change.mjs`, `scripts/harness/run-all-scans.mjs`(parseSkips),
  `scripts/harness/check-done-evidence.mjs`, `scripts/harness/__tests__/run-all-scans.test.mjs`.
  하네스 스위트 240 green, 로컬 45 스캔 green.
