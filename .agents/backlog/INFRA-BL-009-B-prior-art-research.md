---
title: 'INFRA-BL-009-B: 빌드 도구 마이그레이션 Prior Art Research 및 Decision Matrix'
status: todo
created: 2026-05-15
priority: medium
urgency: soon
area: .agents/tasks/INFRA-BL-009-build-tool-migration.md
depends_on:
  - INFRA-BL-009-A
---

## 배경

`research.md` §Research-First 규칙에 따라 구현 전 외부 레퍼런스와 비교 조사가 필요하다. 현재 INFRA-BL-009는 버전 스냅샷 수준의 조사만 있으며, 실제 의사결정 근거가 될 비교 데이터가 없다.

## 조사 목표

### 필수 조사 항목

1. **tsdown `outExtensions` API 검증**
   - URL: https://tsdown.dev/reference/api/interface.userconfig
   - 확인 항목: `outExtensions.dts` 키 지원 여부 (`.d.mts` → `.d.ts` 강제 가능한지)
   - 확인 항목: `outDir` 하위 경로 구조 유지 가능한지 (`dist/node/`, `dist/browser/`)

2. **unbuild browser/node dual 빌드 지원 확인**
   - URL: https://github.com/unjs/unbuild
   - 확인 항목: browser/node 분리 빌드 공식 지원 여부
   - 확인 항목: DTS 확장자 기본값 (`.d.ts` vs `.d.mts`)
   - 확인 항목: `outDir` 하위 경로 구조 제어 가능한지

3. **tsdown DTS-only 빌드 플래그 확인**
   - 현재 `tsup --dts-only`로 DTS 분리 빌드 수행
   - tsdown 대응 플래그 또는 config 옵션 존재 여부
   - 없을 경우 `build-types-ordered.mjs` 유지 전략

4. **tsup 8.5.x 실질적 유지보수 수준 재평가**
   - GitHub: https://github.com/egoist/tsup
   - 확인 항목: 최근 6개월 이슈 대응 현황
   - 확인 항목: 알려진 critical bug 목록
   - 확인 항목: 모노레포 DTS 관련 미해결 이슈

5. **동일 규모 모노레포 빌드 도구 사례 조사**
   - 대상: tRPC, Radix UI, Effect, Zod v4 (100개 이상 패키지 모노레포)
   - 확인 항목: 사용 도구, 선택 근거, dual 빌드 전략

### 결과물

- `## Prior Art Research` 섹션 → INFRA-BL-009 태스크 파일에 반영
- `## Decision Matrix` 추가:

  | 기준                   | 가중치 | tsdown          | unbuild | tsup 유지 |
  | ---------------------- | ------ | --------------- | ------- | --------- |
  | 1.0 안정성             | 높음   | ?               | O       | O         |
  | browser dual 빌드      | 높음   | ?               | ?       | O         |
  | outExtensions 제어     | 높음   | O (API 있음)    | ?       | O         |
  | DTS-only 빌드          | 높음   | ?               | ?       | O         |
  | tsup 마이그레이션 비용 | 중간   | 낮음            | 중간    | N/A       |
  | 빌드 성능              | 중간   | 높음 (Rolldown) | 중간    | 낮음      |
  | 모노레포 native 지원   | 중간   | ?               | ?       | 없음      |

## Test Plan

- [ ] 각 조사 항목에 대한 공식 문서 링크 및 증거 기록
- [ ] Decision Matrix 완성 (빈 칸 없음)
- [ ] 권장 도구 1개 선정 및 근거 기술
- [ ] INFRA-BL-009 태스크 파일 `## Prior Art Research` 섹션 갱신

## User Execution Test Scenarios

Not applicable — 조사 결과 문서화이며 runnable user-facing behavior를 변경하지 않는다.
