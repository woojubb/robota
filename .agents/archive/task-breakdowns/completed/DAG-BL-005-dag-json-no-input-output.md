---
title: DAG JSON에서 input/output 제거 — objectInfo에서 참조
status: completed
created: 2026-03-15
updated: 2026-05-05
priority: high
urgency: later
---

## 문제

노드를 새로 추가할 때 `createNodeFromObjectInfo()`가 input/output port 정의를 DAG JSON에 복사함. 이러면:

- DAG JSON에 runtime 노드 정의가 중복 저장
- runtime의 노드 정의와 DAG JSON의 port 정의가 불일치할 수 있음
- input/output은 runtime이 SSOT — 오케스트레이션에서 재정의 불가

## 기대 동작

- [x] DAG JSON에는 `nodeId`, `nodeType`, `config`, `position`, `dependsOn`만 저장
- [x] input/output은 브라우저의 `objectInfo` state에서 참조 (이미 `/object_info` API로 로드됨)
- [x] UI 렌더링 시 `objectInfo[nodeType]`에서 port 정의를 가져와서 표시

## 영향 범위

- [x] `createNodeFromObjectInfo()` — inputs/outputs 생성 제거
- [x] `createNodeFromManifest()` — manifest ports를 DAG JSON에 복사하지 않음
- [x] `dag-designer-canvas.tsx` — 노드 렌더링 시 runtime port projection 참조
- [x] `dag-node-view.tsx` — port 표시를 runtime projection 기반으로 유지
- [x] `dag-designer-context.tsx` — edge 연결 검증 시 runtime port projection 참조
- [x] `definition-to-prompt-translator.ts` — DAG에 port 정의가 없어도 동작해야 함
- [x] `DagDefinitionValidator` — node-local ports가 없는 DAG 정의를 허용하고, ports가 제공된 경우에만 port existence/type 검증

## 검증

- [x] `pnpm --filter @robota-sdk/dag-core test`
- [x] `pnpm --filter @robota-sdk/dag-designer test`
- [x] `pnpm --filter @robota-sdk/dag-orchestrator test`
- [x] `pnpm --filter @robota-sdk/dag-core typecheck && pnpm --filter @robota-sdk/dag-designer typecheck && pnpm --filter @robota-sdk/dag-orchestrator typecheck && pnpm --filter @robota-sdk/dag-studio typecheck`
- [x] `pnpm --filter @robota-sdk/dag-core lint && pnpm --filter @robota-sdk/dag-designer lint && pnpm --filter @robota-sdk/dag-orchestrator lint && pnpm --filter @robota-sdk/dag-studio lint`
- [x] `pnpm --filter @robota-sdk/dag-core build && pnpm --filter @robota-sdk/dag-designer build && pnpm --filter @robota-sdk/dag-orchestrator build && pnpm --filter @robota-sdk/dag-studio build`
- [x] `pnpm harness:scan:specs`
- [x] `pnpm docs:build`
- [x] `git diff --check`

## 결과

- Persisted DAG JSON mutation paths now strip `node.inputs` and `node.outputs`.
- Designer rendering/editing uses `definitionWithRuntimePorts`, enriched from `objectInfo` first, manifest second, and legacy node-local ports only as a compatibility fallback.
- Core validation accepts no-port persisted DAG definitions while preserving strict port validation when catalogs are present.
