---
title: 'LICENSE-001: MIT → AGPL-3.0 + Commercial 듀얼 라이선스 전환'
status: done
created: 2026-06-16
completed: 2026-06-16
priority: high
urgency: now
area: LICENSE, package.json (all), README (all), apps/www, apps/docs
depends_on: []
---

# LICENSE-001: AGPL-3.0 + Commercial 듀얼 라이선스 전환

## Problem

프로젝트를 MIT에서 **AGPL-3.0 + 상업용 듀얼 라이선스**로 전환(사용자 지시). MIT 참조가 LICENSE,
전 패키지 package.json, 모든 README, apps/www·apps/docs 마케팅 카피에 산재.

## Solution

- 권리자/licensor: **Robota**(기존 브랜딩 일치). 상업 문의: robota.io / GitHub(전용 이메일은 추후 1줄 교체).
- SPDX: `AGPL-3.0-only OR LicenseRef-Commercial`.
- `LICENSE` = 듀얼 헤더 + **공식 AGPL-3.0 전문**(gnu.org 원문 661줄).
- `LICENSE-COMMERCIAL.md`(상업 라이선스 요약·문의) + `LICENSING.md`(듀얼 모델 설명) 신설.
- 전 package.json `license` 필드 + 모든 README License 섹션 + www/docs 마케팅 카피 갱신.

## Completion Criteria

- [x] TC-01: `LICENSE`가 AGPL-3.0 전문 + 듀얼/상업 헤더 포함
- [x] TC-02: 31개 package.json `license` = `AGPL-3.0-only OR LicenseRef-Commercial`
- [x] TC-03: 현재형 문서/마케팅의 "MIT" 참조 0건(LICENSING 역사설명·plans·CHANGELOG·v2.0.0 제외)
- [x] TC-04: 변경 JSON 유효 + `pnpm harness:scan` 통과

## Test Plan

| TC-ID | Test Type | Approach                          |
| ----- | --------- | --------------------------------- |
| TC-01 | Doc       | LICENSE 헤더 + AGPL 마커 확인     |
| TC-02 | Script    | 전 package.json license 일치 확인 |
| TC-03 | Grep      | 현재형 MIT 0건                    |
| TC-04 | Harness   | JSON 유효 + `pnpm harness:scan`   |

## User Execution Test Scenarios

Not applicable — 라이선스/문서/메타데이터 변경. 런타임 동작 무변경.

## Tasks

- [x] LICENSE/COMMERCIAL/LICENSING 작성 → package.json·README·www/docs 갱신 → 검증

## Evidence Log

### 구현 완료 — 2026-06-16

- **TC-01:** `LICENSE` = 듀얼 헤더(Copyright Robota, SPDX `AGPL-3.0-only OR LicenseRef-Commercial`,
  상업 라이선스 안내) + gnu.org 공식 **AGPL-3.0 전문**(661줄, curl 검증: 제목·버전·§13 마커). 679줄.
  `LICENSE-COMMERCIAL.md`·`LICENSING.md` 신설.
- **TC-02:** MIT 23개 surgical 치환 + 미설정 7개 추가 → **31개 전부** `AGPL-3.0-only OR LicenseRef-Commercial`.
- **TC-03:** README 9개 License 섹션, content/README 배지+표, apps/www en·ko(각 9곳), apps/www
  layout.tsx 메타데이터, apps/docs en·ko 배지, agent-cli README/README-KO, blog 글, CONTRIBUTING,
  publish.js README 템플릿 갱신 → 현재형 "MIT" **0건**(LICENSING 역사설명·docs/superpowers/plans·
  CHANGELOG·v2.0.0 동결 제외).
- **TC-04:** 변경 JSON(www/docs 메시지, package.json) 전부 유효, `pnpm harness:scan` **26/26 passed**.
- **후속(범위 외):** 발행 패키지 tarball에 LICENSE 전문 포함(현재 패키지별 LICENSE 파일 없음 +
  `files`에 미포함) — 발행 플로우 보강 후속 항목.

User Execution Test Scenario gate: Not applicable — 라이선스/문서 변경(런타임 무변경).
