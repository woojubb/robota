---
name: quality-standards
description: Provide quality standards guidance for type system design and quality gate operations (lint/typecheck). Use when enforcing quality checks or discussing type safety trade-offs.
---

# Quality Standards Guidance

## Scope
Use this skill to apply TypeScript type system guidance and run quality gates.

## Quality Gates (Lint/Typecheck)
1. Identify the affected packages for the change.
2. Run the package lint target and capture the baseline count.
3. Apply changes in batches; after each batch, rerun lint.
4. Confirm the lint count decreases or reaches zero before proceeding.
5. Run typecheck for the impacted scope when required by the change.

## Batch Quality Gate Checklist
- Record the lint count before each batch.
- Do not proceed to the next batch until the count decreases.
- If the count stalls, re-scope the batch and resolve the root cause.

## Naming Hygiene
- Avoid redundant suffixes like `Interface` or `Type`.
- Remove `TypeSafe` naming and similar vanity prefixes.
- Keep naming consistent with `I*`/`T*` conventions.

## Alias Anti-Pattern Cleanup
- Remove meaningless aliases like `type A = B`.
- Eliminate same-shape redeclarations in non-owner modules.
- Avoid pass-through re-exports from services/managers/plugins.

## SSOT Scanner Usage
- Use the duplicate-declaration scanner to verify same-kind duplication is zero.
- Keep scanner output in `.design/open-tasks/` as a reference snapshot.

## TypeScript Type Naming
- Domain-driven names that reflect business concepts.
- Use `T*` for type aliases and `I*` for interfaces.
- Avoid unprefixed contract names that collide with runtime values.

## TypeScript Type Reuse Strategy
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

## TypeScript Patterns
- Prefer constrained generics for type safety.
- Use explicit interfaces for structured data.
- Use type guards for runtime validation.

## TypeScript Exception Justification (any/unknown)
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
