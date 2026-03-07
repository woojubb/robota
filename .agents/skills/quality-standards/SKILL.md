---
name: quality-standards
description: Provide quality standards guidance for type system design and quality gate operations (lint/typecheck). Use when enforcing quality checks or discussing type safety trade-offs.
---

# Quality Standards Guidance

## Rule Anchor
- `AGENTS.md` > "Type System (Strict)"
- `AGENTS.md` > "Build Requirements"

## Scope
Use this skill to apply TypeScript type system guidance and run quality gates.

## Quality Gates (Lint/Typecheck)
1. Identify the affected packages for the change.
2. Run the package lint target and capture the baseline count.
3. Apply changes in batches; after each batch, rerun lint.
4. Confirm the lint count decreases or reaches zero before proceeding.
5. Run typecheck for the impacted scope when required by the change.

## Boundary Quality Gate
- Before implementation, classify behavior as `core behavior` vs `side concern`.
- If side concern, require an interface/module boundary and dependency injection.
- Block changes that place side concerns directly in core modules as convenience exceptions.
- Add tests that verify boundary behavior (core semantics unchanged when side concern implementation changes).

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

## Type Strictness Alignment
- Follow repository strict policy: do not use `any` or `{}` in production code, and use `unknown` only at trust boundaries with immediate narrowing.
- Do not add linter or TypeScript bypass directives for convenience.
- If typing fails, redesign contracts or module boundaries rather than weakening type safety.
