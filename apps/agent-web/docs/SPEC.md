# Web App Specification

## Scope

Owns the Robota web application. A Next.js 15 host that serves the Playground UI
(`@robota-sdk/agent-playground/client`) and provides the browser runtime composition layer. The root
route redirects to `/playground`.

## Boundaries

- Does not own package-level runtime contracts; imports browser-safe components from
  `@robota-sdk/agent-playground/client` and shared contracts/components from
  `@robota-sdk/agent-core`.
- Does not own API server behavior; that belongs to `apps/agent-server`.
- Keeps deployment, auth configuration, and frontend integration behavior within this app.
- Styling uses Tailwind CSS v4 utility classes only.

## Architecture Overview

Next.js App Router application with the following route structure:

- `/` -- redirects to `/playground`.
- `/playground` -- Playground main page.
- `/playground/demo` -- Playground demo mode.

The app composes workspace packages as React components and configures API access via `API_CONFIG`
(versioned base URL, timeout, retry, rate limiting). Client-side caching is provided by
`src/lib/cache.ts`. Browser builds explicitly disable Node builtin polyfills in `next.config.ts` so
Node-only optional exports from workspace packages do not enter the client bundle.

## Type Ownership

This app is SSOT for:

- `TTheme` -- theme type (`'light' | 'dark' | 'system'`).
- `INavItem`, `INavSection` -- navigation structure types.
- `IBrandConfig` -- brand configuration type.
- `ILayoutProps` -- layout component props.
- `IApiResponse<T>` -- generic API response wrapper.
- `API_CONFIG` -- API configuration constants (version, baseUrl, timeout, retry, rateLimit).

## Public API Surface

This is a private app (`"private": true`); it has no published API surface. Internal exports:

| Export          | Kind             | Description                |
| --------------- | ---------------- | -------------------------- |
| `API_CONFIG`    | const            | API endpoint configuration |
| Page components | React components | Next.js route pages        |

## Extension Points

- `API_CONFIG` -- configurable via `NEXT_PUBLIC_API_VERSION` environment variable.
- Layout composition -- `src/app/layout.tsx` provides the root layout shell.

## Error Taxonomy

No package-specific error types defined. Errors are handled by:

- Next.js built-in error boundaries.
- `IApiResponse.error` field for API call failures.

## Class Contract Registry

### Interface Implementations

None. No classes implement external interfaces.

### Inheritance Chains

None.

### Classes

| Class                 | Kind                 | Location           | Notes                                      |
| --------------------- | -------------------- | ------------------ | ------------------------------------------ |
| `SimpleCache<TValue>` | standalone (generic) | `src/lib/cache.ts` | In-memory TTL cache, no external contracts |

### Cross-Package Port Consumers

| Port (Owner)                                     | Consumer    | Location              |
| ------------------------------------------------ | ----------- | --------------------- |
| `@robota-sdk/agent-playground/client` components | Page routes | `src/app/playground/` |

## Test Strategy

- **Test framework**: Jest with `@testing-library/react` and `jest-environment-jsdom`.
- **Current state**: `pnpm test` runs with `--passWithNoTests`, indicating no test files exist yet.
- **Coverage gaps**: No component tests, no route tests, no API integration tests.
- Recommended: component tests for Playground integration.
