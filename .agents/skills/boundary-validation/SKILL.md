---
name: boundary-validation
description: Validates external data at trust boundaries using runtime checks and type narrowing, ensuring internal code can trust types without re-validation. Use when handling LLM responses, user input, API payloads, event data, or any external-origin data.
---

# Boundary Validation Patterns

## Rule Anchor
- `AGENTS.md` > "Type System (Strict)"
- `AGENTS.md` > "Execution Safety"
- `AGENTS.md` > "Development Patterns"

## Use This Skill When
- Receiving data from an external source (LLM API, user input, HTTP request, file, event bus).
- TypeScript compile-time types do not guarantee runtime shape.
- You need to narrow `unknown` to a concrete type safely.
- Replacing `as` casts or `any` at data entry points.

## Core Principles
1. **Validate at the boundary, trust internally**: external data is `unknown` until validated.
2. **Narrow once, use everywhere**: after validation, the result carries a trusted type.
3. **Fail fast with actionable errors**: validation failures include what was expected vs received.
4. **Tool-agnostic**: use type guards, discriminated unions, or schema validators — the principle is the same.
5. **No re-validation inside domain**: validated data flows as typed arguments; internal functions do not re-check.

## Trust Boundaries in This Project
| Boundary | Data Source | Package |
|----------|------------|---------|
| LLM API response | OpenAI/Anthropic/Google JSON | providers |
| User config/tool definition | Constructor arguments | agents |
| Event payload | EventService emit data | workflow, dag-projection |
| DAG definition | User-authored JSON | dag-core, dag-api |
| API request body | HTTP request | dag-api, api-server |
| Plugin config | Plugin constructor options | agents plugins |

## Patterns

### 1. Type Guard Function
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

### 2. Validator Function with Result
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
  return {
    ok: true,
    data: {
      taskRunId: obj.taskRunId,
    },
  };
}
```

### 3. Boundary Adapter
```ts
// Adapter layer: validate once, return typed result
class OpenAiResponseAdapter {
  parse(raw: unknown): IChatCompletionResult {
    if (!this.isValidResponse(raw)) {
      throw new Error('[EMITTER-CONTRACT] unexpected LLM response shape');
    }
    return raw; // now typed after guard
  }
  private isValidResponse(raw: unknown): raw is IChatCompletionResult { /* guards */ }
}
```

## Checklist
- [ ] Every external data entry point has a validation step.
- [ ] Validation produces a typed result (not `as` cast).
- [ ] Validation errors include field name, expected type, and received value.
- [ ] Internal domain functions receive already-validated typed arguments.
- [ ] No `as any` or `as unknown as T` at trust boundaries.
- [ ] Validation logic is co-located with the boundary adapter, not scattered.

## Anti-Patterns
- Using `as T` to cast external data without validation.
- Validating the same data multiple times in different layers.
- Validation errors that say "invalid input" without specifics.
- Mixing validation logic into domain/business logic.
- Trusting external data shapes based on TypeScript interfaces alone.
