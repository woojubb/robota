# ComfyUI Config Form Renderer Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 기존 Zod 스키마 기반 config 폼 렌더러를 삭제하고, ComfyUI `TInputTypeSpec` 기반 파라미터/핸들 분류 렌더러로 완전 교체한다.

**Architecture:** ComfyUI `INodeObjectInfo.input.required/optional`의 각 필드를 파라미터(INT, FLOAT, STRING, BOOLEAN, enum)와 핸들(MODEL, IMAGE 등)로 분류. 파라미터는 편집 가능한 폼 필드로, 핸들은 edge 연결 상태 표시로 렌더링.

**Tech Stack:** TypeScript, React 19, Tailwind CSS

**Design Doc:** `docs/plans/2026-03-15-comfyui-config-renderer-design.md`

---

### Task 1: comfyui-field-renderers.tsx 생성

**Files:**
- Create: `packages/dag-designer/src/components/comfyui-field-renderers.tsx`
- Test: `packages/dag-designer/src/components/__tests__/comfyui-field-renderers.test.ts`

**Step 1: Create the classification utility and field renderer component**

```typescript
// packages/dag-designer/src/components/comfyui-field-renderers.tsx
import { type ReactElement } from 'react';
import type { TInputTypeSpec } from '@robota-sdk/dag-core';

const PARAMETER_TYPES = new Set(['INT', 'FLOAT', 'STRING', 'BOOLEAN', 'BOOL']);

export interface IParsedInputField {
    key: string;
    typeName: string;
    isParameter: boolean;
    isRequired: boolean;
    metadata: Record<string, unknown>;
    enumOptions?: string[];  // for string[] enum specs
}

/**
 * Parse a single ComfyUI input spec into a structured field descriptor.
 */
export function parseInputSpec(
    key: string,
    spec: TInputTypeSpec | string[],
    required: boolean,
): IParsedInputField {
    // string[] enum: every item is a string AND first item is not a known type
    if (Array.isArray(spec) && spec.length > 0 && spec.every(item => typeof item === 'string')) {
        const firstItem = spec[0] as string;
        // If first item is a known ComfyUI type name with optional metadata, it's TInputTypeSpec
        if (spec.length <= 2 && (PARAMETER_TYPES.has(firstItem.toUpperCase()) || !PARAMETER_TYPES.has(firstItem))) {
            // Check if it looks like TInputTypeSpec [typeName] or [typeName, meta]
            if (spec.length === 1 || (spec.length === 2 && typeof spec[1] === 'object' && spec[1] !== null)) {
                const typeName = firstItem.toUpperCase();
                const metadata = (spec.length === 2 && typeof spec[1] === 'object') ? spec[1] as Record<string, unknown> : {};
                return {
                    key,
                    typeName,
                    isParameter: PARAMETER_TYPES.has(typeName),
                    isRequired: required,
                    metadata,
                };
            }
        }
        // Otherwise it's an enum
        return {
            key,
            typeName: 'ENUM',
            isParameter: true,
            isRequired: required,
            metadata: {},
            enumOptions: spec as string[],
        };
    }

    // TInputTypeSpec: [typeName] or [typeName, metadata]
    const typeName = (typeof spec[0] === 'string' ? spec[0] : 'STRING').toUpperCase();
    const metadata = (spec.length >= 2 && typeof spec[1] === 'object' && spec[1] !== null)
        ? spec[1] as Record<string, unknown>
        : {};

    return {
        key,
        typeName,
        isParameter: PARAMETER_TYPES.has(typeName),
        isRequired: required,
        metadata,
    };
}

/**
 * Parse all inputs from INodeObjectInfo into structured field list.
 */
export function parseAllInputs(
    input: {
        required: Record<string, TInputTypeSpec | string[]>;
        optional?: Record<string, TInputTypeSpec | string[]>;
    },
): IParsedInputField[] {
    const fields: IParsedInputField[] = [];
    for (const [key, spec] of Object.entries(input.required)) {
        fields.push(parseInputSpec(key, spec, true));
    }
    if (input.optional) {
        for (const [key, spec] of Object.entries(input.optional)) {
            fields.push(parseInputSpec(key, spec, false));
        }
    }
    return fields;
}

// --- React Components ---

export interface IComfyFieldProps {
    field: IParsedInputField;
    value: unknown;
    onChange: (key: string, value: unknown) => void;
}

export function ComfyParameterField(props: IComfyFieldProps): ReactElement {
    const { field, value, onChange } = props;

    // ENUM (select)
    if (field.typeName === 'ENUM' && field.enumOptions) {
        return (
            <div className="flex flex-col gap-1">
                <FieldLabel field={field} />
                <select
                    value={String(value ?? field.enumOptions[0] ?? '')}
                    onChange={(e) => onChange(field.key, e.target.value)}
                    className="rounded-md border border-[var(--studio-border)] bg-[var(--studio-bg-surface)] px-2 py-1.5 text-xs text-[var(--studio-text)] focus:outline-none focus:ring-1 focus:ring-[var(--studio-accent-violet)]"
                >
                    {field.enumOptions.map((opt) => (
                        <option key={opt} value={opt}>{opt}</option>
                    ))}
                </select>
            </div>
        );
    }

    // BOOLEAN (checkbox)
    if (field.typeName === 'BOOLEAN' || field.typeName === 'BOOL') {
        return (
            <div className="flex items-center gap-2">
                <input
                    type="checkbox"
                    checked={Boolean(value ?? field.metadata.default ?? false)}
                    onChange={(e) => onChange(field.key, e.target.checked)}
                    className="h-4 w-4 rounded accent-[var(--studio-accent-violet)]"
                />
                <FieldLabel field={field} inline />
            </div>
        );
    }

    // INT (integer input)
    if (field.typeName === 'INT') {
        const min = typeof field.metadata.min === 'number' ? field.metadata.min : undefined;
        const max = typeof field.metadata.max === 'number' ? field.metadata.max : undefined;
        const step = typeof field.metadata.step === 'number' ? field.metadata.step : 1;
        return (
            <div className="flex flex-col gap-1">
                <FieldLabel field={field} />
                <input
                    type="number"
                    value={Number(value ?? field.metadata.default ?? 0)}
                    min={min}
                    max={max}
                    step={step}
                    onChange={(e) => onChange(field.key, parseInt(e.target.value, 10))}
                    className="rounded-md border border-[var(--studio-border)] bg-[var(--studio-bg-surface)] px-2 py-1.5 text-xs font-mono text-[var(--studio-text)] focus:outline-none focus:ring-1 focus:ring-[var(--studio-accent-violet)]"
                />
            </div>
        );
    }

    // FLOAT (decimal input)
    if (field.typeName === 'FLOAT') {
        const min = typeof field.metadata.min === 'number' ? field.metadata.min : undefined;
        const max = typeof field.metadata.max === 'number' ? field.metadata.max : undefined;
        const step = typeof field.metadata.step === 'number' ? field.metadata.step : 0.01;
        return (
            <div className="flex flex-col gap-1">
                <FieldLabel field={field} />
                <input
                    type="number"
                    value={Number(value ?? field.metadata.default ?? 0)}
                    min={min}
                    max={max}
                    step={step}
                    onChange={(e) => onChange(field.key, parseFloat(e.target.value))}
                    className="rounded-md border border-[var(--studio-border)] bg-[var(--studio-bg-surface)] px-2 py-1.5 text-xs font-mono text-[var(--studio-text)] focus:outline-none focus:ring-1 focus:ring-[var(--studio-accent-violet)]"
                />
            </div>
        );
    }

    // STRING (text input or textarea)
    const multiline = Boolean(field.metadata.multiline);
    if (multiline) {
        return (
            <div className="flex flex-col gap-1">
                <FieldLabel field={field} />
                <textarea
                    value={String(value ?? field.metadata.default ?? '')}
                    onChange={(e) => onChange(field.key, e.target.value)}
                    rows={3}
                    className="rounded-md border border-[var(--studio-border)] bg-[var(--studio-bg-surface)] px-2 py-1.5 text-xs text-[var(--studio-text)] focus:outline-none focus:ring-1 focus:ring-[var(--studio-accent-violet)]"
                />
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-1">
            <FieldLabel field={field} />
            <input
                type="text"
                value={String(value ?? field.metadata.default ?? '')}
                onChange={(e) => onChange(field.key, e.target.value)}
                className="rounded-md border border-[var(--studio-border)] bg-[var(--studio-bg-surface)] px-2 py-1.5 text-xs text-[var(--studio-text)] focus:outline-none focus:ring-1 focus:ring-[var(--studio-accent-violet)]"
            />
        </div>
    );
}

function FieldLabel(props: { field: IParsedInputField; inline?: boolean }): ReactElement {
    const { field, inline } = props;
    return (
        <label className={`text-[10px] uppercase tracking-widest text-[var(--studio-text-muted)] ${inline ? '' : 'mb-0'}`}>
            {field.key}
            {field.isRequired ? <span className="ml-1 text-[var(--studio-accent-rose)]">*</span> : null}
            <span className="ml-2 normal-case tracking-normal text-[var(--studio-text-muted)] opacity-60">{field.typeName}</span>
        </label>
    );
}

export interface IComfyHandleFieldProps {
    field: IParsedInputField;
    isConnected: boolean;
    connectedFrom?: string;
}

export function ComfyHandleField(props: IComfyHandleFieldProps): ReactElement {
    const { field, isConnected, connectedFrom } = props;
    return (
        <div className="flex items-center gap-2 rounded-md border border-[var(--studio-border-subtle)] bg-[var(--studio-bg-surface)] px-2 py-1.5">
            <span className={`inline-block h-2 w-2 rounded-full ${
                isConnected
                    ? 'bg-[var(--studio-accent-emerald)] shadow-[0_0_4px_var(--studio-accent-emerald)]'
                    : field.isRequired
                        ? 'bg-[var(--studio-accent-rose)] shadow-[0_0_4px_var(--studio-accent-rose)]'
                        : 'bg-[var(--studio-text-muted)]'
            }`} />
            <span className="text-[10px] uppercase tracking-widest text-[var(--studio-text-muted)]">{field.key}</span>
            <span className="text-[10px] text-[var(--studio-text-muted)] opacity-60">{field.typeName}</span>
            {isConnected && connectedFrom ? (
                <span className="ml-auto text-[10px] text-[var(--studio-accent-emerald)]">← {connectedFrom}</span>
            ) : field.isRequired && !isConnected ? (
                <span className="ml-auto text-[10px] text-[var(--studio-accent-rose)]">연결 필요</span>
            ) : null}
        </div>
    );
}
```

