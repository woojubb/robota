---
name: api-error-standard
description: Defines the standard error response format for HTTP APIs based on RFC 7807 Problem Details. Use when implementing or reviewing API error responses.
---

# API Error Response Standard

## Rule Anchor
- `AGENTS.md` > "No Fallback Policy"
- `AGENTS.md` > "Type System (Strict)"

## Use This Skill When
- Implementing HTTP API error responses.
- Reviewing API endpoint error handling.
- Adding new error types to an API surface.

## Standard Format (RFC 7807)

All HTTP API error responses MUST use the Problem Details format:

```ts
interface IProblemDetails {
  type: string;       // URI reference identifying the error type
  title: string;      // Short human-readable summary
  status: number;     // HTTP status code
  detail?: string;    // Human-readable explanation specific to this occurrence
  instance?: string;  // URI reference identifying the specific occurrence
}
```

## SSOT

The canonical `IProblemDetails` interface is owned by the `dag-api` package. All other packages that need this type MUST import from `dag-api`.

## Usage Rules

1. **Always return Problem Details** for 4xx and 5xx responses.
2. **Use specific `type` URIs** — not generic strings. Format: `urn:robota:error:<domain>:<error-name>`.
3. **Match `status` to HTTP status code** — do not return 200 with an error body.
4. **Include `detail`** for errors that need context beyond the title.
5. **Never expose internal details** (stack traces, database errors, internal paths) in production responses.

## Error Type Registry Pattern

Each API package should maintain a typed error union:

```ts
type TOrderError =
  | 'ORDER_NOT_FOUND'
  | 'ORDER_ALREADY_COMPLETED'
  | 'INSUFFICIENT_INVENTORY';

function toHttpStatus(error: TOrderError): number {
  const statusMap: Record<TOrderError, number> = {
    ORDER_NOT_FOUND: 404,
    ORDER_ALREADY_COMPLETED: 409,
    INSUFFICIENT_INVENTORY: 422,
  };
  return statusMap[error];
}
```

## Anti-Patterns

- Returning `{ error: true, message: "something went wrong" }` without structure.
- Returning 200 status with an error body.
- Exposing stack traces or internal error messages to clients.
- Using inconsistent error shapes across endpoints in the same API.
- Catching all errors and returning a generic 500 without classification.

## Checklist
- [ ] All error responses use `IProblemDetails` shape.
- [ ] Error `type` field uses the `urn:robota:error:` namespace.
- [ ] HTTP status code matches the error semantics.
- [ ] No internal details exposed in production error responses.
- [ ] Error types are documented in the package SPEC.md.
