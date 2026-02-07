---
name: type-system-guidance
description: Provide type system guidance for naming, reuse strategy, and exception justification for any/unknown. Use when discussing type standards or type safety trade-offs.
---

# Type System Guidance

## Scope
Use this skill to apply type system guidance and justify exceptions.

## Type Naming
- Domain-driven names that reflect business concepts.
- Use `T*` for type aliases and `I*` for interfaces.
- Avoid unprefixed contract names that collide with runtime values.

## Type Reuse Strategy
1. Search for existing types first.
2. Extend or compose instead of duplicating.
3. Share cross-cutting contracts only when needed.
4. Keep feature-specific types local.

## SSOT Ownership Guidance (Option A)
- Use package entrypoints for public surface imports.
- Feature-local types remain within the feature until cross-cutting.
- Avoid pass-through re-exports from services/managers/handlers.

## Examples (SSOT)
```ts
import type { IToolCall, TToolParameters } from '@robota-sdk/agents';
```

```ts
type TToolCalls = import('../abstracts/abstract-plugin').IPluginExecutionResult['toolCalls'];
```

```ts
export interface ToolCallData {
  id: string;
  name: string;
  arguments: string;
}
```

```ts
export type TToolResultData = TUniversalValue;
```

## Common Patterns
- Prefer constrained generics for type safety.
- Use explicit interfaces for structured data.
- Use type guards for runtime validation.

## Exception Justification (any/unknown)
### Required Steps
1. Try specific union types.
2. Try existing interfaces.
3. Define a precise interface.
4. Redesign to avoid `any` or `unknown`.

### Documentation Template
```typescript
// VERIFICATION PROCESS:
// Step 1: Tried specific types - FAILED because [reason]
// Step 2: Tried existing interfaces - FAILED because [reason]
// Step 3: Tried custom interface - FAILED because [reason]
// Step 4: Tried redesign - FAILED because [reason]
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tried-alternatives, external-api
```

### Valid Justifications
- `external-api`
- `runtime-dynamic`
- `third-party`
- `legacy-code`
- `generic-constraint`
