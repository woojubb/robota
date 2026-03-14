# Node Catalog: ComfyUI /object_info 기반으로 전환

## 개요

dag-designer의 Node Catalog을 기존 `INodeManifest` 기반에서 ComfyUI 호환 `/object_info` (=`INodeObjectInfo`) 기반으로 전환한다. Orchestrator가 런타임의 `/object_info`를 프록시하고, dag-designer가 이를 직접 소비한다.

## 아키텍처

```
dag-runtime-server (ComfyUI 호환)
    └── GET /object_info → TObjectInfo

dag-orchestrator-server
    └── GET /v1/dag/object_info → 런타임 /object_info 프록시 (신설)
    └── GET /v1/dag/nodes → 기존 INodeManifest (Phase 3에서 교체)

dag-designer
    └── 현재: INodeManifest 소비
    └── 변경: INodeObjectInfo 소비
```

## 구현 Phase

### Phase 1: Orchestrator에 `/v1/dag/object_info` 엔드포인트 신설

- orchestrator-server에 새 라우트 추가
- 런타임의 `/object_info`를 `PromptOrchestratorService.getObjectInfo()`로 프록시
- 응답 형태: `TObjectInfo` (= `Record<string, INodeObjectInfo>`) 그대로 반환

### Phase 2: dag-designer를 INodeObjectInfo 기반으로 리팩토링

- dag-designer의 카탈로그 관련 컴포넌트가 `INodeManifest` 대신 `INodeObjectInfo` 사용
- `designer-api-client.ts`의 `listNodeCatalog()`를 `/v1/dag/object_info` 호출로 변경
- `node-explorer-panel.tsx`: `INodeObjectInfo`의 `display_name`, `category` 사용
- `dag-designer-context.tsx`: manifests 타입 변경
- `canvas-utils.ts`: 노드 생성 시 `INodeObjectInfo` 기반으로 변환
- `node-config-panel.tsx`: input 필드 렌더링을 `INodeObjectInfo.input` 기반으로

### Phase 3: 기존 `/v1/dag/nodes` 제거 및 rename

- `/v1/dag/nodes` (INodeManifest 기반) 엔드포인트 제거
- `/v1/dag/object_info` → `/v1/dag/nodes`로 rename
- `BundledNodeCatalogService` 제거 (더 이상 필요 없음)
- 카탈로그에서 `INodeManifest` 사용 제거 완료

## 데이터 타입

카탈로그에서 사용할 타입 (dag-core에 이미 정의됨):

```typescript
interface INodeObjectInfo {
    display_name: string;
    category: string;
    input: {
        required: Record<string, TInputTypeSpec | string[]>;
        optional?: Record<string, TInputTypeSpec | string[]>;
        hidden?: Record<string, string>;
    };
    output: string[];
    output_is_list: boolean[];
    output_name: string[];
    output_node: boolean;
    description: string;
}

type TObjectInfo = Record<string, INodeObjectInfo>;
```

## 범위 제한

- `INodeManifest`는 카탈로그(UI)에서만 제거. 실행 파이프라인(dag-core의 lifecycle, executor)에서는 별도 이슈로 처리.
- `IPortDefinition`의 Robota 고유 필드(`binaryKind`, `mimeTypes`, `isList`)는 실행 검증에서 계속 사용됨.

## API Boundary 준수

- 런타임 API (`/object_info`) = ComfyUI 불변
- 오케스트레이터 API (`/v1/dag/object_info` → `/v1/dag/nodes`) = Robota 소유, ComfyUI 형식 채택
