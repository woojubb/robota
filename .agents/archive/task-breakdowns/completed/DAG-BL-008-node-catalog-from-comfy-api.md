---
title: Node Catalog을 ComfyUI API 기반으로 가져오기
status: completed
urgency: later
created: 2026-03-15
branch: feat/dag-object-info-catalog
completed: 2026-05-05
---

## 요약

dag-designer 왼쪽 사이드바의 Node Catalog 목록을 ComfyUI `/object_info` API에서 가져와서 카테고리별로 분류하여 표시.

## 요구사항

1. **ComfyUI API → Orchestrator → Web 흐름**
   - apps/web이 ComfyUI에 직접 요청하지 않음
   - Orchestrator가 ComfyUI `/object_info` API에서 노드 목록을 가져옴
   - Orchestrator API를 통해 apps/web에 제공

2. **확인 필요 사항**
   - ComfyUI `/object_info` 응답에서 노드 목록을 가져올 수 있는지 확인
   - 카테고리별 분류가 가능한지 (`category` 필드 존재 여부)
   - 현재 하드코딩된 노드 카탈로그를 API 기반으로 교체

3. **현재 상태**
   - 현재 `BundledNodeCatalogService`가 서버에 등록된 노드만 반환
   - ComfyUI `/object_info`에서 `INodeObjectInfo.category` 필드 존재 (리서치에서 확인됨)

## 추천안

- `dag-api`의 node catalog 계약을 `INodeManifest[]`가 아니라 `TObjectInfo` 중심으로 정리한다.
- `apps/dag-orchestrator-server`는 `/v1/dag/nodes`에서 controller를 우회하지 않고, runtime `/object_info`를 읽는 catalog service를 `createDagControllerComposition`에 주입한다.
- Web/dag-designer는 계속 orchestrator API만 호출하고, 카테고리 분류는 기존 `NodeExplorerPanel`의 `INodeObjectInfo.category` 기반 UI를 유지한다.
- 기존 manifest 기반 catalog service는 runtime 테스트/호환용으로 `TObjectInfo`를 생성하는 adapter 형태로 남긴다.

## 검증

- `pnpm --filter @robota-sdk/dag-api test`
- `pnpm --filter @robota-sdk/dag-api typecheck`
- `pnpm --filter @robota-sdk/dag-api lint` (existing warnings only)
- `pnpm --filter @robota-sdk/dag-orchestrator-server test`
- `pnpm --filter @robota-sdk/dag-orchestrator-server typecheck`
- `pnpm --filter @robota-sdk/dag-orchestrator-server lint` (existing warnings only)
- `pnpm --filter @robota-sdk/dag-orchestrator-server build`
- `pnpm --filter @robota-sdk/dag-runtime-server test`
- `pnpm --filter @robota-sdk/dag-runtime-server typecheck`
- `pnpm --filter @robota-sdk/dag-runtime-server lint` (existing warnings only)
- `pnpm --filter @robota-sdk/dag-runtime-server build`
- `pnpm --filter @robota-sdk/dag-designer test`
- `pnpm --filter @robota-sdk/dag-designer typecheck`
