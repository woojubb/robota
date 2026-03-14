# Node Catalog: /object_info 기반 전환 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** dag-designer의 Node Catalog을 ComfyUI 호환 `/object_info` (`INodeObjectInfo`) 기반으로 전환하여, orchestrator가 런타임 노드 목록을 프록시하고 dag-designer가 이를 직접 소비하도록 한다.

**Architecture:** orchestrator에 `/v1/dag/object_info` 엔드포인트 신설 → dag-designer를 `INodeObjectInfo` 기반으로 리팩토링 → 기존 `/v1/dag/nodes` 제거 후 rename.

**Tech Stack:** TypeScript, Express, React, Vitest

**Design Doc:** `docs/plans/2026-03-15-node-catalog-object-info-design.md`

---

## Phase 1: Orchestrator에 `/v1/dag/object_info` 엔드포인트 신설

### Task 1: `/v1/dag/object_info` 엔드포인트 추가

**Files:**
- Modify: `apps/dag-orchestrator-server/src/routes/definition-routes.ts:112-117`
- Modify: `apps/dag-orchestrator-server/src/server.ts` (orchestrator 인스턴스를 라우트에 전달)

**Step 1: Read current definition-routes.ts**

현재 `/v1/dag/nodes` 엔드포인트와 동일한 패턴으로 `/v1/dag/object_info` 추가.

**Step 2: Add endpoint**

`definition-routes.ts`에 새 엔드포인트 추가. `PromptOrchestratorService`의 `getObjectInfo()`를 호출하여 `TObjectInfo`를 반환.

```typescript
router.get('/v1/dag/object_info', async (req: Request, res: Response) => {
    const result = await orchestrator.getObjectInfo();
    if (!result.ok) {
        res.status(502).json({ error: result.error });
        return;
    }
    res.json({ ok: true, status: 200, data: result.value });
});
```

주의: `definition-routes.ts`의 factory 함수가 `orchestrator` (PromptOrchestratorService)를 인자로 받아야 함. 현재는 `designController`와 `assetStore`만 받고 있으므로 확인 후 필요시 `server.ts`에서 라우트 등록 방식 조정.

대안: `server.ts`에 직접 추가 (기존 `/object_info` 프록시 라우트 옆에).

**Step 3: Run tests**

Run: `pnpm --filter dag-orchestrator-server test`
Expected: All pass

**Step 4: Commit**

```bash
git add apps/dag-orchestrator-server/
git commit -m "feat(dag-orchestrator-server): add /v1/dag/object_info endpoint"
```

---

## Phase 2: dag-designer를 INodeObjectInfo 기반으로 리팩토링

### Task 2: designer-api-client에 `listObjectInfo()` 메서드 추가

**Files:**
- Modify: `packages/dag-designer/src/contracts/designer-api.ts:77`
- Modify: `packages/dag-designer/src/client/designer-api-client.ts:181-198`

**Step 1: Add method to contract interface**

`designer-api.ts`의 `IDesignerApiClient`에 추가:
```typescript
listObjectInfo(): Promise<TResult<TObjectInfo, IProblemDetails[]>>;
```

Import `TObjectInfo` from `@robota-sdk/dag-core`.

**Step 2: Implement in designer-api-client.ts**

```typescript
public async listObjectInfo(): Promise<TResult<TObjectInfo, IProblemDetails[]>> {
    const path = '/v1/dag/object_info';
    const payloadResult = await this.requestPayload(path, 'GET', undefined);
    if (!payloadResult.ok) {
        return payloadResult;
    }
    const data = payloadResult.value.data;
    if (data && typeof data === 'object') {
        return { ok: true, value: data as TObjectInfo };
    }
    return { ok: false, error: [createContractViolationProblem(200, path)] };
}
```

**Step 3: Run typecheck**

Run: `pnpm --filter @robota-sdk/dag-designer typecheck`

**Step 4: Commit**

```bash
git add packages/dag-designer/
git commit -m "feat(dag-designer): add listObjectInfo() to designer API client"
```

---

### Task 3: dag-designer-context에서 manifests → objectInfo 타입 전환

