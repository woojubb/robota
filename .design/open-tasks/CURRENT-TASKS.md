# 현재 작업

## Priority 1
- [x] 하네스 스크립트 회귀 테스트 추가
  - `scripts/harness/__tests__/harness-scripts.test.mjs` (38 tests)
  - parseScopeArgs, classifyScopeChanges, mapFilesToScopes, resolveRequestedScopes 검증

- [x] DAG node runtime 분리 후속 검증 강화
  - gemini-image-edit: runtime-helpers 순수 함수 테스트 (parseCsv, resolveRuntimeBaseUrl, resolveModel, normalizeImageOutput, isImageBinaryValue)
  - seedance-video: runtime-helpers 순수 함수 테스트 (resolveRuntimeBaseUrl, toOutputVideo)

## Priority 2
- [x] 하네스 report 산출물 표준화
  - verify-change.mjs, cleanup-drift.mjs 모두 `--report-file` JSON 출력 지원
  - JSON schema: `{ type, timestamp, ..., passed }`

- [x] 레거시 skill 정리 (36개 → 29개)
  - 삭제 완료: scenario-guard-checklist, verification-guard, writing-language-guide, commit-message-guidance, execution-cache-ops, import-standards, development-architecture-guidance
  - AGENTS.md Skills Reference 업데이트 완료

- [x] Policy Enforcement 하네스 스크립트 추가
  - cleanup-drift.mjs에 boundary-validation-check 통합 (`as any`, `as unknown as` 검출)
  - dependency-direction-check 기존 통합
  - dynamic import 검출 기존 통합

## Priority 3
- [x] Observability 하네스 (중장기)
  - `collect-run-context.mjs`: strict-policy 에러, ownerPath, scenario artifact, event prefix 수집
  - `pnpm harness:run-context` 등록 완료

- [x] App Boot 하네스
  - `scripts/harness/bootstrap.mjs`: 앱 빌드 검증
  - `pnpm harness:bootstrap` 등록 완료

- [ ] Agents 패키지 추가 개선 (향후)
  - 플러그인 실행 순서 검증 로직
  - 이벤트 계층 추적 필드 추가 (depth, spanId)

## 향후 통합 검토 대상
- `quality-standards` + `boundary-validation` → `type-boundary-and-ssot`
- `functional-core-imperative-shell` + `hexagonal-architecture-ts` + `ts-oop-di-patterns` → architecture-pattern 계열로 재편
