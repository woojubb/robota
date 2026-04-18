---
title: Node Catalog을 ComfyUI API 기반으로 가져오기
status: backlog
urgency: later
created: 2026-03-15
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

## 검증

- 구현 완료 후 관련 패키지 빌드 성공 확인
- 연관 유닛 테스트 통과 확인
- typecheck 및 lint 에러 없음 확인
