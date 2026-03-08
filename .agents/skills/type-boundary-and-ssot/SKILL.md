---
name: type-boundary-and-ssot
description: Applies Robota's preferred workflow for trust-boundary validation, strict typing, quality gates, and owner-based SSOT reuse. Use when adding or reviewing type contracts, boundary parsing, shared contract ownership, or running quality checks.
---

# Type Boundary and SSOT

## Rule Anchor
- `AGENTS.md` > "Type System (Strict)"
- `AGENTS.md` > "Build Requirements"
- `AGENTS.md` > "Execution Safety"
- `AGENTS.md` > "Development Patterns"
- `AGENTS.md` > "Rules and Skills Boundary"

## Use This Skill When
- Receiving external data from APIs, events, files, user input, or LLM responses.
- Designing or changing shared contracts and exported types.
- Cleaning up duplicated type declarations or alias chains.
- Reviewing whether a change respects trust boundaries and owner-based SSOT.
- Running quality gates (lint/typecheck) after type-related changes.
- Replacing `as` casts or `any` at data entry points.

## Preconditions
- Identify the trust boundary where external data enters.
- Identify the owner package or module for the contract.
- Determine whether the change affects only local types or exported/shared types.
- Classify behavior as `core behavior` vs `side concern`.

## Trust Boundaries in This Project

| Boundary | Data Source | Package |
|----------|------------|---------|
| LLM API response | OpenAI/Anthropic/Google JSON | providers |
| User config/tool definition | Constructor arguments | agents |
| Event payload | EventService emit data | workflow, dag-projection |
| DAG definition | User-authored JSON | dag-core, dag-api |
| API request body | HTTP request | dag-api, api-server |
| Plugin config | Plugin constructor options | agents plugins |

## Execution Steps

### Boundary Validation
1. Locate the boundary where untrusted data enters the system.
2. Keep the boundary input as `unknown` only until validation is complete.
3. Validate once at the boundary using type guards, validators, or schema checks.
4. Pass typed data inward — internal functions do not re-check.
5. Validation failures must include field name, expected type, and received value.

### SSOT Ownership
6. Search for an owned contract before introducing a new type.
7. If the concept already exists, import from the owner surface instead of re-declaring it.
8. If the concept is new, define one owner and keep non-owner modules free of same-shape re-declarations.
9. Feature-local types remain within the feature until cross-cutting.

### Quality Gates
10. Run the relevant quality checks for the affected scope:
    - `pnpm --filter @robota-sdk/<pkg> lint` — record baseline count before changes.
    - `pnpm --filter @robota-sdk/<pkg> exec tsc -p tsconfig.json --noEmit`
    - `node scripts/ssot-scan-declarations.mjs` — verify zero duplication.
11. For batch changes: do not proceed to the next batch until lint count decreases or reaches zero.
12. If the count stalls, re-scope the batch and resolve the root cause.

### Summary
13. Document: boundary used, owner selected, validation path, residual duplication or contract risks.

## Boundary Validation Patterns

### Type Guard Function
```ts
function isDagDefinition(input: unknown): input is IDagDefinition {
  if (typeof input !== 'object' || input === null) return false;
  const obj = input as Record<string, unknown>;
  return (
    typeof obj.dagId === 'string' &&
    Array.isArray(obj.nodes) &&
    Array.isArray(obj.edges)
  );
}

// Usage at boundary
const parsed: unknown = JSON.parse(rawBody);
if (!isDagDefinition(parsed)) {
  throw new Error('[DAG-VALIDATION] invalid definition shape');
}
// After this point, `parsed` is IDagDefinition
```

### Validator Function with Result
```ts
type TValidationError = { field: string; expected: string; received: string };

function validateTaskRunPayload(
  input: unknown
): { ok: true; data: ITaskRunPayload } | { ok: false; errors: TValidationError[] } {
  const errors: TValidationError[] = [];
  if (typeof input !== 'object' || input === null) {
    return { ok: false, errors: [{ field: 'root', expected: 'object', received: typeof input }] };
  }
  const obj = input as Record<string, unknown>;
  if (typeof obj.taskRunId !== 'string') {
    errors.push({ field: 'taskRunId', expected: 'string', received: typeof obj.taskRunId });
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, data: { taskRunId: obj.taskRunId } };
}
```

### Boundary Adapter
```ts
class OpenAiResponseAdapter {
  parse(raw: unknown): IChatCompletionResult {
    if (!this.isValidResponse(raw)) {
      throw new Error('[EMITTER-CONTRACT] unexpected LLM response shape');
    }
    return raw;
  }
  private isValidResponse(raw: unknown): raw is IChatCompletionResult { /* guards */ }
}
```

### SSOT Import
```ts
import type { IToolCall, TToolParameters } from '@robota-sdk/agents';
```

## SSOT Conflict Resolution Workflow

When duplicate type declarations are detected across packages:

1. Run `node scripts/audit/ssot-scan-declarations.mjs` to obtain the duplication list.
2. For each duplicate, determine ownership:
   - Semantically identical types → the upstream contract package owns; downstream imports.
   - Same name but different semantics → rename one side to eliminate the collision.
   - Duplicates inside `examples/` → allowed (treated the same as test scope).
3. When transferring ownership, analyze impact: update all consumer import paths.
4. Update `SPEC.md` Type Ownership table for affected packages.

## SDK Boundary Type Assertion Guidelines

When converting between SDK/external library types and internal types:

- `as any` is prohibited (absolute).
- `as SdkType` direct assertion: allowed only when structurally compatible; add a comment stating the compatibility rationale.
- `as unknown as T` double-cast: prohibited.
- When structural mismatch is significant: write a converter function with field-by-field mapping.

## Stop Conditions
- External data is cast into a domain type without validation.
- A non-owner module re-declares an owned contract.
- `any`, `{}`, or unchecked assertions are used to bypass typing.
- The changed scope fails lint or typecheck.
- Validation errors lack field name, expected type, or received value.
- Side concerns are placed directly in core modules.
- `ssot-scan-declarations.mjs` reports `same_kind_duplicate` count > 0.
- A type alias uses `I*` prefix, or an interface uses `T*` prefix.

## Checklist
- [ ] Boundary input remains untrusted until validation completes.
- [ ] Validation happens once at the boundary.
- [ ] Validation errors include field name, expected type, and received value.
- [ ] Domain code receives typed data, not raw external payloads.
- [ ] Contract ownership is explicit and singular.
- [ ] Duplicate declarations and alias-only indirections are reduced, not increased.
- [ ] No `as any` or `as unknown as T` at trust boundaries.
- [ ] Naming follows `I*`/`T*` conventions; no `Interface`/`Type`/`TypeSafe` suffixes.
- [ ] Affected scope is linted and typechecked.
- [ ] SSOT scanner shows zero same-kind duplication.

## Anti-Patterns
- Casting external payloads directly into owned domain types.
- Re-declaring the same contract shape in multiple modules.
- Adding alias-only types that hide the real owner.
- Using `any` or unchecked assertions because the boundary was not modeled properly.
- Validating the same data multiple times in different layers.
- Validation errors that say "invalid input" without specifics.
- Mixing validation logic into domain/business logic.
- Pass-through re-exports from services/managers/plugins.

## Related Harness Commands
- `pnpm --filter @robota-sdk/<pkg> lint`
- `pnpm --filter @robota-sdk/<pkg> exec tsc -p tsconfig.json --noEmit`
- `node scripts/ssot-scan-declarations.mjs`
- `pnpm harness:scan`
