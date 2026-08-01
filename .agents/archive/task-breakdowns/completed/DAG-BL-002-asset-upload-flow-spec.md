---
title: Asset 업로드 플로우 스펙 정리 및 구현
status: completed
created: 2026-03-15
priority: high
urgency: later
branch: fix/dag-asset-immediate-runtime-upload
---

## 문제

파일 선택 시 업로드가 즉시 일어나지만, 업로드 완료 여부를 사용자가 확인할 수 없고, 업로드 완료 전에 저장/새로고침하면 asset이 유실될 수 있음.

## 결정된 스펙

**파일 선택 즉시 runtime까지 업로드 완료한 후 config에 assetId 등록.**

1. 파일 선택 → 디자이너가 orchestrator에 업로드 요청
2. orchestrator가 로컬에 저장 + runtime에 즉시 전달 (파일 선택 시점에)
3. runtime 저장 완료 → orchestrator → 디자이너로 assetId 반환
4. 반환된 assetId를 config에 등록 (이때까지 업로드 프로그레스 표시)
5. 이렇게 하면 저장/새로고침/실행 시점에 관계없이 runtime에 파일이 이미 있음

## 현재 상태

- 파일 선택 → orchestrator `/v1/dag/assets`에 업로드 (orchestrator 로컬 저장만)
- 실행 시 `uploadAssetsToRuntime`이 orchestrator → runtime 전달
- 파일 선택과 실행 사이에 Save/새로고침하면 runtime에 파일이 없어서 실행 실패

## 관련 파일

- `packages/dag-designer/src/components/comfyui-field-renderers.tsx` (ComfyFileUploadField)
- `apps/dag-orchestrator-server/src/routes/run-routes.ts` (uploadAssetsToRuntime)
- `apps/dag-orchestrator-server/src/routes/asset-routes.ts` (asset CRUD)

## 검증

- [x] dag-orchestrator-server asset route contract test 추가
- [x] dag-orchestrator-server run route asset resolution test 추가
- [x] 관련 패키지 스펙 업데이트
- [x] 구현 완료 후 관련 패키지 빌드 성공 확인
- [x] 연관 유닛 테스트 통과 확인
- [x] typecheck 및 lint 에러 없음 확인

## 진행

### 2026-05-05

- `fix/dag-asset-immediate-runtime-upload` 브랜치에서 작업 시작.
- 추천안: DAG config에는 orchestrator assetId를 유지하고, runtime 업로드 결과는 asset metadata의 `runtimeAssetId`로 보관한다. 실행 시 prompt 제출 전 local assetId를 runtimeAssetId로 변환한다.
- asset route는 runtime 업로드 실패 시 asset을 저장하지 않고 `502 DAG_RUNTIME_ASSET_UPLOAD_FAILED`를 반환하도록 구현.
- run start는 metadata의 `runtimeAssetId`가 있으면 content를 다시 읽지 않고 prompt asset reference를 runtime assetId로 변환하도록 구현.

## 결정

- orchestrator assetId를 저장/검증 SSOT로 유지한다. runtime assetId를 config에 직접 저장하면 `/v1/dag/definitions`의 asset 검증과 로컬 content 조회 계약이 깨진다.
- `/v1/dag/assets`는 runtime 업로드까지 성공한 뒤에만 `201`을 반환한다. runtime 업로드 실패 시 config에 assetId가 등록되지 않도록 실패 응답을 반환한다.

## 결과

- `IStoredAssetMetadata`와 `ICreateAssetInput`에 `runtimeAssetId`를 추가해 orchestrator assetId와 runtime assetId를 분리했다.
- `/v1/dag/assets`가 runtime upload 성공 후에만 orchestrator asset을 저장하고 반환하도록 변경했다.
- run start에서 metadata의 `runtimeAssetId`를 사용해 prompt asset reference를 runtime assetId로 변환하도록 구현했다.
- asset route와 runtime asset resolution 계약 테스트를 추가했다.
- 검증: `pnpm build`, `pnpm harness:verify -- --base-ref origin/develop --skip-record-check`, targeted test/typecheck/lint/build 통과.
