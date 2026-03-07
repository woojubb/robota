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
- [ ] `.design/tmp/` 문서 정리
  - 정식 owner 문서로 승격할 내용 선별
  - 더 이상 필요 없는 임시 메모 삭제

- [ ] 하네스 report 산출물 표준화
  - review/verify 결과를 비교 가능한 JSON schema로 고정
  - PR 체크/CI 업로드용 경로 규약 정리
