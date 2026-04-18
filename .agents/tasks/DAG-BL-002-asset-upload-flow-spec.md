---
title: Asset 업로드 플로우 스펙 정리 및 구현
status: backlog
created: 2026-03-15
priority: high
urgency: later
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

- 구현 완료 후 관련 패키지 빌드 성공 확인
- 연관 유닛 테스트 통과 확인
- typecheck 및 lint 에러 없음 확인
