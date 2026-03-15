# DAG JSON Input/Output 제거 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** DAG JSON의 IDagNode에서 inputs/outputs를 optional로 변경하고, dag-designer가 objectInfo에서 port 정보를 참조하도록 리팩토링한다.

**Architecture:** IDagNode.inputs/outputs를 optional로 변경 (하위호환 유지). dag-designer에서 노드 추가 시 inputs/outputs를 DAG에 넣지 않음. UI 렌더링 시 objectInfo[nodeType]에서 port 정보를 참조. 기존 DAG JSON(inputs/outputs 포함)도 계속 동작.

**Tech Stack:** TypeScript, React, Vitest

**Design Doc:** `docs/plans/2026-03-15-dag-json-no-input-output-design.md`

---

## Phase 1: IDagNode.inputs/outputs optional 변경

### Task 1: dag-core 타입 변경

**Files:**
- Modify: `packages/dag-core/src/types/domain.ts:111-112`

**Step 1: Make inputs/outputs optional**

```typescript
// Before
inputs: IPortDefinition[];
outputs: IPortDefinition[];

// After
inputs?: IPortDefinition[];
outputs?: IPortDefinition[];
```

**Step 2: Run typecheck to find all broken references**

Run: `pnpm --filter @robota-sdk/dag-core typecheck`
Expected: Errors in validators and tests where `node.inputs` is accessed without optional chaining

**Step 3: Fix dag-core references**

In `definition-validator.ts` and `definition-edge-validator.ts`: add fallback `node.inputs ?? []` and `node.outputs ?? []`.

In test files: add inputs/outputs to test fixtures where needed (existing tests should keep working with the arrays).

**Step 4: Run tests**

Run: `pnpm --filter @robota-sdk/dag-core test`
Expected: All pass

**Step 5: Commit**

```bash
git commit -m "refactor(dag-core): make IDagNode.inputs/outputs optional"
```

---

### Task 2: dag-designer — createNodeFromObjectInfo에서 inputs/outputs 제거

**Files:**
- Modify: `packages/dag-designer/src/components/canvas-utils.ts`
- Modify: `packages/dag-designer/src/components/dag-designer-context.tsx`

**Step 1: Update createNodeFromObjectInfo**

```typescript
export function createNodeFromObjectInfo(
    nodeType: string,
    info: INodeObjectInfo,
    index: number
): IDagNode {
    // No inputs/outputs — they come from objectInfo at render time
    return {
        nodeId: `${nodeType}_${index + 1}`,
        nodeType,
        position: { x: 120 + (index % 3) * 260, y: 100 + Math.floor(index / 3) * 180 },
        dependsOn: [],
        config: {},
    };
}
```

**Step 2: Build**

Run: `pnpm --filter @robota-sdk/dag-designer build`

**Step 3: Commit**

```bash
git commit -m "refactor(dag-designer): createNodeFromObjectInfo without inputs/outputs"
```

---

## Phase 2: dag-designer UI — objectInfo에서 port 참조

### Task 3: canvas-utils — toNode()에서 objectInfo 참조

**Files:**
- Modify: `packages/dag-designer/src/components/canvas-utils.ts`

**Step 1: Update toNode() to accept objectInfo**

`toNode()` 함수가 `IDagNodeViewData`를 만들 때 `node.inputs ?? []`과 `node.outputs ?? []` 대신 objectInfo에서 port 정보를 가져오도록 변경. objectInfo가 있으면 objectInfo 사용, 없으면 node.inputs/outputs fallback (하위호환).

```typescript
export function toNode(
    nodeDefinition: IDagNode,
    objectInfo?: TObjectInfo,
    // ... other params
): Node<IDagNodeViewData> {
    const nodeInfo = objectInfo?.[nodeDefinition.nodeType];

    // Port definitions: objectInfo 우선, fallback to node
    const inputs = nodeInfo
        ? convertObjectInfoInputs(nodeInfo)
        : (nodeDefinition.inputs ?? []);
    const outputs = nodeInfo
        ? convertObjectInfoOutputs(nodeInfo)
        : (nodeDefinition.outputs ?? []);

    // ... rest of toNode
}
```

`convertObjectInfoInputs/Outputs`는 `INodeObjectInfo`에서 `IPortDefinition[]`로 변환하는 헬퍼 (이미 `createNodeFromObjectInfo`에 있던 로직 재활용).

