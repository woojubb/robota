# INFRA-BL-005: apps/docs 빌드 다이어트

## Status: ready

## Problem

apps/docs 빌드 출력이 556MB. 빌드 시간이 과도하게 길음.

## Root Cause Analysis

| 원인                      | 크기   | 비율 | 설명                                                       |
| ------------------------- | ------ | ---- | ---------------------------------------------------------- |
| TypeDoc API reference     | 373 MB | 67%  | 31개 패키지의 TypeDoc HTML. 711 마크다운 → 2,193 HTML 변환 |
| v2.0.0 레거시 문서        | 123 MB | 22%  | content/v2.0.0/ — 네비게이션에도 없는 죽은 문서            |
| 빌드 전 전체 pnpm install | 시간   | -    | prepare-docs.js가 `pnpm install` 먼저 실행                 |
| TypeDoc 전체 스캔         | 시간   | -    | 31개 패키지 소스 스캔 후 마크다운 생성                     |
| 비증분 빌드               | 시간   | -    | 매번 전체 .temp/ 복사 + 전체 빌드                          |

## Tasks

### 1. v2.0.0 레거시 문서 삭제

- `content/v2.0.0/` 디렉토리 삭제 (312 파일, 2.4MB 소스 → 123MB 빌드)
- 미배포 프로젝트에 버전별 문서는 불필요
- 예상 효과: 빌드 출력 -123MB (22% 감소)

### 2. TypeDoc API reference 제거

- `scripts/docs/docs-generator.js` — TypeDoc 마크다운 생성 제거
- `content/api-reference/` 디렉토리 삭제 (711 파일, 3.7MB 소스 → 373MB 빌드)
- `typedoc.json` 설정 파일 제거
- `prepare-docs.js`에서 `pnpm typedoc:convert` 호출 제거
- 예상 효과: 빌드 출력 -373MB (67% 감소), 빌드 시간 대폭 단축

### 3. prepare-docs.js 간소화

- `pnpm install` 호출 제거 (이미 설치되어 있음)
- TypeDoc 단계 제거 후 직접 `vitepress build` 호출
- copy-docs.js와 통합 검토

### 4. VitePress config 정리

- v2.0.0 관련 rewrite/sidebar 규칙 제거
- api-reference 관련 sidebar 규칙 제거
- 불필요한 SEO 메타태그 정리 (280줄+)

### 5. 검증

- `pnpm docs:build` 실행하여 빌드 성공 확인
- 빌드 출력 크기 비교 (목표: 556MB → ~60MB)
- robota.io 배포 후 페이지 정상 확인

## Expected Result

- 빌드 출력: 556MB → ~60MB (89% 감소)
- 빌드 시간: TypeDoc 스캔 + pnpm install 제거로 대폭 단축
- 소스 파일: 1,005개 → ~280개
