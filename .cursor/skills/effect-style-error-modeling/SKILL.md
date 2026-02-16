---
name: effect-style-error-modeling
description: Models success and failure explicitly in TypeScript using Result or Either-like flows instead of uncontrolled exceptions. Use when implementing predictable error propagation across async workflows.
---

# Effect-Style Error Modeling

## Rule Anchor
- `.cursor/rules/development-architecture-rules.mdc`
- `.cursor/rules/execution-safety-rules.mdc`

## Use This Skill When
- Error handling is inconsistent (`throw`, `null`, `undefined`, magic strings).
- Async logic has nested try/catch with unclear propagation.
- You need explicit, typed failure paths.

## Core Principles
1. Model errors as data, not hidden control flow.
2. Return a typed result from domain operations.
3. Convert external exceptions into domain error variants at boundaries.
4. Keep one canonical error path per use case.
5. Preserve terminal failure integrity: do not convert terminal failure into active processing unless a separately gated policy explicitly allows it.

## Minimal Result Shape
```ts
type Result<T, E> =
  | { ok: true; value: T }
  | { ok: false; error: E };
```

## Workflow
1. Define domain-specific error unions.
2. Make domain/application methods return `Result<T, E>`.
3. Wrap external calls in boundary adapters and map exceptions.
4. Compose operations by checking `ok` and returning early on failure.
5. Convert final `Result` to transport response (HTTP/event/log) once.
6. If a reprocess path is required, model it as a separately authorized policy path (disabled by default), not as implicit fallback.

## Reference Skeleton
```ts
type CreateUserError = "EMAIL_TAKEN" | "INVALID_INPUT" | "INFRA_FAILURE";

async function createUser(input: Input, deps: Deps): Promise<Result<User, CreateUserError>> {
  if (!input.email) return { ok: false, error: "INVALID_INPUT" };
  const exists = await deps.users.exists(input.email);
  if (exists) return { ok: false, error: "EMAIL_TAKEN" };
  const saved = await deps.users.save(input);
  return saved ? { ok: true, value: saved } : { ok: false, error: "INFRA_FAILURE" };
}
```

## Checklist
- [ ] Error union types are explicit and domain-meaningful.
- [ ] No mixed error channels in same layer.
- [ ] Boundary adapters map third-party errors once.
- [ ] Callers handle `ok: false` explicitly.
- [ ] Logs and responses derive from typed error values.
- [ ] Terminal failure is not converted to queued/running without explicit policy gate.

## Anti-Patterns
- Catching everything and returning generic fallback success.
- Throwing raw strings or unknown objects from domain logic.
- Mixing `throw` and `Result` randomly in one flow.
- Re-queuing failed work silently because "operations need convenience".