**Step 2: Write tests for parseInputSpec and parseAllInputs**

```typescript
// packages/dag-designer/src/components/__tests__/comfyui-field-renderers.test.ts
import { describe, it, expect } from 'vitest';
import { parseInputSpec, parseAllInputs } from '../comfyui-field-renderers.js';

describe('parseInputSpec', () => {
    it('parses INT with metadata as parameter', () => {
        const result = parseInputSpec('seed', ['INT', { default: 0, min: 0, max: 100 }], true);
        expect(result.typeName).toBe('INT');
        expect(result.isParameter).toBe(true);
        expect(result.isRequired).toBe(true);
        expect(result.metadata).toEqual({ default: 0, min: 0, max: 100 });
    });

    it('parses STRING as parameter', () => {
        const result = parseInputSpec('prompt', ['STRING'], true);
        expect(result.typeName).toBe('STRING');
        expect(result.isParameter).toBe(true);
    });

    it('parses MODEL as handle', () => {
        const result = parseInputSpec('model', ['MODEL'], true);
        expect(result.typeName).toBe('MODEL');
        expect(result.isParameter).toBe(false);
    });

    it('parses IMAGE as handle', () => {
        const result = parseInputSpec('image', ['IMAGE'], true);
        expect(result.isParameter).toBe(false);
    });

    it('parses string[] as enum parameter', () => {
        const result = parseInputSpec('sampler', ['euler', 'euler_a', 'dpmpp_2m'], true);
        expect(result.typeName).toBe('ENUM');
        expect(result.isParameter).toBe(true);
        expect(result.enumOptions).toEqual(['euler', 'euler_a', 'dpmpp_2m']);
    });

    it('parses BOOLEAN as parameter', () => {
        const result = parseInputSpec('enabled', ['BOOLEAN'], false);
        expect(result.typeName).toBe('BOOLEAN');
        expect(result.isParameter).toBe(true);
        expect(result.isRequired).toBe(false);
    });

    it('parses FLOAT with metadata', () => {
        const result = parseInputSpec('cfg', ['FLOAT', { default: 7.0, min: 0, max: 30, step: 0.5 }], true);
        expect(result.typeName).toBe('FLOAT');
        expect(result.isParameter).toBe(true);
        expect(result.metadata.step).toBe(0.5);
    });
});

describe('parseAllInputs', () => {
    it('parses required and optional inputs', () => {
        const fields = parseAllInputs({
            required: {
                model: ['MODEL'],
                seed: ['INT', { default: 0 }],
            },
            optional: {
                prompt: ['STRING'],
            },
        });
        expect(fields).toHaveLength(3);
        expect(fields.filter(f => f.isParameter)).toHaveLength(2); // seed, prompt
        expect(fields.filter(f => !f.isParameter)).toHaveLength(1); // model
        expect(fields.find(f => f.key === 'prompt')?.isRequired).toBe(false);
    });
});
```

