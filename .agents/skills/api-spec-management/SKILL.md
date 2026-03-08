# api-spec-management

API specification management for applications with external endpoints.

## Use This Skill When

- An app in `apps/` has HTTP, WebSocket, gRPC, or other external API endpoints.
- Adding a new API endpoint to an existing server.
- Changing request or response shapes of an existing API endpoint.

## Core Principles

- Every external API must have a standardized specification document.
- HTTP REST APIs use OpenAPI 3.0+ with interactive UI (e.g., Swagger UI).
- Event-based APIs (WebSocket, SSE) should be documented inline within the OpenAPI spec where possible. Dedicated tooling (e.g., AsyncAPI) may be introduced when the event surface grows; research at adoption time.
- Specifications must stay synchronized with implementation (TypeScript types and route handlers).
- API spec files live in the owning server package's `docs/` source directory (e.g., `src/docs/`).

## HTTP API Workflow

1. When adding or changing an endpoint, update the OpenAPI spec in the same commit.
2. Define schemas for all request bodies, response bodies, query parameters, and path parameters.
3. Error responses must follow RFC 7807 Problem Details format (see `api-error-standard` skill).
4. Provide interactive documentation (Swagger UI or equivalent) in development mode.
5. Use `$ref` and `components/schemas` for reusable schema definitions.
6. Success responses use the envelope: `{ ok: true, status: number, data: {...} }`.
7. Error responses use the envelope: `{ ok: false, status: number, errors: ProblemDetails[] }`.

## Checklist

- [ ] Every endpoint has request and response schemas defined in the OpenAPI spec.
- [ ] Error response schemas follow RFC 7807 (`ProblemDetails` / `ErrorEnvelope`).
- [ ] Interactive API docs are accessible in development (e.g., `/docs/<api-name>`).
- [ ] TypeScript interfaces match the OpenAPI schemas (field names, types, required flags).
- [ ] SSE endpoints document the `text/event-stream` content type and event payload shape.
- [ ] Binary endpoints document the expected `Content-Type` and `Content-Disposition` headers.

## Anti-Patterns

- Defining only status codes without body schemas.
- Writing a spec once and never updating it as the implementation evolves.
- Coupling rules to a specific tool; choose tooling appropriate to the protocol.
- Duplicating schema definitions instead of using `$ref`.
- Omitting error response schemas.
