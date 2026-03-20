---
title: DAG JSON에서 input/output 제거 — objectInfo에서 참조
status: backlog
created: 2026-03-15
priority: high
---

## 문제

노드를 새로 추가할 때 `createNodeFromObjectInfo()`가 input/output port 정의를 DAG JSON에 복사함. 이러면:
- DAG JSON에 runtime 노드 정의가 중복 저장
- runtime의 노드 정의와 DAG JSON의 port 정의가 불일치할 수 있음
- input/output은 runtime이 SSOT — 오케스트레이션에서 재정의 불가

## 기대 동작

- DAG JSON에는 `nodeId`, `nodeType`, `config`, `position`, `dependsOn`만 저장
- input/output은 브라우저의 `objectInfo` state에서 참조 (이미 `/object_info` API로 로드됨)
- UI 렌더링 시 `objectInfo[nodeType]`에서 port 정의를 가져와서 표시

## 영향 범위

- `createNodeFromObjectInfo()` — inputs/outputs 생성 제거
- `dag-designer-canvas.tsx` — 노드 렌더링 시 objectInfo 참조
- `dag-node-view.tsx` — port 표시를 objectInfo 기반으로
- `dag-designer-context.tsx` — edge 연결 검증 시 objectInfo 참조
- `definition-to-prompt-translator.ts` — DAG에 port 정의가 없어도 동작해야 함