**Step 3: Run tests**

Run: `pnpm --filter @robota-sdk/dag-designer test`
Expected: All pass

**Step 4: Commit**

```bash
git add packages/dag-designer/
git commit -m "feat(dag-designer): add ComfyUI field renderers with parameter/handle classification"
```

---

### Task 2: node-config-panel.tsx 재작성

**Files:**
- Modify: `packages/dag-designer/src/components/node-config-panel.tsx`

**Step 1: Rewrite to use ComfyUI field renderers**

The panel should:
1. Receive `nodeObjectInfo?: INodeObjectInfo` prop (already added in previous task)
2. When `nodeObjectInfo` is provided:
   - Parse inputs via `parseAllInputs(nodeObjectInfo.input)`
   - Split into parameters and handles
   - Render parameters with `ComfyParameterField` (editable)
   - Render handles with `ComfyHandleField` (read-only, show connection status)
3. Config changes go through `onConfigChange` callback (update node's `config` object)
4. Handle connection status: check `definition.edges` to see if a handle is connected

Remove all imports and usage of `SchemaField`, `extractConfigDefaultsFromSchema`, `isNodeConfigValue`.

Keep: `PortSection` component and port editing (inputs/outputs port management).

**Step 2: Run build**

Run: `pnpm --filter @robota-sdk/dag-designer build`

**Step 3: Commit**

```bash
git add packages/dag-designer/
git commit -m "refactor(dag-designer): rewrite node-config-panel for ComfyUI input specs"
```

---

### Task 3: 기존 Zod 기반 파일 삭제

**Files:**
- Delete: `packages/dag-designer/src/components/config-field-renderers.tsx`
- Delete: `packages/dag-designer/src/components/schema-defaults.ts`
- Delete: `packages/dag-designer/src/components/__tests__/schema-defaults.test.ts`

**Step 1: Delete files**

```bash
rm packages/dag-designer/src/components/config-field-renderers.tsx
rm packages/dag-designer/src/components/schema-defaults.ts
rm packages/dag-designer/src/components/__tests__/schema-defaults.test.ts
```

**Step 2: Verify no remaining imports**

```bash
grep -r "config-field-renderers\|schema-defaults\|SchemaField\|extractConfigDefaults\|mergeConfigWithDefaults" packages/dag-designer/src/ --include="*.ts" --include="*.tsx"
```
Expected: Zero results

**Step 3: Run build and test**

Run: `pnpm --filter @robota-sdk/dag-designer build && pnpm --filter @robota-sdk/dag-designer test`
Expected: All pass

**Step 4: Commit**

```bash
git add packages/dag-designer/
git commit -m "refactor(dag-designer): remove Zod-based config-field-renderers and schema-defaults"
```

---

### Task 4: 전체 빌드 + 테스트 확인

**Step 1: Full build**

Run: `pnpm build`
Expected: Pass

**Step 2: Full test**

Run: `pnpm test`
Expected: All pass

**Step 3: Commit if any fixes needed**

---

## Task Dependencies

```
Task 1 (comfyui-field-renderers) → Task 2 (rewrite config panel) → Task 3 (delete old files) → Task 4 (full verify)
```

## Notes

- `parseInputSpec`의 enum 감지 로직이 edge case가 있을 수 있음 (예: `['STRING']`은 TInputTypeSpec이고 `['euler', 'dpmpp']`는 enum). 구현 시 실제 `/object_info` 응답으로 검증 필요.
- `asset-upload-utils.ts`는 삭제 대상이 아님 — config panel에서 파일 업로드에 여전히 사용될 수 있음.
- `PortSection` 컴포넌트는 유지 — 포트 편집은 별도 기능.
