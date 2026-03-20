# Remote Server Core Specification

## Scope

Owns reusable Remote API server route registration and OpenAPI documentation for Robota. Provides a single `registerRemoteServerRoutes` function that mounts `RemoteServer` from `@robota-sdk/agent-remote/server` onto an Express application, configures Swagger UI, and returns a runtime status handle.

## Boundaries

- Does not own remote client contracts or transport types; those belong to `@robota-sdk/agent-remote`.
- Does not own `RemoteServer` implementation; imports from `@robota-sdk/agent-remote/server`.
- Does not own AI provider contracts (`IAIProvider`); imports from `@robota-sdk/agent-core`.
- Does not own app-specific deployment, middleware, or environment configuration; that belongs to consumer apps (`apps/agent-server`).

## Architecture Overview

Thin composition layer. `registerRemoteServerRoutes` accepts an Express app, a provider map, and configuration options. It creates a `RemoteServer` instance, mounts its router at a configurable base path (default `/api/v1/remote`), and optionally serves Swagger UI at `/docs/remote` with the bundled OpenAPI document. Returns `IRemoteServerRuntime` for status queries.

## Type Ownership

This package is SSOT for:

- `IRegisterRemoteServerRoutesOptions` -- options for route registration (app, providers, basePath, apiDocsEnabled, logger).
- `IRemoteServerRuntime` -- runtime handle with `getStatus()`.
- `IRemoteServerLogger` -- logger interface required by the registration function.
- `REMOTE_OPENAPI_DOCUMENT` -- OpenAPI 3.0.3 specification object for the Remote API.

## Public API Surface

| Export                               | Kind      | Description                                                  |
| ------------------------------------ | --------- | ------------------------------------------------------------ |
| `registerRemoteServerRoutes`         | function  | Mounts remote server routes and Swagger UI on an Express app |
| `IRegisterRemoteServerRoutesOptions` | interface | Configuration for route registration                         |
| `IRemoteServerRuntime`               | interface | Runtime status handle                                        |
| `IRemoteServerLogger`                | interface | Logger contract for server operations                        |
| `REMOTE_OPENAPI_DOCUMENT`            | const     | OpenAPI specification object                                 |

## Extension Points

- `IRemoteServerLogger` -- consumers inject their own logger implementation.
- `basePath` option -- consumers can mount routes at a custom path prefix.
- `apiDocsEnabled` option -- toggle Swagger UI exposure.

## Error Taxonomy

This package does not define its own error types. Errors propagate from:

- `RemoteServer.initialize()` failure -- logged via the injected logger; the promise rejection is caught internally.
- Express middleware errors -- handled by the consumer app's error middleware.

## Test Strategy

- **1 test file exists**: `src/remote-server-routes.test.ts` (165 lines) covering route registration behavior.
- The package has minimal logic (route wiring only), making integration testing at the `apps/agent-server` level more appropriate.
- Recommended: additional smoke tests verifying Swagger UI mount and logger injection.