**Files:**
- Modify: `packages/dag-designer/src/components/dag-designer-context.tsx`
- Modify: `packages/dag-designer/src/hooks/use-dag-designer-state.ts`

**Step 1: Update context props and state**

`dag-designer-context.tsx`:
- `IDagDesignerRootProps.manifests: INodeManifest[]` → `objectInfo: TObjectInfo`
- `IDagDesignerStateValue.manifests: INodeManifest[]` → `objectInfo: TObjectInfo`
- `addNodeFromManifest(manifest: INodeManifest)` → `addNodeFromObjectInfo(nodeType: string, info: INodeObjectInfo)`

Import `TObjectInfo`, `INodeObjectInfo` from `@robota-sdk/dag-core`.

**Step 2: Update addNodeFromManifest → addNodeFromObjectInfo**

```typescript
const addNodeFromObjectInfo = useCallback((nodeType: string, info: INodeObjectInfo): void => {
    const def = definitionRef.current;
    const nextNode = createNodeFromObjectInfo(nodeType, info, def.nodes.length);
    setBindingCleanupMessage(undefined);
    resetRunProgress();
    onDefinitionChangeRef.current({
        ...def,
        nodes: [...def.nodes, nextNode]
    });
}, []);
```

**Step 3: Update use-dag-designer-state.ts**

`IDagDesignerState.manifests: INodeManifest[]` → `objectInfo: TObjectInfo`