**Step 2: Update all toNode() 호출부에서 objectInfo 전달**

`dag-designer-canvas.tsx`와 `dag-designer-context.tsx`에서 `toNode()` 호출 시 `objectInfo` 전달.

**Step 3: Build and test**

Run: `pnpm --filter @robota-sdk/dag-designer build && pnpm --filter @robota-sdk/dag-designer test`

**Step 4: Commit**

```bash
git commit -m "refactor(dag-designer): toNode() uses objectInfo for port definitions"
```

---

### Task 4: 나머지 dag-designer 컴포넌트 — optional inputs/outputs 대응

**Files:**
- Modify: `packages/dag-designer/src/components/dag-designer-canvas.tsx` — `computeInputHandlesByPortKey` 호출 시 objectInfo 활용
- Modify: `packages/dag-designer/src/components/node-config-panel.tsx` — port section에 objectInfo 기반 port 전달
- Modify: `packages/dag-designer/src/components/edge-inspector-panel.tsx` — port 정렬 시 optional 대응
- Modify: `packages/dag-designer/src/components/port-editor-utils.ts` — optional inputs/outputs 대응

모든 `node.inputs` → `node.inputs ?? []`, `node.outputs` → `node.outputs ?? []` 또는 objectInfo 참조.

**Step 1: Fix all references**

**Step 2: Build and test**

Run: `pnpm --filter @robota-sdk/dag-designer build && pnpm --filter @robota-sdk/dag-designer test`

**Step 3: Commit**

```bash
git commit -m "refactor(dag-designer): handle optional inputs/outputs across components"
```

---

## Phase 3: 나머지 패키지 대응

### Task 5: dag-worker, dag-node, dag-orchestrator — optional 대응

**Files:**
- Modify: `packages/dag-worker/src/services/downstream-payload-builder.ts` — `node.inputs ?? []`
- Modify: `packages/dag-node/src/lifecycle/registered-node-lifecycle.ts` — `node.inputs ?? []`, `node.outputs ?? []`
- Modify: `packages/dag-node/src/node-definition-assembly.ts` — 기존과 동일 (INodeManifest에서는 여전히 필수)

**Step 1: Fix all references**

**Step 2: Build and test all**

Run: `pnpm build && pnpm test`
Expected: All pass

**Step 3: Commit**

```bash
git commit -m "refactor: handle optional IDagNode.inputs/outputs in worker, node, orchestrator"
```

---

### Task 6: Preset JSON 업데이트

**Files:**
- Modify: `apps/web/src/app/dag-designer/presets/*.json`

**Step 1: 기존 preset에서 inputs/outputs 제거 (optional)**

기존 preset JSON에서 각 노드의 `inputs`/`outputs` 배열을 제거. nodeType만 남기면 objectInfo에서 port 정보를 참조.

이건 선택적 — 기존 JSON이 inputs/outputs를 갖고 있어도 동작하지만, SSOT 원칙에 따라 제거하는 것이 맞음.

**Step 2: Commit**

```bash
git commit -m "refactor: remove inputs/outputs from preset JSON (objectInfo is SSOT)"
```

---

### Task 7: 전체 빌드 + 테스트 + 브라우저 확인

**Step 1: Full build**

Run: `pnpm build`

**Step 2: Full test**

Run: `pnpm test`
Expected: All pass

**Step 3: 브라우저 확인**

- 기존 DAG 로드 → 노드 핸들 표시 확인
- 새 노드 추가 → 핸들 표시 확인
- Edge 연결 → 정상 동작 확인
- 실행 → 정상 완료 확인

---

## Task Dependencies

```
Task 1 (type change) → Task 2 (createNode) → Task 3 (toNode objectInfo)
→ Task 4 (remaining components) → Task 5 (other packages)
→ Task 6 (presets, optional) → Task 7 (full verify)
```

## Notes

- `INodeManifest.inputs/outputs`는 변경하지 않음 — 여전히 필수 (노드 정의의 SSOT)
- `IDagNode.inputs/outputs`만 optional — DAG 인스턴스에서는 port 정의를 참조로 대체
- 기존 DAG JSON (inputs/outputs 포함)은 계속 동작 — 하위호환 유지
- objectInfo가 없는 환경에서는 node.inputs/outputs fallback 사용
