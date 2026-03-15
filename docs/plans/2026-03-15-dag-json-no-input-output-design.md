# DAG JSON에서 input/output 제거 — objectInfo 참조 설계

## 개요

DAG JSON의 `IDagNode`에서 `inputs[]`/`outputs[]` 필드를 제거하고, UI 렌더링과 edge 연결 시 `objectInfo[nodeType]`에서 port 정의를 실시간 참조한다. input/output은 runtime이 SSOT이며 오케스트레이션에서 재정의할 수 없다.

## 핵심 변경

```
현재: IDagNode = { nodeId, nodeType, config, position, dependsOn, inputs[], outputs[] }
목표: IDagNode = { nodeId, nodeType, config, position, dependsOn }
```

## 데이터 흐름

```
/object_info API → objectInfo state (브라우저 메모리)
                      ↓
노드 추가: nodeType만 DAG에 저장
                      ↓
UI 렌더링: objectInfo[nodeType]에서 port 정보 참조하여 Handle 렌더링
                      ↓
Edge 연결: objectInfo에서 port key 조회 → edge binding 생성 (기존 UX 유지)
                      ↓
Prompt 변환: edge binding의 key를 그대로 사용 (port 정의 불필요)
```

## UX

핸들 연결 UX는 기존과 동일하게 유지. ReactFlow Handle 컴포넌트의 데이터 소스만 `node.inputs` → `objectInfo[node.nodeType]`로 변경.

## 영향 범위

| 파일 | 변경 |
|------|------|
| `dag-core/types/domain.ts` | `IDagNode.inputs`, `outputs` optional로 변경 |
| `canvas-utils.ts` | `createNodeFromObjectInfo()` — inputs/outputs 생성 제거 |
| `dag-node-view.tsx` | props에서 objectInfo 참조하여 port 렌더링 |
| `dag-designer-context.tsx` | `addNodeFromObjectInfo()` — inputs/outputs 없이 노드 생성, objectInfo를 노드 뷰에 전달 |
| `dag-designer-panels.tsx` | port 표시 시 objectInfo 참조 |
| `node-config-panel.tsx` | port section에 objectInfo 기반 port 전달 |
| `definition-to-prompt-translator.ts` | port 정의 없이 edge binding만으로 prompt 변환 |

## ComfyUI 호환성

- ComfyUI prompt JSON은 input key당 1개 링크만 허용
- 우리의 list port (`images[0]`, `images[1]`)는 ComfyUI의 동적 슬롯 패턴과 동일
- 상세 리서치: `.design/dag-benchmark/12-comfyui-dynamic-inputs-research.md`