**Step 4: Run typecheck** (will have many errors — that's expected, fixed in next tasks)

**Step 5: Commit**

```bash
git add packages/dag-designer/
git commit -m "refactor(dag-designer): change context from INodeManifest to TObjectInfo"
```

---

### Task 4: canvas-utils — createNodeFromObjectInfo

**Files:**
- Modify: `packages/dag-designer/src/components/canvas-utils.ts:138-148`

**Step 1: Replace createNodeFromManifest with createNodeFromObjectInfo**

```typescript
export function createNodeFromObjectInfo(
    nodeType: string,
    info: INodeObjectInfo,
    index: number
): IDagNode {
    const inputs: IPortDefinition[] = [];
    const outputs: IPortDefinition[] = [];

    // Convert INodeObjectInfo outputs to IPortDefinition[]
    for (let i = 0; i < info.output.length; i++) {
        outputs.push({
            key: info.output_name[i] ?? info.output[i] ?? `output_${i}`,
            label: info.output_name[i] ?? info.output[i],
            order: i,
            type: mapComfyTypeToPortType(info.output[i] ?? 'string'),
            required: true,
            isList: info.output_is_list[i] ?? false,
        });
    }

    // Convert INodeObjectInfo required inputs to IPortDefinition[]
    if (info.input.required) {
        let order = 0;
        for (const [key, spec] of Object.entries(info.input.required)) {
            const typeName = Array.isArray(spec) ? (typeof spec[0] === 'string' ? spec[0] : 'string') : 'string';
            inputs.push({
                key,
                label: key,
                order: order++,
                type: mapComfyTypeToPortType(typeName),
                required: true,
            });
        }
    }

    return {
        nodeId: `${nodeType}_${index + 1}`,
        nodeType,
        position: { x: 120 + (index % 3) * 260, y: 100 + Math.floor(index / 3) * 180 },
        dependsOn: [],
        config: {},
        inputs,
        outputs,
    };
}

function mapComfyTypeToPortType(comfyType: string): TPortValueType {
    const upper = comfyType.toUpperCase();
    if (upper === 'INT' || upper === 'FLOAT') return 'number';
    if (upper === 'STRING') return 'string';
    if (upper === 'BOOLEAN' || upper === 'BOOL') return 'boolean';
    if (upper === 'IMAGE' || upper === 'MASK' || upper === 'VIDEO' || upper === 'AUDIO') return 'binary';
    if (upper === 'LATENT' || upper === 'MODEL' || upper === 'CLIP' || upper === 'VAE' || upper === 'CONDITIONING') return 'object';
    return 'object'; // Unknown ComfyUI types → object
}
```

`createNodeFromManifest`는 제거하지 않고 deprecated 처리 (Phase 3에서 제거).

**Step 2: Update tests**

`canvas-utils.test.ts`에 `createNodeFromObjectInfo` 테스트 추가.

**Step 3: Run tests**

Run: `pnpm --filter @robota-sdk/dag-designer test`

**Step 4: Commit**

```bash
git add packages/dag-designer/
git commit -m "feat(dag-designer): add createNodeFromObjectInfo with ComfyUI type mapping"
```

---

### Task 5: node-explorer-panel — INodeObjectInfo 기반으로 전환

**Files:**
- Modify: `packages/dag-designer/src/components/node-explorer-panel.tsx`

**Step 1: Change props**

```typescript
// Before
manifests: INodeManifest[];
onAddNode: (manifest: INodeManifest) => void;

// After
objectInfo: TObjectInfo;
onAddNode: (nodeType: string, info: INodeObjectInfo) => void;
```

**Step 2: Update category mapping**

```typescript
const categoryMap = useMemo(() => {
    const map = new Map<string, Array<{ nodeType: string; info: INodeObjectInfo }>>();
    for (const [nodeType, info] of Object.entries(props.objectInfo)) {
        const category = info.category || 'uncategorized';
        const current = map.get(category) ?? [];
        current.push({ nodeType, info });
        map.set(category, current);
    }
    return map;
}, [props.objectInfo]);
```

**Step 3: Update rendering**

- `manifest.displayName` → `entry.info.display_name`
- `manifest.nodeType` → `entry.nodeType`
- `manifest.category` → `entry.info.category`
- `onAddNode(manifest)` → `onAddNode(entry.nodeType, entry.info)`

**Step 4: Commit**

```bash
git add packages/dag-designer/
git commit -m "refactor(dag-designer): node-explorer-panel uses INodeObjectInfo"
```

---

### Task 6: node-config-panel — configSchema 대신 INodeObjectInfo.input 사용

**Files:**
- Modify: `packages/dag-designer/src/components/node-config-panel.tsx`

**Step 1: Change props**

```typescript
// Before
manifest?: INodeManifest;

// After
nodeObjectInfo?: INodeObjectInfo;
```

**Step 2: Update config form rendering**

`manifest?.configSchema` → `nodeObjectInfo?.input` 기반으로 변경. ComfyUI의 `input.required`/`input.optional` 구조를 사용하여 config 폼 필드를 렌더링.

**Step 3: Commit**

```bash
git add packages/dag-designer/
git commit -m "refactor(dag-designer): node-config-panel uses INodeObjectInfo"
```

---

### Task 7: dag-designer-panels — 연결 레이어 업데이트

**Files:**
- Modify: `packages/dag-designer/src/components/dag-designer-panels.tsx`

**Step 1: Update manifest references**

```typescript
// Before
<NodeExplorerPanel manifests={context.manifests} onAddNode={context.addNodeFromManifest} />

// After
<NodeExplorerPanel objectInfo={context.objectInfo} onAddNode={context.addNodeFromObjectInfo} />
```

```typescript
// Before
const selectedManifest = context.manifests.find(m => m.nodeType === selectedNode?.nodeType);
<NodeConfigPanel manifest={selectedManifest} />

// After
const selectedNodeInfo = selectedNode ? context.objectInfo[selectedNode.nodeType] : undefined;
<NodeConfigPanel nodeObjectInfo={selectedNodeInfo} />
```

**Step 2: Commit**

```bash
git add packages/dag-designer/
git commit -m "refactor(dag-designer): update panels wiring for INodeObjectInfo"
```

---

### Task 8: hooks + index.ts 업데이트 및 빌드 확인

**Files:**
- Modify: `packages/dag-designer/src/hooks/use-dag-design-api.ts`
- Modify: `packages/dag-designer/src/index.ts`

**Step 1: Update use-dag-design-api.ts**

`listNodeCatalog` → `listObjectInfo` (또는 둘 다 유지하고 `listObjectInfo` 추가).

**Step 2: Update index.ts exports**

필요시 `TObjectInfo`, `INodeObjectInfo` re-export 추가.

**Step 3: Build and test**

Run: `pnpm --filter @robota-sdk/dag-designer build && pnpm --filter @robota-sdk/dag-designer test`
Expected: All pass

**Step 4: Commit**

```bash
git add packages/dag-designer/
git commit -m "refactor(dag-designer): update hooks and exports for INodeObjectInfo"
```

---

### Task 9: apps/web — catalogNodes를 TObjectInfo로 전환

**Files:**
- Modify: `apps/web/src/app/dag-designer/_components/dag-designer-screen.tsx`

**Step 1: Update state**

```typescript
// Before
const [catalogNodes, setCatalogNodes] = useState<INodeManifest[]>([]);

// After
const [objectInfo, setObjectInfo] = useState<TObjectInfo>({});
```

**Step 2: Update refreshNodeCatalog**

```typescript
const refreshNodeCatalog = useCallback(async (): Promise<void> => {
    const result = await designApi.listObjectInfo();
    if (result.ok) {
        setObjectInfo(result.value);
        return;
    }
    setLog(`Node catalog refresh failed: ${"error" in result ? result.error[0]?.code : "UNKNOWN_ERROR"}`);
}, [designApi]);
```

**Step 3: Update DagDesigner.Root props**

```typescript
// Before
<DagDesigner.Root manifests={catalogNodes} ...>

// After
<DagDesigner.Root objectInfo={objectInfo} ...>
```

**Step 4: Build check**

Run: `pnpm build`

**Step 5: Commit**

```bash
git add apps/web/
git commit -m "refactor(web): use TObjectInfo for node catalog in dag-designer-screen"
```

---

## Phase 3: 기존 엔드포인트 제거 + rename

### Task 10: `/v1/dag/nodes` 제거, `/v1/dag/object_info` → `/v1/dag/nodes` rename

**Files:**
- Modify: `apps/dag-orchestrator-server/src/routes/definition-routes.ts` (또는 server.ts)
- Modify: `apps/dag-orchestrator-server/src/server.ts` — `BundledNodeCatalogService` 제거
- Modify: `packages/dag-designer/src/client/designer-api-client.ts` — endpoint path 변경
- Delete: `apps/dag-orchestrator-server/src/services/bundled-node-catalog-service.ts` (더 이상 필요 없음)

**Step 1: Rename endpoint**

`/v1/dag/object_info` → `/v1/dag/nodes`

**Step 2: Remove old `/v1/dag/nodes` (INodeManifest 기반)**

**Step 3: Remove BundledNodeCatalogService**

서버에서 `nodeCatalogService` 생성/주입 제거.

**Step 4: Update client endpoint path**

`designer-api-client.ts`의 `listObjectInfo()` 메서드 경로: `/v1/dag/object_info` → `/v1/dag/nodes`

**Step 5: Remove old listNodeCatalog method**

`designer-api-client.ts`에서 `listNodeCatalog()` 제거. `designer-api.ts` 인터페이스에서도 제거.

**Step 6: Full build and test**

Run: `pnpm build && pnpm test`
Expected: All pass

**Step 7: Commit**

```bash
git add .
git commit -m "refactor: rename /v1/dag/object_info to /v1/dag/nodes, remove BundledNodeCatalogService"
```

---

## Task Dependencies

```
Phase 1:
  Task 1 (endpoint)

Phase 2:
  Task 2 (client method) → Task 3 (context type) → Task 4 (canvas-utils)
  → Task 5 (explorer panel) → Task 6 (config panel) → Task 7 (panels wiring)
  → Task 8 (hooks/exports) → Task 9 (web app)

Phase 3:
  Task 10 (cleanup, depends on all)
```

## Notes

- `createNodeFromManifest`는 Phase 2 중에는 유지 (기존 테스트 호환). Task 10에서 제거.
- `mapComfyTypeToPortType`은 ComfyUI 타입 → Robota `TPortValueType` 매핑. 노드 생성에만 사용되며, 실행 파이프라인의 `INodeManifest`는 이번 스코프 밖.
- `INodeObjectInfo.input`의 구조가 `IPortDefinition[]`과 다르므로, config 폼 렌더링(Task 6)이 가장 복잡한 부분. ComfyUI의 `TInputTypeSpec` 형식에 맞춰 폼 필드를 렌더링해야 함.
