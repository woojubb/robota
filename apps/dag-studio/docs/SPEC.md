# Web App Specification

## Scope

Owns the Robota web application. A Next.js 15 host that serves the Playground UI (`@robota-sdk/agent-playground`), the DAG Designer (`@robota-sdk/dag-designer`), and provides the browser runtime composition layer. The root route redirects to `/dag-designer`.

## Boundaries

- Does not own package-level runtime contracts; imports from `@robota-sdk/agent-core`, `@robota-sdk/agent-playground`, `@robota-sdk/dag-core`, and `@robota-sdk/dag-designer`.
- Does not own DAG API server behavior; that belongs to `apps/dag-orchestrator-server`.
- Does not proxy ComfyUI traffic or own run-progress WebSocket handling; `dag-designer` connects to the configured orchestrator origin.
- Keeps deployment, auth configuration, and frontend integration behavior within this app.
- Styling uses Tailwind CSS v4 utility classes only.

## Architecture Overview

Next.js App Router application with the following route structure:

- `/` -- redirects to `/dag-designer`.
- `/dag-designer` -- DAG Designer landing page with template selection.
- `/dag-designer/[dagId]` -- DAG Designer editor for a specific DAG.
- `/playground` -- Playground main page.
- `/playground/demo` -- Playground demo mode.

The app composes workspace packages as React components. Generic app API access is configured via `API_CONFIG` (versioned base URL, timeout, retry, rate limiting), while DAG Designer calls use `NEXT_PUBLIC_DAG_API_BASE_URL` directly and default to `http://localhost:3012` for local development. Client-side caching is provided by `src/lib/cache.ts`.

The DAG Designer editor header reads `@robota-sdk/dag-designer` context state for action gating. Save/Publish are blocked by binding validation errors, and Run is additionally blocked while `context.isRunnable` is false, for example while an asset upload is still in progress.

## Type Ownership

This app is SSOT for:

- `TTheme` -- theme type (`'light' | 'dark' | 'system'`).
- `INavItem`, `INavSection` -- navigation structure types.
- `IBrandConfig` -- brand configuration type.
- `ILayoutProps` -- layout component props.
- `IApiResponse<T>` -- generic API response wrapper.
- `API_CONFIG` -- API configuration constants (version, baseUrl, timeout, retry, rateLimit).

DAG API request/response shapes and run-progress event contracts are imported from `@robota-sdk/dag-designer` and upstream DAG packages; this app only supplies the concrete base URL.

## Public API Surface

This is a private app (`"private": true`); it has no published API surface. Internal exports:

| Export          | Kind             | Description                |
| --------------- | ---------------- | -------------------------- |
| `API_CONFIG`    | const            | API endpoint configuration |
| Page components | React components | Next.js route pages        |

## Extension Points

- `API_CONFIG` -- configurable via `NEXT_PUBLIC_API_VERSION` environment variable.
- `NEXT_PUBLIC_DAG_API_BASE_URL` -- deployed `dag-orchestrator-server` origin for DAG Designer REST and WebSocket calls.
- DAG Designer templates -- template definitions in `src/app/dag-designer/templates.ts`.
- Layout composition -- `src/app/layout.tsx` provides the root layout shell.

## Deployment Contract

This app is a frontend deploy unit. It may run on Vercel or Cloudflare's Next.js hosting path, but
the DAG orchestrator remains a separate long-running service. Production deployments must set
`NEXT_PUBLIC_DAG_API_BASE_URL` to the orchestrator origin and configure the orchestrator
`CORS_ORIGINS` value to include this app's deployed origin.

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

| Port (Owner)                              | Consumer    | Location                |
| ----------------------------------------- | ----------- | ----------------------- |
| `@robota-sdk/agent-playground` components | Page routes | `src/app/playground/`   |
| `@robota-sdk/dag-designer` components     | Page routes | `src/app/dag-designer/` |

## Test Strategy

- **Test framework**: Jest with `@testing-library/react` and `jest-environment-jsdom`.
- **Current state**: `pnpm test` runs with `--passWithNoTests`, indicating no test files exist yet.
- **Coverage gaps**: No component tests, no route tests, no API integration tests.
- Recommended: component tests for DAG Designer pages and Playground integration.
