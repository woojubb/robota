# 노드 상태 통합 (nodeStateMap) 설계

## 개요

dag-designer context에 분산되어 있는 3개의 노드 상태(`pendingOperations`, `nodeUiStateByNodeId`, `liveNodeTraceByNodeId`)를 하나의 `nodeStateMap`으로 통합한다. 노드 상태는 클라이언트에서 소유하며, DAG JSON에 저장하지 않는다.

## 현재 상태 (분산)

```
pendingOperations: Map<nodeId, string>              // 업로드 등 부수작업
nodeUiStateByNodeId: Record<nodeId, INodeUiState>   // 실행 상태 (idle/running/success/failed)
liveNodeTraceByNodeId: Record<nodeId, IDagNodeIoTrace>  // I/O 결과
```

## 목표 상태 (통합)

```
nodeStateMap: Record<nodeId, INodeState>
```

## INodeState 인터페이스

```typescript
interface INodeState {
    // 통합 상태
    operationStatus: 'idle' | 'uploading' | 'running' | 'success' | 'failed';

    // 부수작업 (업로드 등)
    pendingDescription?: string;

    // 실행 결과 (리셋/재활용 가능, DAG JSON에 저장 안 됨)
    trace?: IDagNodeIoTrace;

    // 선택 상태 (UI용)
    isSelected: boolean;
}
```

## 상태 전이

```
idle → uploading       (파일 선택 → 업로드 시작)
uploading → idle       (업로드 완료 또는 실패)
idle → running         (Run 시작, task.started 이벤트)
running → success      (task.completed 이벤트)
running → failed       (task.failed 이벤트)
success/failed → idle  (리셋)
```

## isRunnable 조건

```typescript
const isRunnable = Object.values(nodeStateMap)
    .every(s => s.operationStatus !== 'uploading');
```

`uploading` 상태인 노드가 하나라도 있으면 Run 불가.

## 매핑 (기존 → 통합)

| 기존 상태 | 통합 후 |
|----------|--------|
| `pendingOperations.has(id)` | `nodeStateMap[id].operationStatus === 'uploading'` |
| `pendingOperations.get(id)` | `nodeStateMap[id].pendingDescription` |
| `nodeUiStateByNodeId[id].executionStatus` | `nodeStateMap[id].operationStatus` |
| `nodeUiStateByNodeId[id].isSelected` | `nodeStateMap[id].isSelected` |
| `liveNodeTraceByNodeId[id]` | `nodeStateMap[id].trace` |
| `hasPendingOperations` | `!isRunnable` |

## 액션

```typescript
// 부수작업
setNodeUploading(nodeId: string, description: string): void;
setNodeUploadDone(nodeId: string): void;

// 실행 상태 (progress event에서 호출)
setNodeRunning(nodeId: string): void;
setNodeSuccess(nodeId: string, trace?: IDagNodeIoTrace): void;
setNodeFailed(nodeId: string, trace?: IDagNodeIoTrace): void;

// 리셋
resetNodeState(nodeId: string): void;    // 단일 노드
resetAllNodeStates(): void;              // 전체 리셋 (새 Run 시작 시)

// 선택
setSelectedNodeId(nodeId?: string): void;
```

## 영향 범위

| 파일 | 변경 |
|------|------|
| `dag-designer-context.tsx` | 3개 상태를 `nodeStateMap`으로 통합, 액션 함수 교체 |
| `use-dag-designer-state.ts` | 인터페이스 업데이트 |
| `dag-node-view.tsx` | `executionStatus`를 `nodeStateMap`에서 참조 |
| `dag-designer-canvas.tsx` | node data에 `operationStatus` 전달 |
| `dag-designer-panels.tsx` | `pendingOperations` 대신 `nodeStateMap` 사용 |
| `node-config-panel.tsx` | `pendingOperationDescription` 대신 `nodeStateMap[id].pendingDescription` |
| `comfyui-field-renderers.tsx` | `onPendingOperation` → `setNodeUploading` |
| `dag-designer-screen.tsx` | `hasPendingOperations` → `!isRunnable` |

## 원칙

- **노드 상태는 클라이언트에서 소유** — DAG JSON에 저장하지 않음
- **실행 결과는 리셋/재활용 가능** — 추후 partial run에서 활용
- **노드 종류 무관 공통 상태** — 모든 노드가 동일한 INodeState 구조
- **오케스트레이션이 지휘** — 상태를 기반으로 Run 가능 여부 판단
