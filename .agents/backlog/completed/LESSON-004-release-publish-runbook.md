---
title: 'LESSON-004: version-management 스킬에 릴리즈/배포 런북 보강 — 이번 세션 배포 함정 반영'
status: done
created: 2026-06-15
completed: 2026-06-15
priority: medium
urgency: soon
area: .agents/skills/version-management, scripts/harness
depends_on: []
---

# LESSON-004: 릴리즈/배포 런북 보강

## Problem (이번 세션 실제 사건)

3.0.0-beta.76 릴리즈 중 다음 함정들이 실제로 발생해 재작업/혼선을 유발했다:

1. **`pnpm version` 오용** — pnpm builtin이 가려져 노드 버전만 출력하고 bump가 안 됨.
   올바른 명령은 `pnpm run version`(changeset).
2. **changeset 누락** — 일부 패키지만 changeset이 있어 CHANGELOG가 불완전 → bump를 되돌리고
   누락 changeset(DQ-002/003/006/007) 추가 후 재실행. "변경된 모든 패키지는 bump 전 changeset 필수".
3. **OTP 만료 중 publish 중단** — OTP가 publish 도중 만료(2회). 스크립트가 idempotent라
   이미 published 패키지를 건너뛰고 재실행으로 복구. 이 idempotency 전제를 런북에 명시 필요.
4. **레지스트리 전파 지연 false mismatch** — 최종 검증이 `agent-transport-mcp beta=...63` 불일치를
   오보. 직접 `npm dist-tag ls`로 beta.76 확인. "전파 지연 시 패키지별 직접 조회로 확정".

`version-management` 스킬은 bump 조정은 다루나 위 publish-time 함정은 누락되어 있다.

## Solution

`version-management` 스킬(또는 릴리즈 런북 절)에 추가:

- `pnpm run version` vs `pnpm version`(builtin) 구분 경고 + 검증 단계(bump 후 변경 확인).
- bump 전 "변경된 모든 공개 패키지에 changeset 존재" 체크리스트(가능 시 기계적 검사).
- OTP 만료 시 idempotent 재실행 절차(이미 published 스킵 전제).
- 최종 dist-tag 검증의 전파 지연 대응: 패키지별 직접 `npm dist-tag ls` 확정 루프
  (zsh word-split 함정 회피 — 인라인 리스트/`for` 명시).

## Completion Criteria

- [x] TC-01: `version-management` 스킬에 `pnpm run version` 함정 + bump 검증 단계 추가
- [x] TC-02: bump 전 changeset 완전성 체크리스트(또는 기계적 검사) 추가
- [x] TC-03: OTP 만료 idempotent 재실행 + 전파 지연 직접 검증 절차 명문화
- [x] TC-04: `pnpm harness:scan` 통과

## Test Plan

| TC-ID | Test Type   | Approach                                     |
| ----- | ----------- | -------------------------------------------- |
| TC-01 | Doc review  | 스킬 diff — 명령 구분 + 검증 단계 확인       |
| TC-02 | Doc/Harness | 체크리스트 또는 changeset 완전성 스캐너 확인 |
| TC-03 | Doc review  | OTP/전파 지연 절차 문구 확인                 |
| TC-04 | Harness     | `pnpm harness:scan` 통과                     |

## User Execution Test Scenarios

Not applicable — 릴리즈 거버넌스(스킬/하네스) 보강. 사용자 대면 런타임 동작 무변경.

## Tasks

- [x] version-management 스킬 업데이트 → changeset 완전성 검사 조사 → harness:scan 검증

## Evidence Log

### 구현 완료 — 2026-06-15

- **TC-01:** `version-management/SKILL.md`에 "Release-Time Gotchas" 절 추가 — `pnpm version`(builtin)
  vs `pnpm run version`(= `changeset version`) 구분 + bump 후 `git status` 검증 단계. 레포 스크립트
  `version` = `changeset version`임을 직접 확인.
- **TC-02:** bump 전 "마지막 릴리즈 태그 이후 변경된 모든 패키지가 어떤 changeset에 명시되어야 함"
  체크리스트로 추가. (기계적 검사 조사 결론: pre 모드 + no-bump/doc-only 시나리오에서 false-positive
  위험이 있어 robust 자동 검사는 후속 과제로 두고, 우선 런북 체크리스트를 durable 통제로 채택.)
- **TC-03:** OTP 만료 시 idempotent 재실행(이미 published 스킵) + 레지스트리 전파 지연 false
  dist-tag mismatch → 패키지별 `npm dist-tag ls` 직접 확정 절차 명문화. zsh word-split 함정 경고 포함.
- **TC-04:** `pnpm harness:scan` **26/26 passed** (release-governance 포함).

User Execution Test Scenario gate: Not applicable — 릴리즈 거버넌스(스킬) 보강(런타임 동작 무변경).
