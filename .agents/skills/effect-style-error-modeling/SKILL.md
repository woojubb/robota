---
name: effect-style-error-modeling
description: Models success and failure explicitly in TypeScript using Result or Either-like flows instead of uncontrolled exceptions. Use when implementing predictable error propagation across async workflows.
---

# Effect-Style Error Modeling

## Rule Anchor

- `AGENTS.md` > "No Fallback Policy" (Result type mandatory for failable public functions)
- `AGENTS.md` > "Development Patterns"

The No-Fallback rule (owned by [code-quality.md](../../rules/code-quality.md)) is the constraint;
this skill owns only the Result-vs-throw decision method. Model errors as data
(`type Result<T, E> = { ok: true; value: T } | { ok: false; error: E }`), define domain-specific
error unions, map external exceptions to typed variants once at the boundary adapter, and keep one
canonical error path per use case. Never convert terminal failure into active processing without a
separately gated, explicitly authorized policy path.

## When to Use Result vs Throw

| Scenario                                                           | Use                                 | Rationale                                    |
| ------------------------------------------------------------------ | ----------------------------------- | -------------------------------------------- |
| Domain operation that can fail (validation, not found, conflict)   | `Result<T, E>`                      | Caller must handle failure explicitly        |
| Truly unexpected programmer error (assertion, invariant violation) | `throw`                             | Should crash, not be silently handled        |
| External SDK/API call boundary                                     | `Result<T, E>` via boundary adapter | Convert exception to typed error at boundary |
| Internal helper called only by Result-returning functions          | Either                              | Match the caller's convention                |

**Decision rule:** if the caller should reasonably handle the failure, return `Result`. If the
failure means a bug in the code, throw. Do not mix `throw` and `Result` randomly in one flow, and
never catch-everything into a generic fallback success.
