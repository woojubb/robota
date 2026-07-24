---
name: api-error-standard
description: Defines the standard error response format for HTTP APIs based on RFC 7807 Problem Details. Use when implementing or reviewing API error responses.
---

# API Error Response Standard

## Rule Anchor

- `AGENTS.md` > "No Fallback Policy"
- `AGENTS.md` > "Type System (Strict)"

All HTTP API 4xx/5xx responses MUST use RFC 7807 Problem Details
(`{ type, title, status, detail?, instance? }` — see the RFC for field semantics).

## SSOT Ownership

The canonical `IProblemDetails` interface is owned by the API package or app that exposes the HTTP
surface. Shared consumers must import from that owner instead of redeclaring the same shape.

## Usage Rules

1. `type` URIs are specific, namespaced identifiers: `urn:robota:error:<domain>:<error-name>` —
   never generic strings.
2. `status` matches the HTTP status code — never return 200 with an error body.
3. Never expose internal details (stack traces, database errors, internal paths) in production
   responses.
4. Each API package maintains a typed error union with an explicit error→status mapping, and
   documents its error types in the package SPEC.md.
5. Error shapes are consistent across every endpoint of the same API — no catch-all generic 500s
   without classification.
