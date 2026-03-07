# 현재 작업

## Priority 1
- [ ] 하네스 스크립트 회귀 테스트 추가
  - `record-owner-scenario` 실패 시 artifact 미작성 보장
  - clean checkout/PR 문맥에서 `--base-ref` 경로 검증
  - scenario-owning scope의 source/config 변경 시 기본 verify가 scenario를 포함하는지 검증

- [ ] DAG node runtime 분리 후속 검증 강화
  - `packages/dag-nodes/gemini-image-edit`와 `packages/dag-nodes/seedance-video`의 helper/runtime 분리 이후 회귀 테스트 보강
  - media reference, asset fetch, output normalization 경계 테스트 정리

## Priority 2
- [ ] 하네스 report 산출물 표준화
  - review/verify 결과를 비교 가능한 JSON schema로 고정
  - PR 체크/CI 업로드용 경로 규약 정리

- [ ] 레거시 skill 정리 (26개 → 목표 16개)
  - 통합 완료된 skill의 기존 파일 삭제 대상:
    - `scenario-guard-checklist`, `verification-guard` → `scenario-verification-harness`로 통합됨
    - `writing-language-guide`, `commit-message-guidance` → `repo-writing`으로 통합됨
    - `execution-cache-ops` → `execution-caching`으로 통합됨
  - 향후 통합 검토 대상:
    - `quality-standards` + `boundary-validation` → `type-boundary-and-ssot`
    - `import-standards` → AGENTS.md rule + architecture checklist로 흡수
    - `development-architecture-guidance` + `functional-core-imperative-shell` + `hexagonal-architecture-ts` + `ts-oop-di-patterns` → architecture-pattern 계열로 재편

- [ ] Policy Enforcement 하네스 스크립트 추가
  - `dependency-direction-check`: DAG 패키지 의존 방향 기계적 검출
  - `boundary-validation-check`: blind assertion, 금지 fallback 검출
  - `import-policy-check`: 허용 예외 없는 dynamic import 검출

## Priority 3
- [ ] Observability 하네스 (중장기)
  - `collect-run-context.mjs`: strict-policy 에러 수집, ownerPath 흐름 요약
  - scenario verify 산출물 인덱스
  - 구조적 로그 수집 기준 정의

- [ ] App Boot 하네스 (낮은 우선순위)
  - `harness:bootstrap -- web`: env check + health check
  - `harness:bootstrap -- api-server`: ready signal 확인

- [ ] Agents 패키지 추가 개선
  - 플러그인 실행 순서 검증 로직
  - 이벤트 계층 추적 필드 추가 (depth, spanId)
