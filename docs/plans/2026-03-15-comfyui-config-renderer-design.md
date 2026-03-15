# ComfyUI Input 기반 Config 폼 렌더러 설계

## 개요

ComfyUI `/object_info`의 `TInputTypeSpec` 구조에 맞는 config 폼 렌더러를 구현한다. 기존 Zod 스키마 기반 렌더러(`config-field-renderers.tsx`, `schema-defaults.ts`)를 삭제하고 ComfyUI 스펙으로 완전 교체한다.

## 핵심 개념: 파라미터 vs 핸들

ComfyUI `input.required/optional`의 각 필드를 두 종류로 분류:

- **파라미터 (Parameter)**: 노드에서 직접 값을 설정 (INT, FLOAT, STRING, BOOLEAN, enum)
- **핸들 (Handle)**: 다른 노드와 edge로 연결 (MODEL, IMAGE, LATENT, CLIP 등)

## 분류 로직

```typescript
const PARAMETER_TYPES = new Set(['INT', 'FLOAT', 'STRING', 'BOOLEAN', 'BOOL']);

// TInputTypeSpec = [string] | [string, Record<string, unknown>]
// string[] = enum options

function isParameter(spec: TInputTypeSpec | string[]): boolean {
    // string[] (enum) → 파라미터
    if (spec.every(item => typeof item === 'string')) return true;
    // [typeName, ...] → PARAMETER_TYPES에 있으면 파라미터
    const typeName = spec[0];
    if (typeof typeName === 'string') return PARAMETER_TYPES.has(typeName.toUpperCase());
    return false;
}
```

## 파라미터 타입별 렌더러

| ComfyUI 타입 | 폼 위젯 | 메타데이터 활용 |
|-------------|---------|---------------|
| `INT` | `<input type="number" step="1">` | `default`, `min`, `max`, `step` |
| `FLOAT` | `<input type="number" step="0.01">` | `default`, `min`, `max`, `step` |
| `STRING` | `<input>` 또는 `<textarea>` | `default`, `multiline` |
| `BOOLEAN` | checkbox/toggle | `default` |
| `string[]` (enum) | `<select>` | 배열 항목 = 옵션 |

## 핸들 표시

핸들은 편집 불가. edge 연결 상태만 표시:
- 연결됨 → "● 연결됨" (에메랄드)
- 미연결 + required → "○ 연결 필요" (로즈)
- 미연결 + optional → "○ 미연결" (뮤트)

## UI 레이아웃

```
┌─ NODE CONFIG ─────────────────┐
│  nodeId: xxx                  │
│  nodeType: xxx                │
│                               │
│  ── Parameters ──             │
│  seed: [0        ] (INT)      │
│  prompt: [________] (STRING)  │
│  model: [gpt-4o-mini ▼] (enum)│
│                               │
│  ── Handles ──                │
│  ● model (MODEL) — 연결됨     │
│  ○ images (IMAGE) — 연결 필요  │
└───────────────────────────────┘
```

## 파일 변경

| 파일 | 액션 |
|------|------|
| `config-field-renderers.tsx` | **삭제** |
| `schema-defaults.ts` | **삭제** |
| `comfyui-field-renderers.tsx` | **신규** — ComfyUI TInputTypeSpec 기반 렌더러 |
| `node-config-panel.tsx` | **재작성** — INodeObjectInfo.input 기반 |
| `dag-designer-context.tsx` | config 변경 핸들러 업데이트 |

## 데이터 흐름

```
INodeObjectInfo.input.required/optional
    ↓ isParameter() 분류
    ↓
┌─ Parameters ──────────────────┐
│  각 필드를 ComfyuiFieldRenderer│
│  로 렌더링, onChange로 config  │
│  값 업데이트                   │
└───────────────────────────────┘
┌─ Handles ─────────────────────┐
│  각 필드의 edge 연결 상태를    │
│  definition.edges에서 조회하여 │
│  표시 (read-only)             │
└───────────────────────────────┘
```
