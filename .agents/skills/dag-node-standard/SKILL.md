---
name: dag-node-standard
description: Standard workflow for implementing DAG nodes with AbstractNodeDefinition, zod config schemas, NodeIoAccessor validation, and consistent cost/execution contracts. Use when creating or refactoring nodes in packages/dag-nodes.
---

# DAG Node Standard

## Rule Anchor
- `AGENTS.md` > "DAG Node Implementation"
- `AGENTS.md` > "Development Patterns"
- `AGENTS.md` > "Type System (Strict)"

## Use This Skill When
- Creating a new node in `packages/dag-nodes/*/src/index.ts`.
- Refactoring legacy node implementations with duplicated validation.
- Fixing node input/config validation regressions.
- Standardizing `estimateCost` and `execute` contracts.

## Target Architecture
Use this structure:
1. `configSchemaDefinition` (zod) defines config shape.
2. `AbstractNodeDefinition` handles runtime config parse.
3. `NodeIoAccessor` handles input/output payload validation.
4. Node class implements business logic only:
   - `estimateCostWithConfig(input, context, config)`
   - `executeWithConfig(input, context, config)`

## Required Implementation Steps

### 1) Define config schema first
- Create a zod schema constant near top of file.
- Put defaults and cross-field rules in the schema.
- Avoid duplicating schema rules in execution code.

Example:
```typescript
const MyNodeConfigSchema = z.object({
  model: z.string().default('gpt-4o-mini'),
  baseCostUsd: z.number().default(0.01)
});
```

### 2) Extend `AbstractNodeDefinition`
- Class must extend `AbstractNodeDefinition<typeof MyNodeConfigSchema>`.
- Provide standard node metadata fields:
  - `nodeType`
  - `displayName`
  - `category`
  - `inputs`
  - `outputs`
  - `configSchemaDefinition`

### 3) Implement cost contract
- Always implement `estimateCostWithConfig(...)`.
- Use typed `config` argument only.
- Do not inspect raw config via `context.nodeDefinition.config`.

### 4) Implement execution contract
- Implement `executeWithConfig(...)`.
- Use `NodeIoAccessor` helpers for payload validation:
  - `requireInputString`
  - `requireInputBinary`
  - `requireInputArray`
  - `requireInputBinaryList`
- For list ports, do not read `port[0]` keys directly.

### 5) Keep business logic isolated
- Move provider-specific conversion/polling/normalization to internal runtime modules.
- Keep index node file orchestration-focused.

## Recommended Skeleton
```typescript
import {
  AbstractNodeDefinition,
  NodeIoAccessor,
  type IDagNodeDefinition,
  type ICostEstimate,
  type IDagError,
  type INodeExecutionContext,
  type TResult,
  type TPortPayload
} from '@robota-sdk/dag-core';
import { z } from 'zod';

const ExampleConfigSchema = z.object({
  baseCostUsd: z.number().default(0)
});

export class ExampleNodeDefinition extends AbstractNodeDefinition<typeof ExampleConfigSchema> {
  public readonly nodeType = 'example-node';
  public readonly displayName = 'Example Node';
  public readonly category = 'Core';
  public readonly inputs: IDagNodeDefinition['inputs'] = [
    { key: 'text', label: 'Text', order: 0, type: 'string', required: true }
  ];
  public readonly outputs: IDagNodeDefinition['outputs'] = [
    { key: 'text', label: 'Text', order: 0, type: 'string', required: true }
  ];
  public readonly configSchemaDefinition = ExampleConfigSchema;

  public override async estimateCostWithConfig(
    input: TPortPayload,
    context: INodeExecutionContext,
    config: z.output<typeof ExampleConfigSchema>
  ): Promise<TResult<ICostEstimate, IDagError>> {
    return { ok: true, value: { estimatedCostUsd: config.baseCostUsd } };
  }

  protected override async executeWithConfig(
    input: TPortPayload,
    context: INodeExecutionContext,
    config: z.output<typeof ExampleConfigSchema>
  ): Promise<TResult<TPortPayload, IDagError>> {
    const io = new NodeIoAccessor(input, context.nodeDefinition.nodeId);
    const text = io.requireInputString('text');
    if (!text.ok) {
      return text;
    }
    io.setOutput('text', text.value);
    return { ok: true, value: io.toOutput() };
  }
}
```

## Migration Playbook (Legacy Node -> Standard Node)
1. Keep existing schema, extract to a named `const`.
2. Replace handler class with `AbstractNodeDefinition` subclass.
3. Move cost logic into `estimateCostWithConfig`.
4. Move execute logic into `executeWithConfig`.
5. Replace raw payload checks with accessor helper calls.
6. Replace raw config checks with typed `config` usage.
7. Build package and dependent packages.

## Common Failure Patterns and Fixes
- **Failure**: `DAG_VALIDATION_*_IMAGES_INVALID` on list input.
  - **Fix**: use `requireInputBinaryList('images', 'image', { minItems: 2 })`.
- **Failure**: repeated `typeof config.*` blocks in node methods.
  - **Fix**: move constraints into zod schema; consume typed config.
- **Failure**: mismatch between schema defaults and runtime behavior.
  - **Fix**: ensure defaults are declared in zod schema only, not duplicated.
- **Failure**: brittle parsing inside node index files.
  - **Fix**: extract provider/runtime details to `runtime.ts`.

## Verification Checklist
- [ ] Node extends `AbstractNodeDefinition`.
- [ ] `configSchemaDefinition` is zod and includes defaults/constraints.
- [ ] `estimateCostWithConfig` implemented.
- [ ] `executeWithConfig` implemented.
- [ ] No direct `context.nodeDefinition.config.*` reads in node logic.
- [ ] List inputs use `requireInputBinaryList` when applicable.
- [ ] Errors use `DAG_VALIDATION_*` or `DAG_TASK_EXECUTION_*` consistently.
- [ ] Builds pass for changed package(s) and key dependents.
